"""
Terranoetis — Tsunami Wave Propagation Simulation
2D SWE on ocean bathymetry with Lax-Friedrichs scheme.

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
    dx = 5000.0  # 5 km cells
    dt = 3.0     # 3 second time steps — Courant = √(g·h_max)·dt/dx < 1

    # h represents free-surface elevation above still-water level (η)
    # Still-water depth comes from bathymetry: H = max(0, -bathy) for ocean
    # Bathymetry is positive-down, so ocean cells have bathy > 0

    # Initial condition: seafloor displacement → water surface uplift
    cy, cx = gs // 2, gs // 2
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    r = np.sqrt((y - cy)**2 + (x - cx)**2).astype(np.float64)
    # Gaussian uplift only where there is ocean (bathy > 500m = deep water)
    is_ocean = bathy > 500.0
    h = np.where(is_ocean, displace_m * np.exp(-r**2 / (2 * (gs / 8)**2)), 0.0)

    hu = np.zeros((gs, gs), dtype=np.float64)
    hv = np.zeros((gs, gs), dtype=np.float64)

    total_steps = int(duration_min * 60 / dt)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    print(f"[SIM] {total_steps} steps ({duration_min:.0f} min)...")
    for step_i in range(total_steps):
        # Lax-Friedrichs
        h_r = np.roll(h, -1, 1); h_r[:, -1] = 0
        h_l = np.roll(h, 1, 1); h_l[:, 0] = 0
        h_d = np.roll(h, -1, 0); h_d[-1, :] = 0
        h_u = np.roll(h, 1, 0); h_u[0, :] = 0

        hu_r = np.roll(hu, -1, 1); hu_r[:, -1] = 0
        hu_l = np.roll(hu, 1, 1); hu_l[:, 0] = 0
        hu_d = np.roll(hu, -1, 0); hu_d[-1, :] = 0
        hu_u = np.roll(hu, 1, 0); hu_u[0, :] = 0
        hv_r = np.roll(hv, -1, 1); hv_r[:, -1] = 0
        hv_l = np.roll(hv, 1, 1); hv_l[:, 0] = 0
        hv_d = np.roll(hv, -1, 0); hv_d[-1, :] = 0
        hv_u = np.roll(hv, 1, 0); hv_u[0, :] = 0

        h_avg = 0.25 * (h_r + h_l + h_u + h_d)
        hu_avg = 0.25 * (hu_r + hu_l + hu_u + hu_d)
        hv_avg = 0.25 * (hv_r + hv_l + hv_u + hv_d)

        # Gravity source (bathymetry slope)
        dzdx = np.zeros_like(bathy)
        dzdy = np.zeros_like(bathy)
        dzdx[:, 1:] = -(bathy[:, 1:] - bathy[:, :-1]) / dx
        dzdy[1:, :] = -(bathy[1:, :] - bathy[:-1, :]) / dx

        # Total water depth = still-water bathymetry + free-surface elevation
        total_depth = np.maximum(bathy + h, 0.0)
        src_hu = -g * total_depth * dzdx
        src_hv = -g * total_depth * dzdy

        h = h_avg
        hu = hu_avg + dt * src_hu
        hv = hv_avg + dt * src_hv
        # h can go negative (wave troughs below still-water) — that's physical
        h = np.where(np.isfinite(h), h, 0)
        # Clamp momentum where water is essentially dry
        dry = total_depth < 0.1
        hu = np.where(dry, 0.0, hu)
        hv = np.where(dry, 0.0, hv)

        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            wave_height = float(np.max(np.abs(h)))
            snapshots.append({'water_height': h.copy().astype(np.float32),
                              'time_minutes': round(step_i * dt / 60, 2),
                              'wave_height_m': wave_height})
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                print(f"  [{pct:5.1f}%] t={step_i*dt/60:.1f}min | max_wave={wave_height:.2f}m")

    elapsed = time.time() - t0
    final = {'water_height': h.astype(np.float32), 'bathymetry': bathy.astype(np.float32),
             'max_wave_height': float(np.max(np.abs(h))), 'total_energy': float(np.sum(0.5 * h**2) * dx**2)}
    print(f"\n[DONE] {elapsed:.1f}s | max_wave={final['max_wave_height']:.2f}m")
    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'magnitude': magnitude, 'seafloor_displacement_m': displace_m,
                       'duration_minutes': duration_min, 'lat': lat, 'lon': lon},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots)}}


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Tsunami Simulation")
    print("=" * 60)
    params_path = 'params.json'
    if os.path.exists(params_path):
        with open(params_path) as f: params = json.load(f)
    else:
        params = {'grid_size': 256, 'magnitude': 8.5, 'seafloor_displacement_m': 5,
                  'duration_minutes': 30, 'lat': 35.0, 'lon': 140.0}
    try:
        result = simulate_tsunami(params)
        out = '/kaggle/working'; os.makedirs(out, exist_ok=True)
        np.save(f'{out}/water_height.npy', result['final']['water_height'])
        np.save(f'{out}/bathymetry.npy', result['final']['bathymetry'])
        snap_d = np.stack([s['water_height'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_height.npy', snap_d)
        np.save(f'{out}/snapshot_times.npy', np.array([s['time_minutes'] for s in result['snapshots']]))
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
