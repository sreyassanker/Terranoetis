"""
Terranoetis — Wildfire Spread Simulation
Cellular Automata with Rothermel-inspired ignition probability.

Each cell has: fuel load, moisture, temperature, slope, wind effect.
Fire spreads probabilistically based on neighbor fuel, wind, and slope.

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

def generate_fuel_map(N):
    """Generate synthetic fuel map: 0-1 fuel load with spatial variation."""
    noise = np.random.rand(N, N).astype(np.float64)
    from scipy.ndimage import gaussian_filter
    fuel = gaussian_filter(noise, sigma=N // 20)
    fuel = (fuel - fuel.min()) / (fuel.max() - fuel.min() + 1e-8)
    return fuel

def generate_slope_map(N):
    """Generate synthetic terrain slope (degrees)."""
    y, x = np.meshgrid(np.linspace(-1, 1, N), np.linspace(-1, 1, N))
    slope = 15 * np.abs(np.sin(x * 3) * np.cos(y * 2))
    return slope

def simulate_fire(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    wind_speed = float(params.get('wind_speed_ms', 10))
    wind_dir = float(params.get('wind_dir_deg', 270))  # degrees from N
    humidity = float(params.get('humidity_pct', 20))
    hours = float(params.get('duration_hours', 2))
    ignition_x = int(params.get('ignition_x', gs // 2))
    ignition_y = int(params.get('ignition_y', gs // 2))

    print(f"\n{'='*60}")
    print("TERRANOETIS — WILDFIRE SPREAD SIMULATION")
    print(f"{'='*60}")
    print(f"Grid: {gs}x{gs} | Wind: {wind_speed}m/s @ {wind_dir}° | RH: {humidity}%")

    fuel = generate_fuel_map(gs)
    slope = generate_slope_map(gs)
    moisture = np.full((gs, gs), humidity / 100.0, dtype=np.float64)

    # Wind components (normalized)
    wind_rad = np.radians(wind_dir)
    wx = wind_speed * np.sin(wind_rad)  # east component
    wy = wind_speed * np.cos(wind_rad)  # north component

    # State: 0=unburned, 1=burning, 2=burned
    state = np.zeros((gs, gs), dtype=np.int8)
    intensity = np.zeros((gs, gs), dtype=np.float64)

    # Ignition
    state[ignition_y, ignition_x] = 1
    intensity[ignition_y, ignition_x] = 1.0
    print(f"[IGNITE] ({ignition_x}, {ignition_y})")

    dt_sim = 60  # each step = 1 minute
    total_steps = int(hours * 3600 / dt_sim)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    # Precompute wind offset vectors for 8 neighbors
    neighbor_deltas = []
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            if dx == 0 and dy == 0:
                continue
            neighbor_deltas.append((dy, dx))

    for step_i in range(total_steps):
        new_state = state.copy()
        new_intensity = intensity.copy()
        rand_field = np.random.rand(gs, gs)

        # Vectorized: accumulate ignition probability from all burning neighbors
        ignite_prob = np.zeros((gs, gs), dtype=np.float64)
        for dy, dx in neighbor_deltas:
            # Source (burning) region shifted by (-dy, -dx)
            sy_src = slice(max(0, -dy), min(gs, gs - dy))
            sx_src = slice(max(0, -dx), min(gs, gs - dx))
            # Target region
            sy = slice(max(0, dy), min(gs, gs + dy))
            sx = slice(max(0, dx), min(gs, gs + dx))

            burning = (state[sy_src, sx_src] == 1).astype(np.float64)
            nf = fuel[sy, sx]
            nm = moisture[sy, sx]
            ns = slope[sy, sx]

            base_prob = 0.02 * wind_speed * (1 + ns / 30)
            moisture_factor = np.clip(1 - nm * 2, 0, 1)
            wind_factor = np.clip(1 + 0.3 * (wx * dx + wy * dy) / (wind_speed + 1), 0, None)
            prob = base_prob * nf * moisture_factor * wind_factor * burning
            ignite_prob[sy, sx] += np.clip(prob, 0, 0.8)

        ignite_prob = np.clip(ignite_prob, 0, 1.0)
        can_ignite = (state == 0)
        ignite = can_ignite & (rand_field < ignite_prob)
        new_state = np.where(ignite, 1, new_state)
        new_intensity = np.where(ignite, 1.0, new_intensity)

        # Burning → burned (after ~30 minutes)
        burnout = (state == 1) & (intensity < 0.5)
        new_state = np.where(burnout, 2, new_state)
        new_intensity = np.where(burnout, 0, new_intensity)

        # Decay burning intensity
        mask_burning = new_state == 1
        new_intensity = np.where(mask_burning, new_intensity * 0.98, new_intensity)

        state = new_state
        intensity = new_intensity

        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            burning_cells = int((state == 1).sum())
            burned_cells = int((state == 2).sum())
            pct = (step_i + 1) / total_steps * 100
            snapshots.append({
                'state': state.copy().astype(np.float32),
                'intensity': intensity.copy().astype(np.float32),
                'time_hours': step_i * dt_sim / 3600,
                'burning_cells': burning_cells,
                'burned_cells': burned_cells,
            })
            print(f"  [{pct:5.1f}%] t={step_i*dt_sim/60:.0f}min | burning={burning_cells:,} | burned={burned_cells:,}")

    elapsed = time.time() - t0
    final = {
        'state': state.astype(np.float32),
        'intensity': intensity.astype(np.float32),
        'fuel': fuel.astype(np.float32),
        'terrain': slope.astype(np.float32),
        'burning_cells': int((state == 1).sum()),
        'burned_cells': int((state == 2).sum()),
        'total_burned_pct': float((state == 2).sum()) / (gs * gs) * 100,
    }
    print(f"\n[DONE] {elapsed:.1f}s | burned={final['burned_cells']:,} ({final['total_burned_pct']:.1f}%)")
    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'wind_speed_ms': wind_speed, 'wind_dir_deg': wind_dir,
                       'humidity_pct': humidity, 'duration_hours': hours},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots)}}


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Wildfire Spread Simulation")
    print("=" * 60)
    params_path = 'params.json'
    if os.path.exists(params_path):
        with open(params_path) as f:
            params = json.load(f)
        print(f"[PARAMS] {json.dumps(params, indent=2)}")
    else:
        params = {'grid_size': 256, 'wind_speed_ms': 10, 'wind_dir_deg': 270,
                  'humidity_pct': 20, 'duration_hours': 2}

    try:
        result = simulate_fire(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/fire_state.npy', result['final']['state'])
        np.save(f'{out}/fire_intensity.npy', result['final']['intensity'])
        np.save(f'{out}/fuel_map.npy', result['final']['fuel'])
        np.save(f'{out}/terrain_slope.npy', result['final']['terrain'])
        snap_data = np.stack([s['state'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_state.npy', snap_data)
        np.save(f'{out}/snapshot_times.npy', np.array([s['time_hours'] for s in result['snapshots']]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'burning_cells': result['final']['burning_cells'],
                                'burned_cells': result['final']['burned_cells'],
                                'total_burned_pct': result['final']['total_burned_pct']},
                'snapshot_count': len(result['snapshots'])}
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(meta, f, indent=2)
        print(f"\n{'='*60}\nSIMULATION COMPLETE\n{'='*60}")
    except Exception as e:
        print(f"\n[ERROR] {e}")
        traceback.print_exc()
        with open('/kaggle/working/error.log', 'w') as f:
            traceback.print_exc(file=f)
        raise

if __name__ == '__main__':
    main()
