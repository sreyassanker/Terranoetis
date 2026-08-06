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

State: h[NY,NX], qx[NY,NX+1], qy[NY+1,NX] (face-centred fluxes on a C-grid)

Author: Terranoetis / Freebuff
"""

import json
import os
import time
import traceback
import numpy as np

# ── Physical constants ──────────────────────────────────────────────
G = 9.81              # m/s² — gravitational acceleration
MANNING_N = 0.035     # mixed land cover default
INFILTRATION_MM_HR = 10.0  # Green-Ampt constant loss rate (mm/hr)
CFL = 0.5             # CFL number for adaptive timestep
V_MAX = 5.0           # m/s — physical velocity cap for flood waters


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


def run_flood_simulation(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    rainfall_mm = float(params.get('rainfall_mm', 500))
    duration_hours = float(params.get('duration_hours', 14))
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
        # Fallback: gentle synthetic terrain (no dam breach)
        yy, xx = np.meshgrid(np.linspace(-1, 1, gs), np.linspace(-1, 1, gs), indexing='ij')
        z_b = 5.0 + 20.0 * (np.abs(yy) + np.abs(xx)) * 0.5
        z_b += np.random.RandomState(42).randn(gs, gs) * 0.5
        print(f"[TERRAIN] Synthetic terrain {gs}x{gs}, dx={dx:.0f}m")

    # Checksum verification
    print(f"[TERRAIN] elev min={z_b.min():.1f} max={z_b.max():.1f} mean={z_b.mean():.1f} m")

    # ── Rainfall rate (m/s) ──
    # Derive per-hour rate from total: rate = total_mm / duration_hours
    rainfall_rate = (rainfall_mm / 1000.0) / (duration_hours * 3600.0)  # m/s
    infiltration_rate = (INFILTRATION_MM_HR / 1000.0) / 3600.0  # m/s
    # Soil saturation reduces infiltration (higher sat = less loss)
    effective_infiltration = infiltration_rate * (1.0 - soil_saturation * 0.7)
    print(f"[RAIN] {rainfall_mm:.0f} mm over {duration_hours:.1f}h = "
          f"{rainfall_rate*3600*1000:.1f} mm/hr, infiltration {effective_infiltration*3600*1000:.1f} mm/hr")

    # ── State ──
    h = np.zeros((gs, gs), dtype=np.float64)  # water depth (m)
    qx = np.zeros((gs, gs + 1), dtype=np.float64)  # x-face flux (m²/s)
    qy = np.zeros((gs + 1, gs), dtype=np.float64)  # y-face flux (m²/s)

    # Initial wet ground (saturated soil) so water pools broadly
    h_init = 0.05 * soil_saturation
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
        # Wave speed = sqrt(g * max(h)) + velocity
        max_h = float(h.max())
        wave_speed = np.sqrt(G * max_h) + V_MAX
        dt = CFL * dx / max(wave_speed, 1e-6)
        dt = min(dt, 1.0)  # cap at 1s

        # ── Local-inertial momentum (face-centred) ──
        # Water surface elevation at cell centres
        eta = z_b + h

        # x-face water depth (average of adjacent cells)
        hx = 0.5 * (h[:, :-1] + h[:, 1:])
        # x-face surface elevation
        etax = 0.5 * (eta[:, :-1] + eta[:, 1:])
        # x-face bed slope (downward gradient)
        dzdx = (z_b[:, 1:] - z_b[:, :-1]) / dx
        # x-face water surface gradient
        detadx = (eta[:, 1:] - eta[:, :-1]) / dx

        # y-face water depth
        hy = 0.5 * (h[:-1, :] + h[1:, :])
        # y-face surface elevation
        etay = 0.5 * (eta[:-1, :] + eta[1:, :])
        # y-face bed slope
        dzdy = (z_b[1:, :] - z_b[:-1, :]) / dx
        # y-face water surface gradient
        detady = (eta[1:, :] - eta[:-1, :]) / dx

        # Local-inertial momentum (Bates et al. 2010):
        #   dq/dt = -g*h*(deta/dx) - g*n²*q*|q|/h^(7/3)
        # Semi-implicit friction:
        #   q_new = (q + g*h*dt*S) / (1 + g*n²*dt*|q|/h^(7/3))
        # where S = -deta/dx (downslope driving gradient)

        # x-momentum
        Sx = -detadx  # driving gradient (positive = downslope)
        hx_safe = np.maximum(hx, 1e-6)
        # Friction denominator (semi-implicit)
        denom_x = 1.0 + G * MANNING_N**2 * dt * np.abs(qx[:, 1:-1]) / hx_safe**(7.0/3.0)
        # Update flux
        qx_new = (qx[:, 1:-1] + G * hx_safe * dt * Sx) / denom_x
        # Cap velocity
        ux = qx_new / hx_safe
        ux = np.clip(ux, -V_MAX, V_MAX)
        qx_new = ux * hx_safe
        qx[:, 1:-1] = qx_new
        # Boundary: zero flux at edges
        qx[:, 0] = 0.0
        qx[:, -1] = 0.0

        # y-momentum
        Sy = -detady
        hy_safe = np.maximum(hy, 1e-6)
        denom_y = 1.0 + G * MANNING_N**2 * dt * np.abs(qy[1:-1, :]) / hy_safe**(7.0/3.0)
        qy_new = (qy[1:-1, :] + G * hy_safe * dt * Sy) / denom_y
        uy = qy_new / hy_safe
        uy = np.clip(uy, -V_MAX, V_MAX)
        qy_new = uy * hy_safe
        qy[1:-1, :] = qy_new
        qy[0, :] = 0.0
        qy[-1, :] = 0.0

        # ── Continuity ──
        # dh/dt = rainfall - infiltration + flux divergence
        # Flux divergence: (qx[i+1] - qx[i])/dx + (qy[j+1] - qy[j])/dx
        dqx = (qx[:, 1:] - qx[:, :-1]) / dx
        dqy = (qy[1:, :] - qy[:-1, :]) / dx

        h_new = h + dt * (rainfall_rate - effective_infiltration - dqx - dqy)

        # Positivity
        h_new = np.maximum(h_new, 0.0)

        # NaN guard
        if np.any(np.isnan(h_new)) or np.any(np.isinf(h_new)):
            h_new = np.nan_to_num(h_new, nan=0, posinf=0, neginf=0)

        h = h_new
        sim_t += dt
        step_i += 1

        # ── Snapshot ──
        if sim_t >= len(snapshots) * snap_interval_sec or sim_t >= total_sim_sec - 1e-6:
            # Compute velocity field for output
            u = np.zeros_like(h)
            v = np.zeros_like(h)
            wet = h > 0.01
            # Face velocities -> cell centres
            ux_c = 0.5 * (qx[:, :-1] + qx[:, 1:]) / np.maximum(h, 1e-6)
            uy_c = 0.5 * (qy[:-1, :] + qy[1:, :]) / np.maximum(h, 1e-6)
            u[wet] = ux_c[wet]
            v[wet] = uy_c[wet]
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
    # Final velocity
    wet = h > 0.01
    ux_c = 0.5 * (qx[:, :-1] + qx[:, 1:]) / np.maximum(h, 1e-6)
    uy_c = 0.5 * (qy[:-1, :] + qy[1:, :]) / np.maximum(h, 1e-6)
    final['velocity_x'][wet] = np.clip(ux_c[wet], -V_MAX, V_MAX)
    final['velocity_y'][wet] = np.clip(uy_c[wet], -V_MAX, V_MAX)

    flood_pct = final['flooded_cells'] / (gs * gs) * 100
    print(f"\n[DONE] {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"[DONE] max_depth={final['max_depth']:.2f}m, "
          f"volume={final['total_volume']/1e6:.1f}M m³, "
          f"flooded={flood_pct:.1f}% of grid")

    return {
        'final': final, 'snapshots': snapshots,
        'params': {'grid_size': gs, 'rainfall_mm': rainfall_mm,
                    'duration_hours': duration_hours,
                    'lat': lat, 'lon': lon, 'soil_saturation': soil_saturation,
                    'cell_size_m': dx},
        'metadata': {'elapsed_seconds': elapsed,
                      'total_steps': step_i, 'num_snapshots': len(snapshots),
                      'model': 'local_inertial_swe',
                      'solver': 'bates_2010'},
    }


# simRunner injects the run's JSON params here at push time (Kaggle only
# uploads the code file, so params cannot be passed as a sibling file).
EMBEDDED_PARAMS = None

def _load_params():
    """Load params from EMBEDDED_PARAMS (injected into main.py at push time)
    or from params.json anywhere on the runner."""
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
        print(f"[PARAMS] Loaded: {json.dumps(params, indent=2)}")
    else:
        params = {
            'lat': 29.76, 'lon': -95.37,
            'rainfall_mm': 500,
            'duration_hours': 14,
            'grid_size': 256,
            'soil_saturation': 0.8,
        }

    try:
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
        }
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(meta, f, indent=2)

        print(f"\n{'='*60}")
        print("SIMULATION COMPLETE")
        print(f"Max depth: {result['final']['max_depth']:.2f} m")
        print(f"Volume: {result['final']['total_volume']/1e6:.1f} million m³")
        print(f"Flooded: {result['final']['flooded_cells']:,} / {result['params']['grid_size']**2:,} "
              f"({meta['final_stats']['flooded_pct']:.1f}%)")
        print(f"Time: {result['metadata']['elapsed_seconds']:.1f}s")
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