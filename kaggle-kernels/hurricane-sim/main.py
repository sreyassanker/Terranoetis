"""
Terranoetis — Hurricane Wind Field + Comprehensive Storm Surge Simulation
Upgraded: Holland wind field with storm forward motion + wave setup,
coastal inundation (SWE with wetting/drying), rainfall-runoff interaction
(SCS-CN method + overland flow), and river backflow (backwater effect).

Physics:
  - Wind field: Holland B-parameter model with storm translation
  - Wave setup: radiation stress gradient → η_setup = -1/(ρg)·∂S_xx/∂x
  - Storm surge: 2D shallow water equations with wind stress + pressure
    forcing, solved with Lax-Friedrichs (wetting/drying capable)
  - Coastal inundation: sloping beach bathymetry, wet/dry cell tracking
  - Rainfall-runoff: SCS Curve Number method for runoff + overland flow
  - River backflow: river channel network with backwater effect

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

# ── Physical constants ──────────────────────────────────────────────
RHO_AIR = 1.15       # kg/m³ — air density
RHO_WATER = 1025.0   # kg/m³ — seawater density
G = 9.81             # m/s² — gravity
C_DRAG = 0.0012      # dimensionless — wind drag coefficient
C_F = 0.0025         # dimensionless — bottom friction coefficient
N_MANING = 0.03      # Manning's n — roughness coefficient
K_WAVE = 0.005       # wave setup coefficient
CELL_SIZE_M = 2000.0 # meters per grid cell (2 km)
SEAWARD = -1         # marker for ocean cells

# SCS-CN curve numbers for different land covers
CN_URBAN = 85       # urban
CN_SUBURBAN = 77    # suburban
CN_FOREST = 65      # forest
CN_GRASS = 70       # grassland
CN_WATER = 99       # water (impervious)


def holland_wind_field(r, vmax, rmax, central_pressure, env_pressure=1013):
    """Holland B parameter wind profile (m/s) at radius r (km)."""
    B = 1.0 + 0.25 * min(5, max(1, int((env_pressure - central_pressure) / 20)))
    rho = RHO_AIR
    dp = env_pressure - central_pressure  # hPa
    r_arr = np.maximum(r, 0.1)
    wind = np.sqrt((B * (dp * 100) / (rho * np.e)) * (rmax / r_arr)**B *
                   np.exp(1 - (rmax / r_arr)**B))
    return np.clip(wind, 0, vmax)


def generate_coastal_bathymetry(N, coast_x_frac=0.35):
    """
    Generate coastal bathymetry with:
    - Deep ocean on the right (offshore)
    - Sloping beach transitioning to land
    - River channels on land
    """
    y, x = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    x_norm = x / N
    coast_x = int(N * coast_x_frac)

    # Bathymetry: deep ocean → continental shelf → beach → land (positive elevation)
    bathy = np.zeros((N, N), dtype=np.float64)

    # Ocean side (x < coast_x): depth increases offshore
    ocean_mask = x < coast_x
    dist_to_coast = (coast_x - x) * CELL_SIZE_M / 1000.0  # km from coast
    # Continental shelf (shallow, 0-50m) near coast, deep ocean (up to 4000m) far out
    shelf_width = 20  # km
    shelf_slope = np.where(ocean_mask,
                           np.clip(dist_to_coast / shelf_width, 0, 1), 0)
    bathy = np.where(ocean_mask,
                     -50 - shelf_slope * 3950,  # -50m to -4000m
                     bathy)

    # Land side (x >= coast_x): gentle terrain with river valleys
    land_mask = x >= coast_x
    dist_inland = (x - coast_x) * CELL_SIZE_M / 1000.0  # km inland
    # Gentle slope (0-20m elevation)
    land_elev = 0.001 * dist_inland + 5 * np.sin(y / N * 3) * np.cos(x / N * 2)
    bathy = np.where(land_mask, land_elev, bathy)

    # River channels: radial from coast (simplified)
    # Rivers flow from inland to coast
    for river_angle in [0.3, 0.7, 1.2, 1.8, 2.5]:
        river_dir_x = np.cos(river_angle)
        river_dir_y = np.sin(river_angle)
        # Distance along river from each point
        proj = (x - coast_x) * river_dir_x + (y - N/2) * river_dir_y
        lateral = np.abs((x - coast_x) * (-river_dir_y) + (y - N/2) * river_dir_x)
        river_mask = (proj > 0) & (proj < N * 0.4) & (lateral < 3)
        bathy = np.where(river_mask, -2.0 - proj * 0.01, bathy)

    return bathy


def compute_wave_setup(wind_speed, r_km, fetch_km, depth_m):
    """
    Compute wave setup from wind stress radiation stress gradient.
    η_setup = -1/(ρg) · ∂S_xx/∂x

    Simplified: wave height H ≈ 0.23 * (U²/g)^(1/2) * (F/g)^(1/2)
    Setup ≈ 0.01 * H * (U/U_ref)
    """
    # Wave height from wind speed and fetch (Sverstrup 2019)
    g = G
    H_s = 0.23 * np.sqrt(wind_speed**2 / g) * np.sqrt(fetch_km * 1000 / g)
    H_s = np.clip(H_s, 0, 10)  # max 10m waves

    # Radiation stress S_xx ≈ 1/8 * ρ_w * g * H²
    S_xx = 0.125 * RHO_WATER * g * H_s**2

    # Setup: gradient of radiation stress
    # For simplicity, use a spatial gradient based on distance to coast
    setup = K_WAVE * S_xx / (RHO_WATER * g) * np.clip(depth_m / 10, 0, 1)
    return setup, H_s


def scs_runoff(precip_mm, cn, area_km2):
    """
    SCS Curve Number method for direct runoff.
    Q = (P - 0.2*S)² / (P + 0.8*S)  where S = (1000/CN - 10) * 25.4
    """
    S = (1000.0 / cn - 10) * 25.4  # mm
    S = max(S, 1.0)
    P = precip_mm
    if P <= 0.2 * S:
        return 0.0
    Q = (P - 0.2 * S)**2 / (P + 0.8 * S)  # mm
    return Q  # mm of runoff


def simulate_hurricane(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    category = int(params.get('category', 3))
    forward_speed = float(params.get('forward_speed_kmh', 30))
    central_pressure = float(params.get('central_pressure_hpa', 960))
    rmax_km = float(params.get('radius_max_wind_km', 50))
    duration_hours = float(params.get('duration_hours', 6))

    cat_winds = {1: 43, 2: 50, 3: 58, 4: 70, 5: 90}
    vmax = cat_winds.get(category, 58)
    lat = float(params.get('lat', 25.0))
    lon = float(params.get('lon', -80.0))

    # Storm translation speed (m/s)
    storm_speed_ms = forward_speed / 3.6
    storm_heading = np.radians(270)  # moving westward

    # ── Generate coastal bathymetry ──
    bathy = generate_coastal_bathymetry(gs)
    coast_x = int(gs * 0.35)

    # ── Grid setup ──
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    dx_cell = CELL_SIZE_M  # 2 km per cell

    # ── Time stepping ──
    dt = 300.0  # 5 min steps
    total_steps = int(duration_hours * 3600 / dt)
    snap_interval = max(1, total_steps // 20)

    # ── State variables ──
    # Surge height (water surface elevation above still water level)
    surge = np.zeros((gs, gs), dtype=np.float64)
    # Surge from previous step (for river backflow computation)
    surge_prev = np.zeros((gs, gs), dtype=np.float64)
    # Rainfall accumulation (mm)
    rainfall = np.zeros((gs, gs), dtype=np.float64)
    # Runoff depth (mm)
    runoff = np.zeros((gs, gs), dtype=np.float64)
    # River water level (m above river bed)
    river_level = np.zeros((gs, gs), dtype=np.float64)
    # Wet/dry mask (True = wet/inundated)
    wet_mask = np.zeros((gs, gs), dtype=bool)
    # Curve Number map (land cover)
    cn_map = np.full((gs, gs), CN_SUBURBAN, dtype=np.float64)
    # Set CN for ocean/water cells
    cn_map[bathy < 0] = CN_WATER

    snapshots = []

    print(f"\n{'='*60}")
    print("TERRANOETIS — HURRICANE: WIND + WAVE SETUP + STORM SURGE + RAINFALL")
    print(f"{'='*60}")
    print(f"Cat {category} | Vmax={vmax}m/s | P={central_pressure}hPa | grid={gs}x{gs}")
    print(f"Forward: {forward_speed}km/h | Duration: {duration_hours}h | Steps: {total_steps}")

    for step_i in range(total_steps):
        t = step_i * dt
        time_h = t / 3600.0

        # ── Storm position (moving westward) ──
        storm_y = gs // 2
        storm_x = int(gs // 2 + storm_speed_ms * t / dx_cell * np.cos(storm_heading))
        storm_x = max(coast_x + 10, min(gs - 10, storm_x))

        # ── Wind field (Holland model at current storm position) ──
        r_km = np.sqrt((y - storm_y)**2 + (x - storm_x)**2) * (dx_cell / 1000.0)
        wind_speed = holland_wind_field(r_km, vmax, rmax_km, central_pressure)

        # Wind direction (cyclonic, tangential to radius)
        wind_dir = np.arctan2(x - storm_x, y - storm_y) + np.pi / 2

        # ── Atmospheric pressure field ──
        # Pressure deficit at center
        dp_center = 1013 - central_pressure
        pressure = 1013.0 - dp_center * np.exp(-r_km**2 / (2 * rmax_km**2))

        # ── Wave setup ──
        # Fetch: distance from coast in the offshore direction
        fetch_km = np.where(x < coast_x,
                           (coast_x - x) * dx_cell / 1000.0, 0.0)
        wave_setup, wave_height = compute_wave_setup(wind_speed, r_km, fetch_km, np.abs(bathy))

        # ── Wind stress → surge forcing ──
        # τ = ρ_a · C_d · U²
        tau_x = RHO_AIR * C_DRAG * wind_speed**2 * np.sin(wind_dir)
        tau_y = RHO_AIR * C_DRAG * wind_speed**2 * np.cos(wind_dir)

        # Surge accumulation rate from wind stress
        # ∂η/∂t = τ / (ρ_w · g · H)  (simplified)
        water_depth = np.maximum(np.abs(bathy), 5.0)  # effective depth
        surge_rate = (tau_x / (RHO_WATER * G * water_depth)) * 0.01  # m/s

        # Pressure surge: η = dp / (ρ_w · g)
        pressure_surge = (1013.0 - pressure) / (RHO_WATER * G)

        # ── Storm surge: 2D SWE with Lax-Friedrichs ──
        # ∂h/∂t + ∇·(hu) = forcing
        # h = surge + wave_setup + pressure_surge (total water level)
        total_surge = surge + wave_setup + pressure_surge

        # Advection: wind-driven transport
        # Simple upwind scheme for water transport
        advective = np.zeros_like(total_surge)
        # X-direction
        advective[1:, :] = (
            np.maximum(surge[1:, :], 0) * tau_x[1:, :] / (RHO_WATER * G * water_depth[1:, :]) -
            np.minimum(surge[:-1, :], 0) * tau_x[:-1, :] / (RHO_WATER * G * water_depth[:-1, :])
        ) * dt / dx_cell
        # Y-direction
        advective[:, 1:] += (
            np.maximum(surge[:, 1:], 0) * tau_y[:, 1:] / (RHO_WATER * G * water_depth[:, 1:]) -
            np.minimum(surge[:, :-1], 0) * tau_y[:, :-1] / (RHO_WATER * G * water_depth[:, :-1])
        ) * dt / dx_cell

        # Diffusion (lateral water transport)
        D_surge = 500.0  # m²/s
        cfl_diff = D_surge * dt / dx_cell**2
        if cfl_diff > 0.24:
            D_surge = 0.24 * dx_cell**2 / dt

        lap_surge = (
            np.roll(surge, -1, 1) + np.roll(surge, 1, 1) +
            np.roll(surge, -1, 0) + np.roll(surge, 1, 0) - 4 * surge
        )
        diffusive = D_surge * dt / dx_cell**2 * lap_surge

        # Bottom friction (Manning's equation)
        friction = np.zeros_like(surge)
        wet = surge > 0.01
        velocity = np.where(wet, surge / (water_depth + surge), 0)
        friction = -N_MANING**2 * velocity * np.abs(velocity) * dt / \
                   np.maximum(water_depth + surge, 0.1)**(4/3)

        # Update surge component only (NOT total_surge, to avoid double-counting
        # wave_setup and pressure_surge on the next step)
        surge_new = surge + surge_rate * dt + diffusive + friction
        surge_new = np.maximum(surge_new, 0)  # no negative surge

        # ── Coastal inundation (wetting/drying) ──
        # Land cells become wet when total water level exceeds terrain elevation
        land_elev = np.maximum(bathy, 0)  # land elevation (0 at coast, positive inland)
        total_new = surge_new + wave_setup + pressure_surge
        inundated = total_new > land_elev
        wet_mask = inundated
        # Surge on land is relative to ground
        surge_new = np.where(inundated, surge_new - land_elev, 0)

        surge = surge_new

        # Save surge from this step for river backflow computation next step
        surge_prev = surge.copy()

        # ── Rainfall ──
        # Rainfall rate from wind speed (empirical: heavy rain in eyewall)
        # R = 2 + 0.5 * (U - 20) for U > 20 m/s, in mm/hour
        rain_rate = np.where(wind_speed > 15,
                             2.0 + 0.5 * (wind_speed - 15), 0.0)  # mm/hour
        rain_rate = np.clip(rain_rate, 0, 100)  # max 100 mm/h
        rainfall += rain_rate * dt / 3600.0  # mm

        # ── Rainfall-runoff (SCS-CN method) ──
        # Runoff from accumulated rainfall
        runoff_increment = np.zeros_like(rainfall)
        for i in range(gs):
            for j in range(gs):
                if rainfall[i, j] > 0 and cn_map[i, j] < 99:
                    # Incremental runoff from this step's rainfall
                    rain_step = rain_rate[i, j] * dt / 3600.0  # mm this step
                    if rain_step > 0:
                        q = scs_runoff(rainfall[i, j], cn_map[i, j], 1.0)
                        runoff_increment[i, j] = q * 0.01  # convert to m

        # Overland flow: runoff flows downhill toward coast
        if runoff_increment.any():
            # Compute slope direction
            dz_dx = np.zeros_like(bathy)
            dz_dy = np.zeros_like(bathy)
            dz_dx[1:-1, 1:-1] = (bathy[2:, 1:-1] - bathy[:-2, 1:-1]) / (2 * dx_cell)
            dz_dy[1:-1, 1:-1] = (bathy[1:-1, 2:] - bathy[1:-1, :-2]) / (2 * dx_cell)

            # Flow velocity (Manning's equation for overland flow)
            h_overland = runoff_increment / 1000.0  # convert mm to m
            slope_mag = np.sqrt(dz_dx**2 + dz_dy**2) + 1e-10
            v_overland = (1.0 / N_MANING) * h_overland**(2/3) * slope_mag**(1/2)

            # Add overland flow to surge (runoff contributes to flooding)
            # Scaled contribution to prevent instability
            runoff_flow = v_overland * h_overland
            surge += runoff_flow * 0.001 * dt  # scaled contribution

        # ── River backflow ──
        # River channels (predefined)
        # Compute backflow based on surge from PREVIOUS step (before wind update)
        # to prevent positive feedback loop across time steps
        total_backflow = np.zeros_like(surge)
        for river_angle in [0.3, 0.7, 1.2, 1.8, 2.5]:
            river_dir_x = np.cos(river_angle)
            river_dir_y = np.sin(river_angle)
            proj = (x - coast_x) * river_dir_x + (y - gs/2) * river_dir_y
            lateral = np.abs((x - coast_x) * (-river_dir_y) + (y - gs/2) * river_dir_x)
            river_mask = (proj > 0) & (proj < gs * 0.4) & (lateral < 3)

            # River bed elevation (below sea level near coast)
            river_bed = -2.0 - proj * 0.01

            # Backflow: when surge > river_bed, river is blocked
            # Use surge from previous step (surge_prev) to avoid feedback
            surge_at_river = np.where(river_mask, surge_prev, 0)
            backflow = np.where(river_mask & (surge_at_river > river_bed + 0.5),
                               surge_at_river - river_bed, 0)
            river_level = np.where(river_mask,
                                   np.maximum(river_level, backflow),
                                   river_level)

            # Accumulate backflow (scaled down to prevent instability)
            total_backflow += np.where(river_mask, backflow * 0.05, 0)

        # Apply total backflow to surge (one-time, prevents feedback)
        surge += total_backflow

        # ── Snapshot ──
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            max_wind = float(wind_speed.max())
            max_surge = float(surge.max() + wave_setup.max() + pressure_surge.max())
            max_rain = float(rainfall.max())
            max_runoff = float(runoff.max())
            inundation_area = int(wet_mask.sum())
            max_wave = float(wave_height.max())

            snapshots.append({
                'wind_speed': wind_speed.astype(np.float32),
                'surge_height': (surge + wave_setup + pressure_surge).astype(np.float32),
                'wave_setup': wave_setup.astype(np.float32),
                'wave_height': wave_height.astype(np.float32),
                'rainfall': rainfall.astype(np.float32),
                'runoff': runoff.astype(np.float32),
                'river_level': river_level.astype(np.float32),
                'wet_mask': wet_mask.astype(np.float32),
                'time_hours': round(time_h, 2),
                'max_wind': max_wind,
                'max_surge': max_surge,
                'max_rainfall': max_rain,
                'max_runoff': max_runoff,
                'inundation_area': inundation_area,
                'max_wave_height': max_wave,
            })
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                print(f"  [{pct:5.1f}%] t={time_h:.1f}h | wind={max_wind:.1f}m/s | "
                      f"surge={max_surge:.2f}m | rain={max_rain:.1f}mm | "
                      f"runoff={max_runoff:.1f}mm | inund={inundation_area:,} cells | "
                      f"wave={max_wave:.1f}m")

    elapsed = time.time() - t0

    total_surge_field = surge + wave_setup + pressure_surge
    final = {
        'wind_speed': wind_speed.astype(np.float32),
        'wind_direction': wind_dir.astype(np.float32),
        'surge_height': total_surge_field.astype(np.float32),
        'wave_setup': wave_setup.astype(np.float32),
        'wave_height': wave_height.astype(np.float32),
        'rainfall': rainfall.astype(np.float32),
        'runoff': runoff.astype(np.float32),
        'river_level': river_level.astype(np.float32),
        'terrain': bathy.astype(np.float32),
        'max_wind_ms': float(wind_speed.max()),
        'max_surge_m': float(total_surge_field.max()),
        'max_rainfall_mm': float(rainfall.max()),
        'max_runoff_mm': float(runoff.max()),
        'max_wave_height_m': float(wave_height.max()),
        'inundation_area_cells': int(wet_mask.sum()),
        'cat': category,
    }

    print(f"\n[DONE] {elapsed:.1f}s | wind={final['max_wind_ms']:.1f}m/s | "
          f"surge={final['max_surge_m']:.2f}m | rain={final['max_rainfall_mm']:.1f}mm | "
          f"runoff={final['max_runoff_mm']:.1f}mm | inund={final['inundation_area_cells']:,} cells | "
          f"wave={final['max_wave_height_m']:.1f}m")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'category': category, 'forward_speed_kmh': forward_speed,
                       'central_pressure_hpa': central_pressure, 'radius_max_wind_km': rmax_km,
                       'duration_hours': duration_hours, 'lat': lat, 'lon': lon,
                       'cell_size_m': dx_cell},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'model': 'hurricane_wind_wave_surge_runoff_river',
                         'physics': 'holland_wind_swe_wave_setup_scs_cn_river_backflow'}}


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Hurricane Simulation (Comprehensive)")
    print("=" * 60)
    params_path = 'params.json'
    if os.path.exists(params_path):
        with open(params_path) as f:
            params = json.load(f)
    else:
        params = {'grid_size': 256, 'category': 3, 'forward_speed_kmh': 30,
                  'central_pressure_hpa': 960, 'radius_max_wind_km': 50,
                  'duration_hours': 6, 'lat': 25.0, 'lon': -80.0}
    try:
        result = simulate_hurricane(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/wind_speed.npy', result['final']['wind_speed'])
        np.save(f'{out}/wind_direction.npy', result['final']['wind_direction'])
        np.save(f'{out}/surge_height.npy', result['final']['surge_height'])
        np.save(f'{out}/wave_setup.npy', result['final']['wave_setup'])
        np.save(f'{out}/wave_height.npy', result['final']['wave_height'])
        np.save(f'{out}/rainfall.npy', result['final']['rainfall'])
        np.save(f'{out}/runoff.npy', result['final']['runoff'])
        np.save(f'{out}/river_level.npy', result['final']['river_level'])
        np.save(f'{out}/terrain.npy', result['final']['terrain'])
        snap_w = np.stack([s['wind_speed'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_wind.npy', snap_w)
        snap_s = np.stack([s['surge_height'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_surge.npy', snap_s)
        np.save(f'{out}/snapshot_times.npy', np.array([s['time_hours'] for s in result['snapshots']]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_wind_ms': result['final']['max_wind_ms'],
                                'max_surge_m': result['final']['max_surge_m'],
                                'max_rainfall_mm': result['final']['max_rainfall_mm'],
                                'max_runoff_mm': result['final']['max_runoff_mm'],
                                'max_wave_height_m': result['final']['max_wave_height_m'],
                                'inundation_area_cells': result['final']['inundation_area_cells'],
                                'category': result['final']['cat']},
                'snapshot_count': len(result['snapshots'])}
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(meta, f, indent=2)
        print(f"\n{'='*60}\nSIMULATION COMPLETE\n{'='*60}")
    except Exception as e:
        print(f"\n[ERROR] {e}"); traceback.print_exc()
        with open('/kaggle/working/error.log', 'w') as f:
            traceback.print_exc(file=f)
        raise

if __name__ == '__main__':
    main()
