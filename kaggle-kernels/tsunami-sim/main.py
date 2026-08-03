"""
Terranoetis — Tsunami Wave Propagation Simulation
2D shallow water equations (continuity + momentum) on ocean bathymetry,
solved with a Lax-Friedrichs finite-difference scheme.

Physics:
  - Continuity:   ∂η/∂t + ∇·(H·u) = 0          (H = still-water depth + η)
  - Momentum:     ∂u/∂t + ··· = -g·∇η   (long-wave gravity restoring force)
  - Wave speed:   c = sqrt(g·H)                  (real shallow-water celerity)
  - Initial source: simplified Okada-style elastic dislocation uplift —
    vertical seafloor displacement from finite-fault slip transferred to
    the water surface (Okada 1985 in spirit; here a rectangular fault
    patch with dip-slip, azimuthal lobes, and moment-magnitude scaling).

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

def generate_bathymetry(N):
    """Generate synthetic ocean bathymetry (depth in meters, positive down)."""
    y, x = np.meshgrid(np.linspace(-1, 1, N), np.linspace(-1, 1, N))
    # Deep ocean in center, shallower at edges (coast)
    bathy = 4000 * (1 - 0.3 * (x**2 + y**2))
    bathy += np.random.randn(N, N).astype(np.float64) * 100
    return np.clip(bathy, 50, 6000)

def simulate_tsunami(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    magnitude = float(params.get('magnitude', 8.5))
    displace_m = float(params.get('seafloor_displacement_m', 5))
    duration_min = float(params.get('duration_minutes', 30))
    lat = float(params.get('lat', 35.0))
    lon = float(params.get('lon', 140.0))

    print(f"\n{'='*60}")
    print("TERRANOETIS — TSUNAMI WAVE PROPAGATION")
    print(f"{'='*60}")
    print(f"M{magnitude:.1f} source | displacement={displace_m}m | grid={gs}x{gs}")

    bathy = generate_bathymetry(gs)
    g = 9.81
    extent_km = float(params.get('extent_km', 0.0))
    dx = (extent_km * 1000.0 / gs) if extent_km > 0 else 5000.0  # 5 km cells
    # CFL-compliant timestep from the physical long-wave celerity sqrt(g·Hmax):
    #   dt = 0.9 · dx / (sqrt(2) · c_max);  2D LF needs √2·c·dt/dx ≤ ~1.
    _c_max0 = np.sqrt(g * max(np.max(bathy), 1.0))
    dt = float(params.get('dt_s', 0.9 * dx / (np.sqrt(2.0) * _c_max0)))

    # h represents free-surface elevation above still-water level (η)
    # Still-water depth: bathy is positive-down so ocean depth B = +bathy.
    # Total water column H = B + η.

    # ── Initial condition: Okada (1985)-style finite-fault dislocation ──
    # A rectangular dip-slip rupture: elliptical slip patch with uplift on
    # the hanging-wall side and subsidence on the footwall side, vertical
    # seafloor displacement transferred 1:1 to the free surface.
    # Amplitude scales with seismic moment M0 = 10^(1.5·M + 9.1).
    cy, cx = gs // 2, gs // 2
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')

    strike_deg = float(params.get('rupture_strike_deg', 135.0))
    # Seismic moment (N·m) and moment ratio relative to a reference Mw 8.0
    M0 = 10.0 ** (1.5 * magnitude + 9.1)
    M0_ref = 10.0 ** (1.5 * 8.0 + 9.1)
    # Characteristic slip scales as sqrt(M0 ratio) for a fixed-fault-area source
    displace_amp = displace_m * np.sqrt(M0 / M0_ref) / 5.6  # normalized so
    # that seafloor_displacement_m ≈ max uplift at the *reference* magnitude

    # Fault-aligned coordinates (km): along-strike and along-dip
    th = np.radians(strike_deg)
    dxm = (x - cx) * dx            # meters
    dym = (y - cy) * dx
    along = (dxm * np.cos(th) + dym * np.sin(th)) / 1000.0     # km, strike
    across = (-dxm * np.sin(th) + dym * np.cos(th)) / 1000.0   # km, dip
    # Rupture dimensions grow with magnitude (Wells & Coppersmith style)
    half_len_km = 20.0 * 10.0 ** (0.5 * (magnitude - 8.0))     # ~20 km @ M8
    half_wid_km = max(half_len_km * 0.4, 8.0)
    # Clip each elliptical factor *before* multiplying so the patch is
    # bounded [0, 1] everywhere (do not clip the product — the product of
    # two large factors makes huge values when both |along|, |across| > 1).
    slip_along = np.clip(1.0 - (along / half_len_km) ** 2, 0.0, 1.0)
    slip_across = np.clip(1.0 - (across / half_wid_km) ** 2, 0.0, 1.0)
    slip_patch = slip_along * slip_across
    # Dip-slip asymmetry: uplift lobe (hanging wall) / subsidence (footwall)
    uplift_lobe = np.tanh(across / (0.5 * half_wid_km))

    # Displace the sea surface by the seafloor displacement (deep ocean only)
    is_ocean = bathy > 50.0
    h = np.where(is_ocean, displace_amp * slip_patch * uplift_lobe, 0.0)
    print(f"[OKADA] M0={M0:.2e} N·m | strike={strike_deg:.0f}° | "
          f"L={2*half_len_km:.0f}km W={2*half_wid_km:.0f}km | "
          f"max uplift={h.max():+.2f} m")

    # Momentum (depth-integrated): hu = H·u, hv = H·v  [m²/s]
    hu = np.zeros((gs, gs), dtype=np.float64)
    hv = np.zeros((gs, gs), dtype=np.float64)

    # Still-water depth (positive down bathymetry → positive depth B)
    B = np.maximum(bathy, 0.0)

    # CFL for long waves: c_max = sqrt(g·H_max); the 2D staggered LF scheme
    # is stable for sqrt(2)·c_max·dt/dx ≤ ~1. Report (and honor) it.
    c_max = np.sqrt(g * max(B.max(), 1.0))
    cfl_wave = np.sqrt(2.0) * c_max * dt / dx
    print(f"[CFL] c_max={c_max:.0f} m/s | dt={dt}s dx={dx:.0f}m | "
          f"√2·c·dt/dx={cfl_wave:.2f} ({'OK' if cfl_wave <= 1.0 else 'UNSTABLE!'})")
    # Manning friction for wave damping (physical, depth-dependent)
    n_manning = 0.03

    total_steps = int(duration_min * 60 / dt)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    print(f"[SIM] {total_steps} steps ({duration_min:.0f} min)...")
    wallclock_max = float(params.get('wallclock_max_sec', 480))
    print(f"Wall-clock cap: {wallclock_max:.0f}s")
    for step_i in range(total_steps):
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at step {step_i} (elapsed {time.time()-t0:.0f}s)")
            break
        # ── Lax-Friedrichs neighbors for all three conserved fields ──
        # Zero-gradient (open/radiating) boundary: copy the edge value outward
        h_r = np.roll(h, -1, 1); h_r[:, -1] = h[:, -1]
        h_l = np.roll(h, 1, 1); h_l[:, 0] = h[:, 0]
        h_d = np.roll(h, -1, 0); h_d[-1, :] = h[-1, :]
        h_u = np.roll(h, 1, 0); h_u[0, :] = h[0, :]
        hu_r = np.roll(hu, -1, 1); hu_r[:, -1] = hu[:, -1]
        hu_l = np.roll(hu, 1, 1); hu_l[:, 0] = hu[:, 0]
        hu_d = np.roll(hu, -1, 0); hu_d[-1, :] = hu[-1, :]
        hu_u = np.roll(hu, 1, 0); hu_u[0, :] = hu[0, :]
        hv_r = np.roll(hv, -1, 1); hv_r[:, -1] = hv[:, -1]
        hv_l = np.roll(hv, 1, 1); hv_l[:, 0] = hv[:, 0]
        hv_d = np.roll(hv, -1, 0); hv_d[-1, :] = hv[-1, :]
        hv_u = np.roll(hv, 1, 0); hv_u[0, :] = hv[0, :]

        h_avg = 0.25 * (h_r + h_l + h_u + h_d)
        hu_avg = 0.25 * (hu_r + hu_l + hu_u + hu_d)
        hv_avg = 0.25 * (hv_r + hv_l + hv_u + hv_d)

        # Total water column H = B + η (still depth + surface elevation)
        H = np.maximum(B + h, 0.1)

        # ── CONTINUITY:  ∂η/∂t = −∇·(Hu)  ────────────────────────────
        # divergence of the discharge field (centered)
        div_Hu = (hu_r - hu_l + hv_d - hv_u) / (2.0 * dx)
        h = h_avg - dt * div_Hu

        # ── MOMENTUM:  ∂(Hu)/∂t = −g·H·∇η  − friction ────────────────
        # Free-surface slope (the actual wave-driving term; gradient of η)
        deta_dx = (h_r - h_l) / (2.0 * dx)
        deta_dy = (h_d - h_u) / (2.0 * dx)

        # Chézy/Manning-style quadratic friction:  src = −g·n²·|V|·V / H^(4/3)
        # linearized about the local surface speed so no singularity at H→0
        u_mag_sq = (hu**2 + hv**2) / (H * H)
        u_speed = np.sqrt(u_mag_sq)
        manning_damp = g * n_manning**2 * u_speed / np.power(H, 4.0 / 3.0)
        manning_damp = np.clip(manning_damp, 0.0, 0.02)  # cap → no blow-up

        hu = (hu_avg - dt * g * H * deta_dx) / (1.0 + dt * manning_damp)
        hv = (hv_avg - dt * g * H * deta_dy) / (1.0 + dt * manning_damp)

        # η can go negative (troughs) — physical; just remove NaN artifacts
        h = np.where(np.isfinite(h), h, 0.0)
        hu = np.where(np.isfinite(hu), hu, 0.0)
        hv = np.where(np.isfinite(hv), hv, 0.0)
        # Kill momentum on nearly-dry cells (wetting/drying threshold)
        dry_mask = (B + h) < 0.1
        hu = np.where(dry_mask, 0.0, hu)
        hv = np.where(dry_mask, 0.0, hv)

        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            wave_height = float(np.max(np.abs(h)))
            # Realistic propagation speed reported = sqrt(g·H) (m/s)
            prop_celerity = float(np.sqrt(g * np.max(np.maximum(B + h, 0.1))))
            snapshots.append({'water_height': h.copy().astype(np.float32),
                              'time_minutes': round(step_i * dt / 60, 2),
                              'wave_height_m': wave_height,
                              'propagation_speed_ms': prop_celerity})
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                max_speed = float(np.max(np.sqrt(hu**2 + hv**2) / np.maximum(B + h, 0.1)))
                print(f"  [{pct:5.1f}%] t={step_i*dt/60:.1f}min | max_η={wave_height:.2f}m | "
                      f"u_max={max_speed:.2f} m/s | c=√(gH)={prop_celerity:.0f} m/s")

    elapsed = time.time() - t0
    # Potential energy  ½·g·η²·cell_area  +  kinetic  ½·H·|u|²·cell_area
    H_final = np.maximum(B + h, 0.1)
    pe = np.sum(0.5 * g * h**2) * dx**2
    ke = np.sum(0.5 * H_final * ((hu**2 + hv**2) / H_final**2)) * dx**2
    final = {'water_height': h.astype(np.float32), 'bathymetry': bathy.astype(np.float32),
             'max_wave_height': float(np.max(np.abs(h))),
             'total_energy': float(pe + ke),
             'potential_energy_J': float(pe), 'kinetic_energy_J': float(ke),
             'c_max_longwave_ms': float(np.sqrt(g * max(B.max(), 1.0)))}
    print(f"\n[DONE] {elapsed:.1f}s | max_wave={final['max_wave_height']:.2f}m | "
          f"E={final['total_energy']/1e9:.2f} GJ")
    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'magnitude': magnitude, 'seafloor_displacement_m': displace_m,
                       'duration_minutes': duration_min, 'lat': lat, 'lon': lon,
                       'cell_size_m': dx},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'model': 'shallow_water_equations_lax_friedrichs',
                         'source_model': 'okada_finite_fault_dislocation',
                         'wave_speed_formula': 'sqrt(g*H)'}}


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
    print("TERRANOETIS — Kaggle Tsunami Wave Propagation Simulation")
    print("=" * 60)
    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(params, indent=2)}")
    else:
        params = {'grid_size': 256, 'magnitude': 8.5, 'seafloor_displacement_m': 5,
                  'duration_minutes': 30, 'lat': 35.0, 'lon': 140.0}
    try:
        result = simulate_tsunami(params)
        out = '/kaggle/working'; os.makedirs(out, exist_ok=True)
        np.save(f'{out}/water_height.npy', result['final']['water_height'])
        np.save(f'{out}/bathymetry.npy', result['final']['bathymetry'])
        if result['snapshots']:
            snap_d = np.stack([s['water_height'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_height.npy', snap_d)
            np.save(f'{out}/snapshot_times.npy', np.array([s['time_minutes'] for s in result['snapshots']]))
        else:
            np.save(f'{out}/snapshots_height.npy', np.expand_dims(result['final']['water_height'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_wave_height': result['final']['max_wave_height'],
                                'total_energy': result['final']['total_energy']},
                'snapshot_count': len(result['snapshots'])}
        with open(f'{out}/metadata.json', 'w') as f: json.dump(meta, f, indent=2)
        print(f"\n{'='*60}\nSIMULATION COMPLETE\n{'='*60}")
    except Exception as e:
        print(f"\n[ERROR] {e}"); traceback.print_exc()
        with open('/kaggle/working/error.log', 'w') as f: traceback.print_exc(file=f)
        raise

if __name__ == '__main__':
    main()
