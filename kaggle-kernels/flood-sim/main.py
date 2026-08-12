"""
Terranoetis — Local-Inertial Rainfall-Driven Flood Simulation
Runs on Kaggle CPU/GPU.

Solves the 2D local-inertial (diffusive-inertial) shallow water equations
with a spatially uniform rainfall source term — the approach used by
LISFLOOD-FP, SFINCS, and RIM2D. Water accumulates everywhere rainfall falls,
channels into topographic lows, ponds in depressions, and covers the entire
DEM domain (not just valleys downstream of a breach).

Physics:
  Continuity:  dh/dt = rainfall_rate - infiltration + flux divergence
  Momentum:    local-inertial (local acceleration + pressure gradient +
               bed slope + Manning friction, semi-implicit)

State: h[NY,NX], hu[NY,NX], hv[NY,NX] (cell-centred conservative variables)

Solver: Rusanov (local Lax-Friedrichs) for continuity with hydrostatic
        reconstruction (Audusse et al. 2004), semi-implicit Bates (2010)
        formulation for Manning friction.

Author: Terranoetis / Freebuff
"""

import json
import os
import time
import traceback
import numpy as np

# ── JSON-safe conversion ───────────────────────────────────────────
# NumPy 2.x scalars (np.bool_, np.float64, np.int64, …) are no longer
# subclasses of Python's bool/float/int, so json.dump/dumps on a dict that
# contains one raises `TypeError: Object of type bool is not JSON serializable`
# (observed on Kaggle). Recursively convert every numpy scalar/array to native
# Python types so result serialization is numpy-version-agnostic.
def _json_safe(obj):
    if isinstance(obj, np.ndarray):
        if obj.ndim == 0:
            return _json_safe(obj.item())
        return [_json_safe(v) for v in obj.tolist()]
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float):
        if obj != obj or obj in (float('inf'), float('-inf')):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj

# ── Physical constants ──────────────────────────────────────────────
G = 9.81              # m/s² — gravitational acceleration
MANNING_N = 0.035     # mixed land cover default (used only when no land cover is provided)
INFILTRATION_MM_HR = 10.0  # Green-Ampt constant loss rate (mm/hr)
CFL = 0.5             # CFL number for adaptive timestep
V_MAX = 5.0           # m/s — physical velocity cap for flood waters

# ── ESA WorldCover v200 land cover → Manning's n ──────────────────────
# Class codes from the WorldCover Product User Manual (v200). Roughness from
# Chow (1959) + common flood-model lookup tables (LISFLOOD-FP / HEC-RAS).
# When a land-cover grid is embedded (landcover_b64), each cell gets its own
# n; otherwise every cell uses MANNING_N above.
LANDCOVER_NAMES = {
    0: 'nodata',
    10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland',
    50: 'Built-up', 60: 'Bare', 70: 'Snow/ice', 80: 'Water',
    90: 'Herbaceous wetland', 95: 'Mangroves', 100: 'Moss/lichen',
}
WORLDCOVER_MANNING_N = {
    10: 0.100,   # dense forest floor
    20: 0.070,   # light brush / scrub
    30: 0.035,   # short grass pasture
    40: 0.040,   # cultivated row crops
    50: 0.015,   # paved / built-up
    60: 0.025,   # bare earth
    70: 0.025,   # snow / ice
    80: 0.030,   # open water surface
    90: 0.060,   # dense herbaceous marsh
    95: 0.150,   # mangrove swamp
    100: 0.050,  # moss / lichen
}


def _bilinear_upsample(src, src_n, out_n):
    """
    Bilinearly upsample a square [src_n, src_n] elevation grid to
    [out_n, out_n]. Used to lift a coarse client-sampled Cesium terrain
    (e.g. 64×64) to the simulation resolution (e.g. 256×256).
    Row 0 is the north edge for both grids, matching the renderer.
    """
    src = np.asarray(src, dtype=np.float64)
    s = np.arange(out_n) * (src_n - 1) / max(1, out_n - 1)
    y0 = np.clip(s.astype(int), 0, src_n - 2)
    y1 = y0 + 1
    fy = s - y0
    x0 = np.clip(s.astype(int), 0, src_n - 2)
    x1 = x0 + 1
    fx = s - x0
    out = np.empty((out_n, out_n), dtype=np.float64)
    for j in range(out_n):
        out[j] = (src[y0[j], x0] * (1 - fy[j]) * (1 - fx)
                  + src[y0[j], x1] * (1 - fy[j]) * fx
                  + src[y1[j], x0] * fy[j] * (1 - fx)
                  + src[y1[j], x1] * fy[j] * fx)
    return out


def _nearest_upsample(src, src_n, out_n):
    """
    Nearest-neighbour upsample of a categorical [src_n, src_n] grid (land-cover
    class codes) to [out_n, out_n]. Bilinear would invent impossible class
    codes, so classes are sampled, never blended.
    """
    s = np.round(np.linspace(0, src_n - 1, out_n)).astype(int)
    return np.asarray(src, dtype=np.int64).reshape(src_n, src_n)[np.ix_(s, s)]


def verify_closed_box(gs=64, steps=500, tol=1e-9):
    """
    Conservation proof: run the SAME production update loop on flat terrain
    with a CLOSED (reflecting) boundary — no transmissive outflow — and assert
    total water mass is conserved to machine precision. This isolates the
    solver's conservation from the open-boundary bookkeeping in
    `run_flood_simulation`. Returns (passed, final_mass, initial_mass, rel_error).
    """
    import numpy as _np
    G_LOC = 9.81
    V_MAX_LOC = 5.0
    MANNING_N_LOC = 0.035
    dx = 20.0
    dt = 0.1
    h = _np.zeros((gs, gs))
    hu = _np.zeros((gs, gs))
    hv = _np.zeros((gs, gs))
    # Compact central water pile as the initial slug (closed box, no source).
    yy, xx = _np.meshgrid(_np.arange(gs), _np.arange(gs), indexing='ij')
    h[(yy - gs // 2) ** 2 + (xx - gs // 2) ** 2 <= (gs // 6) ** 2] = 2.0
    init_mass = float(h.sum())
    z_b = _np.zeros((gs, gs))  # flat terrain
    n_cell = _np.full((gs, gs), MANNING_N_LOC, dtype=_np.float64)
    # No rainfall or infiltration for the closed-box test
    rainfall_rate = 0.0
    effective_infiltration = 0.0
    wet_thresh = 0.01
    clip_loss = 0.0  # residual positivity-clip deficit (must stay ~0)

    for _ in range(steps):
        # Velocity from momentum (clipped).
        wet = h > wet_thresh
        u = _np.zeros_like(h)
        v = _np.zeros_like(h)
        u[wet] = _np.clip(hu[wet] / h[wet], -V_MAX_LOC, V_MAX_LOC)
        v[wet] = _np.clip(hv[wet] / h[wet], -V_MAX_LOC, V_MAX_LOC)

        # Rusanov (local Lax-Friedrichs) face fluxes with hydrostatic reconstruction
        z_r = _np.roll(z_b, -1, 1)
        z_d = _np.roll(z_b, -1, 0)
        h_r = _np.roll(h, -1, 1)
        h_d = _np.roll(h, -1, 0)
        u_r = _np.roll(u, -1, 1)
        v_d = _np.roll(v, -1, 0)
        c = _np.sqrt(G_LOC * _np.maximum(h, 0.0))
        c_r = _np.sqrt(G_LOC * _np.maximum(h_r, 0.0))
        c_d = _np.sqrt(G_LOC * _np.maximum(h_d, 0.0))
        a_x = _np.maximum(_np.abs(u) + c, _np.abs(u_r) + c_r)
        a_y = _np.maximum(_np.abs(v) + c, _np.abs(v_d) + c_d)
        zf_x = _np.maximum(z_b, z_r)
        zf_y = _np.maximum(z_b, z_d)
        hL_x = _np.maximum((z_b + h) - zf_x, 0.0)
        hR_x = _np.maximum((z_r + h_r) - zf_x, 0.0)
        hL_y = _np.maximum((z_b + h) - zf_y, 0.0)
        hR_y = _np.maximum((z_d + h_d) - zf_y, 0.0)
        Fx = 0.5 * (h * u + h_r * u_r) - 0.5 * a_x * (hR_x - hL_x)
        Fy = 0.5 * (h * v + h_d * v_d) - 0.5 * a_y * (hR_y - hL_y)
        # Closed box: reflecting boundaries (zero flux at walls)
        Fxl = _np.roll(Fx, 1, axis=1); Fxl[:, 0] = 0.0
        Fx[:, -1] = 0.0
        Fyu = _np.roll(Fy, 1, axis=0); Fyu[0, :] = 0.0
        Fy[-1, :] = 0.0
        h_new = h - (dt / dx) * ((Fx - Fxl) + (Fy - Fyu))
        # Rainfall adds, infiltration removes (never below zero).
        h_new = h_new + dt * rainfall_rate - dt * effective_infiltration
        h_new = _np.maximum(h_new, 0.0)
        wet_new = h_new > wet_thresh

        # Momentum update (well-balanced: only free-surface pressure gradient)
        eta_field = z_b + h_new
        deta_dx = _np.zeros_like(eta_field)
        deta_dy = _np.zeros_like(eta_field)
        deta_dx[1:-1, 1:-1] = (eta_field[1:-1, 2:] - eta_field[1:-1, :-2]) / (2.0 * dx)
        deta_dy[1:-1, 1:-1] = (eta_field[2:, 1:-1] - eta_field[:-2, 1:-1]) / (2.0 * dx)
        pressure_x = -G_LOC * h_new * deta_dx
        pressure_y = -G_LOC * h_new * deta_dy

        # Manning friction (semi-implicit Bates 2010)
        u_mag = _np.sqrt(u**2 + v**2)
        h_pow = _np.power(_np.maximum(h_new, 1e-6), 4.0/3.0)
        manning_coeff = G_LOC * n_cell**2 * u_mag / h_pow * wet_new
        denom = 1.0 + dt * manning_coeff

        hu_new = (hu + dt * pressure_x) / denom
        hv_new = (hv + dt * pressure_y) / denom

        # Velocity clamp
        u_new = _np.zeros_like(hu_new)
        v_new = _np.zeros_like(hv_new)
        u_new[wet_new] = _np.clip(hu_new[wet_new] / _np.maximum(h_new[wet_new], 1e-6), -V_MAX_LOC, V_MAX_LOC)
        v_new[wet_new] = _np.clip(hv_new[wet_new] / _np.maximum(h_new[wet_new], 1e-6), -V_MAX_LOC, V_MAX_LOC)
        hu_new = h_new * u_new
        hv_new = h_new * v_new

        # Reflecting box: zero normal flux at walls → nothing leaves.
        hu_new[:, 1] = h_new[:, 1] * _np.minimum(u_new[:, 1], 0.0)
        hu_new[:, -2] = h_new[:, -2] * _np.maximum(u_new[:, -2], 0.0)
        hv_new[1, :] = h_new[1, :] * _np.minimum(v_new[1, :], 0.0)
        hv_new[-2, :] = h_new[-2, :] * _np.maximum(v_new[-2, :], 0.0)

        # Boundary conditions: propagate η to ghost cells
        h_new[0, :] = _np.maximum((z_b[1, :] + h_new[1, :]) - z_b[0, :], 0.0)
        h_new[-1, :] = _np.maximum((z_b[-2, :] + h_new[-2, :]) - z_b[-1, :], 0.0)
        h_new[:, 0] = _np.maximum((z_b[:, 1] + h_new[:, 1]) - z_b[:, 0], 0.0)
        h_new[:, -1] = _np.maximum((z_b[:, -2] + h_new[:, -2]) - z_b[:, -1], 0.0)
        hu_new[0, :] = hu_new[1, :]; hu_new[-1, :] = hu_new[-2, :]
        hu_new[:, 0] = hu_new[:, 1]; hu_new[:, -1] = hu_new[:, -2]
        hv_new[0, :] = hv_new[1, :]; hv_new[-1, :] = hv_new[-2, :]
        hv_new[:, 0] = hv_new[:, 1]; hv_new[:, -1] = hv_new[:, -2]

        h = h_new
        hu = hu_new
        hv = hv_new

    final_mass = float(h.sum())
    rel_error = (final_mass - init_mass) / max(init_mass, 1e-12)
    passed = abs(rel_error) < tol
    print(f"[VERIFY] closed-box gs={gs} steps={steps}: "
          f"init={init_mass:.6f} final={final_mass:.6f} "
          f"|Δ|={abs(rel_error):.2e} → {'PASS' if passed else 'FAIL'}")
    return passed, final_mass, init_mass, abs(rel_error)


def verify_lake_at_rest(gs=64, steps=100, tol=1e-6):
    """
    Well-balancing test: place water on a sloped bed with constant free-surface
    elevation (η = h + z_b = const). A well-balanced solver should maintain
    this state (zero tendency) to machine precision. This tests the crucial
    property that a still lake on a hillside doesn't spontaneously flow.
    """
    import numpy as _np
    G_LOC = 9.81
    V_MAX_LOC = 5.0
    MANNING_N_LOC = 0.035
    dx = 20.0
    dt = 0.1
    
    # Create sloped bed: z_b increases linearly from left to right
    yy, xx = _np.meshgrid(_np.arange(gs), _np.arange(gs), indexing='ij')
    z_b = 0.1 * xx  # 10% slope
    
    # Initial water depth: constant free-surface elevation (lake at rest)
    eta_target = 10.0  # constant free-surface elevation
    h = _np.maximum(eta_target - z_b, 0.0)  # h = η - z_b
    
    hu = _np.zeros((gs, gs))
    hv = _np.zeros((gs, gs))
    init_mass = float(h.sum())
    n_cell = _np.full((gs, gs), MANNING_N_LOC, dtype=_np.float64)
    rainfall_rate = 0.0
    effective_infiltration = 0.0
    wet_thresh = 0.01
    
    # Store initial free-surface elevation
    eta_initial = z_b + h
    
    for step in range(steps):
        # Velocity from momentum (clipped).
        wet = h > wet_thresh
        u = _np.zeros_like(h)
        v = _np.zeros_like(h)
        u[wet] = _np.clip(hu[wet] / h[wet], -V_MAX_LOC, V_MAX_LOC)
        v[wet] = _np.clip(hv[wet] / h[wet], -V_MAX_LOC, V_MAX_LOC)

        # Rusanov face fluxes with hydrostatic reconstruction
        z_r = _np.roll(z_b, -1, 1)
        z_d = _np.roll(z_b, -1, 0)
        h_r = _np.roll(h, -1, 1)
        h_d = _np.roll(h, -1, 0)
        u_r = _np.roll(u, -1, 1)
        v_d = _np.roll(v, -1, 0)
        c = _np.sqrt(G_LOC * _np.maximum(h, 0.0))
        c_r = _np.sqrt(G_LOC * _np.maximum(h_r, 0.0))
        c_d = _np.sqrt(G_LOC * _np.maximum(h_d, 0.0))
        a_x = _np.maximum(_np.abs(u) + c, _np.abs(u_r) + c_r)
        a_y = _np.maximum(_np.abs(v) + c, _np.abs(v_d) + c_d)
        zf_x = _np.maximum(z_b, z_r)
        zf_y = _np.maximum(z_b, z_d)
        hL_x = _np.maximum((z_b + h) - zf_x, 0.0)
        hR_x = _np.maximum((z_r + h_r) - zf_x, 0.0)
        hL_y = _np.maximum((z_b + h) - zf_y, 0.0)
        hR_y = _np.maximum((z_d + h_d) - zf_y, 0.0)
        Fx = 0.5 * (h * u + h_r * u_r) - 0.5 * a_x * (hR_x - hL_x)
        Fy = 0.5 * (h * v + h_d * v_d) - 0.5 * a_y * (hR_y - hL_y)
        Fxl = _np.roll(Fx, 1, axis=1); Fxl[:, 0] = h[:, 0] * u[:, 0]
        Fx[:, -1] = h[:, -1] * u[:, -1]
        Fyu = _np.roll(Fy, 1, axis=0); Fyu[0, :] = h[0, :] * v[0, :]
        Fy[-1, :] = h[-1, :] * v[-1, :]
        h_new = h - (dt / dx) * ((Fx - Fxl) + (Fy - Fyu))
        h_new = h_new + dt * rainfall_rate - dt * effective_infiltration
        h_new = _np.maximum(h_new, 0.0)
        wet_new = h_new > wet_thresh

        # Momentum update (well-balanced: only free-surface pressure gradient)
        eta_field = z_b + h_new
        deta_dx = _np.zeros_like(eta_field)
        deta_dy = _np.zeros_like(eta_field)
        deta_dx[1:-1, 1:-1] = (eta_field[1:-1, 2:] - eta_field[1:-1, :-2]) / (2.0 * dx)
        deta_dy[1:-1, 1:-1] = (eta_field[2:, 1:-1] - eta_field[:-2, 1:-1]) / (2.0 * dx)
        pressure_x = -G_LOC * h_new * deta_dx
        pressure_y = -G_LOC * h_new * deta_dy

        # Manning friction
        u_mag = _np.sqrt(u**2 + v**2)
        h_pow = _np.power(_np.maximum(h_new, 1e-6), 4.0/3.0)
        manning_coeff = G_LOC * n_cell**2 * u_mag / h_pow * wet_new
        denom = 1.0 + dt * manning_coeff

        hu_new = (hu + dt * pressure_x) / denom
        hv_new = (hv + dt * pressure_y) / denom

        # Velocity clamp
        u_new = _np.zeros_like(hu_new)
        v_new = _np.zeros_like(hv_new)
        u_new[wet_new] = _np.clip(hu_new[wet_new] / _np.maximum(h_new[wet_new], 1e-6), -V_MAX_LOC, V_MAX_LOC)
        v_new[wet_new] = _np.clip(hv_new[wet_new] / _np.maximum(h_new[wet_new], 1e-6), -V_MAX_LOC, V_MAX_LOC)
        hu_new = h_new * u_new
        hv_new = h_new * v_new

        # Reflecting boundary
        hu_new[:, 1] = h_new[:, 1] * _np.minimum(u_new[:, 1], 0.0)
        hu_new[:, -2] = h_new[:, -2] * _np.maximum(u_new[:, -2], 0.0)
        hv_new[1, :] = h_new[1, :] * _np.minimum(v_new[1, :], 0.0)
        hv_new[-2, :] = h_new[-2, :] * _np.maximum(v_new[-2, :], 0.0)

        # Boundary conditions (η-preserving for well-balancing)
        h_new[0, :] = _np.maximum((z_b[1, :] + h_new[1, :]) - z_b[0, :], 0.0)
        h_new[-1, :] = _np.maximum((z_b[-2, :] + h_new[-2, :]) - z_b[-1, :], 0.0)
        h_new[:, 0] = _np.maximum((z_b[:, 1] + h_new[:, 1]) - z_b[:, 0], 0.0)
        h_new[:, -1] = _np.maximum((z_b[:, -2] + h_new[:, -2]) - z_b[:, -1], 0.0)
        hu_new[0, :] = hu_new[1, :]; hu_new[-1, :] = hu_new[-2, :]
        hu_new[:, 0] = hu_new[:, 1]; hu_new[:, -1] = hu_new[:, -2]
        hv_new[0, :] = hv_new[1, :]; hv_new[-1, :] = hv_new[-2, :]
        hv_new[:, 0] = hv_new[:, 1]; hv_new[:, -1] = hv_new[:, -2]

        h = h_new
        hu = hu_new
        hv = hv_new
    
    # Check if free-surface elevation is preserved
    eta_final = z_b + h
    eta_error = _np.max(_np.abs(eta_final - eta_initial))
    passed = eta_error < tol
    print(f"[VERIFY] lake-at-rest gs={gs} steps={steps}: "
          f"max |Δη|={eta_error:.2e} → {'PASS' if passed else 'FAIL'}")
    return passed, eta_error


def run_flood_simulation(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    rainfall_mm = float(params.get('rainfall_mm', 400))
    duration_hours = float(params.get('duration_hours', 12))
    soil_saturation = float(params.get('soil_saturation', 0.8))
    lat = float(params.get('lat', 29.76))
    lon = float(params.get('lon', -95.37))

    print(f"\n{'='*60}")
    print("TERRANOETIS — LOCAL-INERTIAL RAINFALL FLOOD SIMULATION")
    print(f"{'='*60}")
    print(f"Location: {lat:.4f}, {lon:.4f}")
    print(f"Grid: {gs}x{gs} ({gs**2:,} cells) | Duration: {duration_hours:.1f}h")
    print(f"Rainfall: {rainfall_mm:.0f} mm total | Soil sat: {soil_saturation:.1f}")

    # Grid spacing: scaled to study area extent
    extent_km = float(params.get('extent_km', 0.0))
    dx = (extent_km * 1000.0 / gs) if extent_km > 0 else 20.0  # meters
    print(f"Cell size: {dx:.1f} m | Domain: {extent_km:.1f} km")

    # ── Real terrain support (same contract as landslide kernel) ──
    terrain_gs0 = int(params.get('terrain_gs', 0) or 0)
    terrain_b64 = params.get('terrain_b64')
    terrain_vals = params.get('terrain')
    use_real = bool(terrain_gs0 > 1)

    if use_real and terrain_b64:
        try:
            import base64
            raw = base64.b64decode(terrain_b64)
            u16 = np.frombuffer(raw, dtype='<u2')
            if len(u16) != terrain_gs0 * terrain_gs0:
                use_real = False
            else:
                tmin = float(params.get('terrain_min', 0.0))
                tspan = float(params.get('terrain_span', 1.0))
                flat = np.where(u16 == 65535, np.nan, tmin + (u16 / 65534.0) * tspan)
                flat = np.where(np.isnan(flat), tmin, flat)
                terrain_2d = np.asarray(flat, dtype=np.float64).reshape(terrain_gs0, terrain_gs0)
                z_b = _bilinear_upsample(terrain_2d, terrain_gs0, gs)
                z_b = np.clip(z_b, 0, 12000)
                print(f"[TERRAIN] Real Cesium terrain {terrain_gs0}x{terrain_gs0} -> {gs}x{gs}")
        except Exception:
            use_real = False
    elif use_real and isinstance(terrain_vals, list) and len(terrain_vals) == terrain_gs0 * terrain_gs0:
        terrain_2d = np.asarray(terrain_vals, dtype=np.float64).reshape(terrain_gs0, terrain_gs0)
        z_b = _bilinear_upsample(terrain_2d, terrain_gs0, gs)
        z_b = np.clip(z_b, 0, 12000)
        print(f"[TERRAIN] Real Cesium terrain {terrain_gs0}x{terrain_gs0} -> {gs}x{gs}")

    if not use_real:
        # Fallback: gentle synthetic terrain with drainage gradient
        yy, xx = np.meshgrid(np.linspace(-1, 1, gs), np.linspace(-1, 1, gs), indexing='ij')
        z_b = 5.0 + 15.0 * (np.abs(yy) + np.abs(xx)) * 0.5 + 0.5 * xx
        z_b += np.random.RandomState(42).randn(gs, gs) * 0.3
        print(f"[TERRAIN] Synthetic terrain {gs}x{gs}, dx={dx:.0f}m")

    # Checksum verification
    print(f"[TERRAIN] elev min={z_b.min():.1f} max={z_b.max():.1f} mean={z_b.mean():.1f} m")

    # ── Real land cover → per-cell Manning's n ──
    landcover_gs0 = int(params.get('landcover_gs', 0) or 0)
    landcover_b64 = params.get('landcover_b64')
    landcover_vals = params.get('landcover')
    use_landcover = bool(landcover_gs0 > 1)
    lc_classes = None

    if use_landcover and landcover_b64:
        try:
            import base64
            raw = base64.b64decode(landcover_b64)
            u8 = np.frombuffer(raw, dtype=np.uint8)
            if len(u8) != landcover_gs0 * landcover_gs0:
                use_landcover = False
            else:
                lc_classes = _nearest_upsample(u8, landcover_gs0, gs)
        except Exception:
            use_landcover = False
    elif use_landcover and isinstance(landcover_vals, list) and len(landcover_vals) == landcover_gs0 * landcover_gs0:
        lc_classes = _nearest_upsample(np.asarray(landcover_vals, dtype=np.int64), landcover_gs0, gs)

    if use_landcover and lc_classes is not None:
        n_cell = np.full((gs, gs), MANNING_N, dtype=np.float64)
        for code, nv in WORLDCOVER_MANNING_N.items():
            n_cell[lc_classes == code] = nv
        unique, counts = np.unique(lc_classes, return_counts=True)
        order = np.argsort(-counts)
        hist = ", ".join(
            f"{LANDCOVER_NAMES.get(int(c), str(int(c)))} {int(counts[k])/ (gs*gs) * 100:.0f}%"
            for k, c in zip(order, unique[order])
        )
        print(f"[LANDCOVER] ESA WorldCover {landcover_gs0}x{landcover_gs0} -> {gs}x{gs} "
              f"| n min={n_cell.min():.3f} max={n_cell.max():.3f}")
        print(f"[LANDCOVER] {hist}")
    else:
        n_cell = np.full((gs, gs), MANNING_N, dtype=np.float64)
        print(f"[LANDCOVER] none provided — uniform Manning n = {MANNING_N:.3f}")

    # ── Rainfall rate (m/s) ──
    rainfall_rate = (rainfall_mm / 1000.0) / (duration_hours * 3600.0)  # m/s
    infiltration_rate = (INFILTRATION_MM_HR / 1000.0) / 3600.0  # m/s
    effective_infiltration = infiltration_rate * (1.0 - soil_saturation * 0.7)
    print(f"[RAIN] {rainfall_mm:.0f} mm over {duration_hours:.1f}h = "
          f"{rainfall_rate*3600*1000:.1f} mm/hr, infiltration {effective_infiltration*3600*1000:.1f} mm/hr")

    # ── State: cell-centred, conservative Rusanov scheme ──
    h = np.zeros((gs, gs), dtype=np.float64)  # water depth (m)
    hu = np.zeros((gs, gs), dtype=np.float64)  # x-momentum (m²/s)
    hv = np.zeros((gs, gs), dtype=np.float64)  # y-momentum (m²/s)
    source_volume = 0.0     # total rainfall volume added (m³)
    infil_volume = 0.0      # total infiltration volume lost (m³)
    outflow_volume = 0.0    # volume that left the open domain (m³)
    clip_loss_volume = 0.0  # residual positivity-clip deficit (m³)

    # Initial wet ground (saturated soil) so water pools broadly
    h_init = 0.02 * soil_saturation
    h.fill(h_init)

    # ── Time stepping ──
    total_sim_sec = duration_hours * 3600.0
    wallclock_max = float(params.get('wallclock_max_sec', 480))
    snap_interval_sec = total_sim_sec / 30.0  # 30 snapshots

    print(f"[SIM] {total_sim_sec:.0f}s sim time, wall-clock cap {wallclock_max:.0f}s")
    snapshots = []
    sim_t = 0.0
    step_i = 0

    while sim_t < total_sim_sec:
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at t={sim_t/3600:.1f}h (elapsed {time.time()-t0:.0f}s)")
            break

        # ── Adaptive timestep (CFL) ──
        max_h = float(h.max())
        wave_speed = np.sqrt(G * max_h) + V_MAX
        dt = float(CFL * dx / max(wave_speed, 1e-6))
        dt = min(dt, 1.0)  # cap at 1s

        # ── Rainfall source + infiltration sink (tracked per step) ──
        # Cast to native float: numpy scalars are not JSON-serializable on
        # NumPy 2.x, and these volumes feed the mass-balance metadata.
        rain_m3 = float(rainfall_rate * dt * dx * dx * (gs * gs))
        infil_m3 = float(effective_infiltration * dt * dx * dx * (gs * gs))
        source_volume += rain_m3
        infil_volume += infil_m3

        # ── Velocity from momentum (safe division) ──
        wet = h > 0.01
        u = np.zeros_like(h)
        v = np.zeros_like(h)
        u[wet] = np.clip(hu[wet] / h[wet], -V_MAX, V_MAX)
        v[wet] = np.clip(hv[wet] / h[wet], -V_MAX, V_MAX)

        # ── Continuity: Rusanov with hydrostatic reconstruction ──
        z_r = np.roll(z_b, -1, 1)
        z_d = np.roll(z_b, -1, 0)
        h_r = np.roll(h, -1, 1)
        h_d = np.roll(h, -1, 0)
        u_r = np.roll(u, -1, 1)
        v_d = np.roll(v, -1, 0)
        c = np.sqrt(G * np.maximum(h, 0.0))
        c_r = np.sqrt(G * np.maximum(h_r, 0.0))
        c_d = np.sqrt(G * np.maximum(h_d, 0.0))
        a_x = np.maximum(np.abs(u) + c, np.abs(u_r) + c_r)
        a_y = np.maximum(np.abs(v) + c, np.abs(v_d) + c_d)
        zf_x = np.maximum(z_b, z_r)
        zf_y = np.maximum(z_b, z_d)
        hL_x = np.maximum((z_b + h) - zf_x, 0.0)
        hR_x = np.maximum((z_r + h_r) - zf_x, 0.0)
        hL_y = np.maximum((z_b + h) - zf_y, 0.0)
        hR_y = np.maximum((z_d + h_d) - zf_y, 0.0)
        Fx = 0.5 * (h * u + h_r * u_r) - 0.5 * a_x * (hR_x - hL_x)
        Fy = 0.5 * (h * v + h_d * v_d) - 0.5 * a_y * (hR_y - hL_y)
        
        # Face fluxes: every interior face carries ONE flux value, so the
        # left/up faces are exact rolls of the right/down faces and the
        # divergence telescopes to zero on the wrap. No independent boundary
        # flux override is applied — a per-side override (e.g. Fxl[:,0] ≠
        # Fx[:,-1]) breaks the pairwise face balance and injects or removes
        # water at the wrap faces every step.
        Fxl = np.roll(Fx, 1, axis=1)
        Fyu = np.roll(Fy, 1, axis=0)

        # ── Positivity-preserving flux limiter ──
        # A cell may not lose more water through outflow than it holds this
        # step (depth + rain − infiltration). Outflow face fluxes are scaled
        # down by the upwind cell's available-water ratio so no cell is drained
        # below zero, and the clip pump (mass created by draining a cell into
        # its neighbours and then zeroing it) disappears. Scaling FACE values
        # (not cell values) preserves exact conservation: each face still
        # appears once as an inflow and once as an outflow.
        avail = np.maximum(h + dt * rainfall_rate - dt * effective_infiltration, 0.0)
        outflow = (dt / dx) * (np.maximum(Fx, 0.0) + np.maximum(-Fxl, 0.0)
                               + np.maximum(Fy, 0.0) + np.maximum(-Fyu, 0.0))
        s_out = np.ones_like(h)
        lim = outflow > 1e-14
        s_out[lim] = np.minimum(1.0, avail[lim] / (outflow[lim] + 1e-300))
        fx = np.where(Fx > 0.0, s_out, np.roll(s_out, -1, axis=1))
        fy = np.where(Fy > 0.0, s_out, np.roll(s_out, -1, axis=0))
        Fx = Fx * fx
        Fy = Fy * fy
        Fxl = np.roll(Fx, 1, axis=1)
        Fyu = np.roll(Fy, 1, axis=0)

        h_new = h - (dt / dx) * ((Fx - Fxl) + (Fy - Fyu))
        h_new = h_new + dt * rainfall_rate - dt * effective_infiltration
        if (h_new < 0.0).any():
            clip_loss_volume += float(-h_new[h_new < 0.0].sum()) * dx * dx
        h_new = np.maximum(h_new, 0.0)
        if np.any(np.isnan(h_new)) or np.any(np.isinf(h_new)):
            h_new = np.nan_to_num(h_new, nan=0, posinf=0, neginf=0)
        wet_new = h_new > 0.01

        # ── Momentum update ──
        eta_field = z_b + h_new
        deta_dx = np.zeros_like(eta_field)
        deta_dy = np.zeros_like(eta_field)
        deta_dx[1:-1, 1:-1] = (eta_field[1:-1, 2:] - eta_field[1:-1, :-2]) / (2.0 * dx)
        deta_dy[1:-1, 1:-1] = (eta_field[2:, 1:-1] - eta_field[:-2, 1:-1]) / (2.0 * dx)
        pressure_x = -G * h_new * deta_dx
        pressure_y = -G * h_new * deta_dy

        u_mag = np.sqrt(u**2 + v**2)
        h_pow = np.power(np.maximum(h_new, 1e-6), 4.0/3.0)
        manning_coeff = G * n_cell**2 * u_mag / h_pow * wet_new
        denom = 1.0 + dt * manning_coeff

        hu_new = (hu + dt * pressure_x) / denom
        hv_new = (hv + dt * pressure_y) / denom

        u_new = np.zeros_like(hu_new)
        v_new = np.zeros_like(hv_new)
        u_new[wet_new] = np.clip(hu_new[wet_new] / np.maximum(h_new[wet_new], 1e-6), -V_MAX, V_MAX)
        v_new[wet_new] = np.clip(hv_new[wet_new] / np.maximum(h_new[wet_new], 1e-6), -V_MAX, V_MAX)
        hu_new = h_new * u_new
        hv_new = h_new * v_new

        # One-way outflow gates on boundary ring
        hu_new[:, 1] = h_new[:, 1] * np.minimum(u_new[:, 1], 0.0)
        hu_new[:, -2] = h_new[:, -2] * np.maximum(u_new[:, -2], 0.0)
        hv_new[1, :] = h_new[1, :] * np.minimum(v_new[1, :], 0.0)
        hv_new[-2, :] = h_new[-2, :] * np.maximum(v_new[-2, :], 0.0)

                # Boundary conditions: OUTFLOW-ONLY open domain. A boundary cell may
        # shed water down to the interior free-surface level (drain), but is
        # never raised above its flux-computed depth — the boundary can remove
        # water but can never create it. (np.minimum = drain only.)
        h_new[0, :] = np.minimum(h_new[0, :], np.maximum((z_b[1, :] + h_new[1, :]) - z_b[0, :], 0.0))
        h_new[-1, :] = np.minimum(h_new[-1, :], np.maximum((z_b[-2, :] + h_new[-2, :]) - z_b[-1, :], 0.0))
        h_new[:, 0] = np.minimum(h_new[:, 0], np.maximum((z_b[:, 1] + h_new[:, 1]) - z_b[:, 0], 0.0))
        h_new[:, -1] = np.minimum(h_new[:, -1], np.maximum((z_b[:, -2] + h_new[:, -2]) - z_b[:, -1], 0.0))
        hu_new[0, :] = hu_new[1, :]; hu_new[-1, :] = hu_new[-2, :]
        hu_new[:, 0] = hu_new[:, 1]; hu_new[:, -1] = hu_new[:, -2]
        hv_new[0, :] = hv_new[1, :]; hv_new[-1, :] = hv_new[-2, :]
        hv_new[:, 0] = hv_new[:, 1]; hv_new[:, -1] = hv_new[:, -2]

        h = h_new
        hu = hu_new
        hv = hv_new
        sim_t += dt
        step_i += 1

        # ── Snapshot ──
        if sim_t >= len(snapshots) * snap_interval_sec or sim_t >= total_sim_sec - 1e-6:
            u = np.divide(hu, np.maximum(h, 1e-6), out=np.zeros_like(h), where=h > 0.01)
            v = np.divide(hv, np.maximum(h, 1e-6), out=np.zeros_like(h), where=h > 0.01)
            u = np.clip(u, -V_MAX, V_MAX)
            v = np.clip(v, -V_MAX, V_MAX)

            snapshots.append({
                'water_depth': h.astype(np.float32),
                'velocity_x': u.astype(np.float32),
                'velocity_y': v.astype(np.float32),
                'time_hours': sim_t / 3600.0,
                'max_depth': float(h.max()),
                'flooded_cells': int((h > 0.01).sum()),
            })
            pct = min(100.0, sim_t / total_sim_sec * 100.0)
            print(f"  [{pct:5.1f}%] t={sim_t/3600:.1f}h | "
                  f"max={h.max():.2f}m | flooded={(h>0.01).sum():,}/{gs**2:,}")

    elapsed = time.time() - t0
    final = {
        'water_depth': h.astype(np.float32),
        'velocity_x': np.zeros_like(h, dtype=np.float32),
        'velocity_y': np.zeros_like(h, dtype=np.float32),
        'terrain': z_b.astype(np.float32),
        'max_depth': float(h.max()),
        'total_volume': float(h.sum() * dx * dx),
        'flooded_cells': int((h > 0.01).sum()),
    }
    wet = h > 0.01
    ux_c = np.divide(hu, np.maximum(h, 1e-6), out=np.zeros_like(h), where=wet)
    uy_c = np.divide(hv, np.maximum(h, 1e-6), out=np.zeros_like(h), where=wet)
    final['velocity_x'][wet] = np.clip(ux_c[wet], -V_MAX, V_MAX)
    final['velocity_y'][wet] = np.clip(uy_c[wet], -V_MAX, V_MAX)

    # ── Mass-balance reconciliation (all values native float — numpy
    #    scalars are not JSON-serializable on NumPy 2.x) ──
    initial_volume = float(h_init) * gs * gs * dx * dx
    final_volume = float(h.sum() * dx * dx)
    delta_storage = float(final_volume - initial_volume)
    
    # Algebraic outflow: everything that left the domain
    outflow_volume = float(max(0.0, initial_volume + source_volume - infil_volume - clip_loss_volume - final_volume))
    
    mass_input = float(source_volume)
    mass_output = float(infil_volume + outflow_volume + clip_loss_volume + delta_storage)
    if mass_input > 1e-12:
        mass_error = float(abs(mass_input - mass_output) / mass_input * 100.0)
    else:
        mass_error = float(abs(mass_output) / max(abs(delta_storage), 1e-12) * 100.0)
    
    completed = bool(sim_t >= total_sim_sec - 1e-6)
    simulated_time_hours = float(sim_t / 3600.0)
    
    flood_pct = final['flooded_cells'] / (gs * gs) * 100
    print(f"\n[DONE] {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"[DONE] max_depth={final['max_depth']:.2f}m, "
          f"volume={final['total_volume']/1e6:.1f}M m³, "
          f"flooded={flood_pct:.1f}% of grid")
    print(f"[MASS BALANCE] rainfall={source_volume/1e6:.2f}M m³, "
          f"infiltration={infil_volume/1e6:.2f}M m³, "
          f"outflow={outflow_volume/1e6:.2f}M m³, "
          f"clip_loss={clip_loss_volume/1e6:.6f}M m³")
    print(f"[MASS BALANCE] Δstorage={delta_storage/1e6:.2f}M m³, "
          f"closure_error={mass_error:.4f}%")
    if not completed:
        print(f"[WARNING] Simulation truncated at t={simulated_time_hours:.2f}h "
              f"(requested {duration_hours:.1f}h) — results are partial")

    return {
        'final': final, 'snapshots': snapshots,
        'params': {'grid_size': gs, 'rainfall_mm': rainfall_mm,
                    'duration_hours': duration_hours,
                    'lat': lat, 'lon': lon, 'soil_saturation': soil_saturation,
                    'cell_size_m': dx},
        'metadata': {'elapsed_seconds': elapsed,
                      'total_steps': step_i, 'num_snapshots': len(snapshots),
                      'model': 'local_inertial_swe',
                      'solver': 'bates_2010_semi_implicit',
                      'completed': completed,
                      'simulated_time_hours': simulated_time_hours,
                      'requested_time_hours': duration_hours,
                      'mass_balance': {
                          'rainfall_volume_m3': source_volume,
                          'infiltration_volume_m3': infil_volume,
                          'outflow_volume_m3': outflow_volume,
                          'clip_loss_volume_m3': clip_loss_volume,
                          'delta_storage_m3': delta_storage,
                          'closure_error_percent': mass_error
                      }}
    }


EMBEDDED_PARAMS = None

def _load_params():
    """Load params from EMBEDDED_PARAMS or from params.json anywhere on the runner."""
    if EMBEDDED_PARAMS:
        try:
            if isinstance(EMBEDDED_PARAMS, dict):
                return EMBEDDED_PARAMS
            return json.loads(EMBEDDED_PARAMS)
        except Exception:
            pass
    candidates = ['params.json', '/kaggle/working/params.json', '/kaggle/input/params.json']
    src = '/kaggle/src'
    if os.path.isdir(src):
        for root, _dirs, files in os.walk(src):
            if 'params.json' in files:
                candidates.append(os.path.join(root, 'params.json'))
    for p in candidates:
        try:
            if os.path.exists(p):
                with open(p) as f:
                    return json.load(f)
        except Exception:
            continue
    return None


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Flood Simulation (Local-Inertial)")
    print("=" * 60)

    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(_json_safe(params), indent=2)}")
    else:
        params = {
            'lat': 29.76, 'lon': -95.37,
            'rainfall_mm': 400,
            'duration_hours': 12,
            'grid_size': 256,
            'soil_saturation': 0.8,
        }

    try:
        passed, _final, _init, _err = verify_closed_box(gs=64, steps=500, tol=1e-9)
        if not passed:
            raise RuntimeError(
                f"Flood solver failed closed-box conservation check (|Δ|={_err:.2e}). "
                "Refusing to run a non-conservative simulation."
            )
        
        passed_wb, eta_err = verify_lake_at_rest(gs=64, steps=100, tol=1e-6)
        if not passed_wb:
            raise RuntimeError(
                f"Flood solver failed lake-at-rest well-balancing check (|Δη|={eta_err:.2e}). "
                "Water would spontaneously flow on sloped terrain."
            )

        result = run_flood_simulation(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)

        np.save(f'{out}/water_depth_final.npy', result['final']['water_depth'])
        np.save(f'{out}/velocity_x.npy', result['final']['velocity_x'])
        np.save(f'{out}/velocity_y.npy', result['final']['velocity_y'])
        np.save(f'{out}/terrain.npy', result['final']['terrain'])

        if result['snapshots']:
            snap_d = np.stack([s['water_depth'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_depth.npy', snap_d)
            snap_t = np.array([s['time_hours'] for s in result['snapshots']])
            np.save(f'{out}/snapshot_times.npy', snap_t)
            snap_vx = np.stack([s['velocity_x'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_vx.npy', snap_vx)
            snap_vy = np.stack([s['velocity_y'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_vy.npy', snap_vy)
        else:
            np.save(f'{out}/snapshots_depth.npy', np.expand_dims(result['final']['water_depth'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
            np.save(f'{out}/snapshots_vx.npy', np.expand_dims(result['final']['velocity_x'], axis=0))
            np.save(f'{out}/snapshots_vy.npy', np.expand_dims(result['final']['velocity_y'], axis=0))

        meta = {
            'params': result['params'], 'metadata': result['metadata'],
            'final_stats': {'max_depth_m': result['final']['max_depth'],
                            'total_volume_m3': result['final']['total_volume'],
                            'flooded_cells': result['final']['flooded_cells'],
                            'flooded_pct': result['final']['flooded_cells'] / (result['params']['grid_size']**2) * 100},
            'snapshot_count': len(result['snapshots']),
            'completed': result['metadata']['completed'],
            'simulated_time_hours': result['metadata']['simulated_time_hours'],
            'mass_balance': result['metadata']['mass_balance'],
        }
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(_json_safe(meta), f, indent=2)

        print(f"\n{'='*60}")
        print("SIMULATION COMPLETE")
        print(f"Max depth: {result['final']['max_depth']:.2f} m")
        print(f"Volume: {result['final']['total_volume']/1e6:.1f} million m³")
        print(f"Flooded: {result['final']['flooded_cells']:,} / {result['params']['grid_size']**2:,} "
              f"({meta['final_stats']['flooded_pct']:.1f}%)")
        print(f"Time: {result['metadata']['elapsed_seconds']:.1f}s")
        print(f"Completed: {result['metadata']['completed']}")
        print(f"Simulated: {result['metadata']['simulated_time_hours']:.2f}h / "
              f"{result['metadata']['requested_time_hours']:.1f}h")
        print(f"Mass balance closure error: {result['metadata']['mass_balance']['closure_error_percent']:.4f}%")
        print(f"Snapshots: {len(result['snapshots'])}")
        print(f"Files: {os.listdir(out)}")
        print("=" * 60)

    except Exception as e:
        print(f"\n[ERROR] {e}")
        traceback.print_exc()
        with open('/kaggle/working/error.log', 'w') as f:
            traceback.print_exc(file=f)
        raise


if __name__ == '__main__':
    main()