"""
Terranoetis — Landslide / Debris Flow Simulation
Depth-averaged debris flow model with Voellmy friction law.

Physics:
  - Depth-averaged shallow water equations for debris flow:
      ∂h/∂t + ∇·(h·u) = 0                           (mass conservation)
      ∂(hu)/∂t + ∇·(hu⊗u) = -gh∇(h+z) - τ_b/ρ        (momentum)
  - Voellmy friction law:
      τ_b = μ·ρ·g·h·cos(θ) + ξ·ρ·|u|·u
      where μ = Coulomb friction coefficient, ξ = turbulent friction coefficient
  - Mohr-Coulomb yield criterion for initial failure:
      τ = c + σ·tan(φ)
  - Trigger mechanisms:
      - Earthquake: PGA exceeds threshold → slope failure
      - Rainfall: infiltration reduces effective stress → failure
      - Volcanic: lahar from rapid snow/ice melt
  - Runout modeling: debris flows downslope, depositing where
    driving stress < resisting friction

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

# ── Physical constants ──────────────────────────────────────────────
G = 9.81              # m/s² — gravitational acceleration
RHO_DEBRIS = 2000.0   # kg/m³ — bulk density of debris flow (sediment + water)
RHO_WATER = 1000.0    # kg/m³ — water density
RHO_ROCK = 2650.0     # kg/m³ — rock density

# ── Voellmy friction parameters ─────────────────────────────────────
# τ_b = μ·ρ·g·h·cos(θ) + ξ·ρ·|u|·u
# μ: Coulomb friction coefficient (0.05–0.4 for debris flows)
# ξ: turbulent friction coefficient (100–1000 m/s² for debris flows)
MU_DEFAULT = 0.25     # Coulomb friction coefficient
XI_DEFAULT = 300.0    # Turbulent friction coefficient (m/s²)

# ── Mohr-Coulomb parameters for initial failure ─────────────────────
PHI_DEFAULT = 35.0    # Internal friction angle (degrees)
C_DEFAULT = 500.0     # Cohesion (Pa)

# ── Trigger thresholds ────────────────────────────────────────────────
PGA_THRESHOLD = 0.15  # g — PGA threshold for earthquake-triggered landslides
RAIN_THRESHOLD = 150.0  # mm — cumulative rainfall threshold for rain-triggered landslides


def generate_terrain(N, seed=42):
    """
    Generate synthetic mountainous terrain with steep slopes prone to landsliding.
    Returns elevation in meters (positive up).
    """
    rng = np.random.RandomState(seed)
    y, x = np.meshgrid(np.arange(N, dtype=np.float64), np.arange(N, dtype=np.float64), indexing='ij')

    # Base topography: mountain ridge with valleys
    # Main ridge running diagonally
    ridge = 2000 * np.exp(-((x - N/2)**2 + (y - N/2)**2) / (2 * (N/3)**2))
    # Secondary ridges
    ridge2 = 1200 * np.exp(-((x - N*0.3)**2 + (y - N*0.7)**2) / (2 * (N/5)**2))
    ridge3 = 1000 * np.exp(-((x - N*0.7)**2 + (y - N*0.3)**2) / (2 * (N/5)**2))

    # Valley system (low elevation corridors)
    valley = -800 * np.exp(-((x - N*0.2)**2) / (2 * (N/8)**2)) * np.exp(-((y - N*0.5)**2) / (2 * (N/4)**2))
    valley2 = -600 * np.exp(-((y - N*0.8)**2) / (2 * (N/6)**2))

    # Noise for realistic roughness
    noise = rng.randn(N, N) * 50

    terrain = ridge + ridge2 + ridge3 + valley + valley2 + noise
    terrain = np.clip(terrain, 0, 4000)

    return terrain


def compute_slope(terrain, dx):
    """
    Compute slope angle (degrees) from terrain elevation.
    """
    dz_dx = np.zeros_like(terrain)
    dz_dy = np.zeros_like(terrain)
    dz_dx[1:-1, 1:-1] = (terrain[2:, 1:-1] - terrain[:-2, 1:-1]) / (2 * dx)
    dz_dy[1:-1, 1:-1] = (terrain[1:-1, 2:] - terrain[1:-1, :-2]) / (2 * dx)
    slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    return np.degrees(slope_rad), dz_dx, dz_dy


def compute_pga_field(magnitude, epicenter_y, epicenter_x, gs, dx):
    """
    Compute PGA field from earthquake using Campbell-Bozorgnia attenuation.
    Returns PGA in g (gravitational acceleration).
    """
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    r_km = np.sqrt((y - epicenter_y)**2 + (x - epicenter_x)**2) * (dx / 1000.0)
    r_km = np.maximum(r_km, 1.0)
    # Simplified Campbell-Bozorgnia PGA (g)
    ln_pga = (3.586 + 0.707 * magnitude - 1.093 * np.log(r_km + 10.0)
              - 0.0053 * (r_km + 10.0) + 0.25 * np.log(760 / 760))
    pga = np.exp(ln_pga)  # in g
    return pga


def compute_rainfall_field(rainfall_mm, gs, dx, seed=42):
    """
    Compute spatial rainfall distribution (mm).
    Heavy rainfall concentrated in upper elevations.
    """
    rng = np.random.RandomState(seed)
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    # Rainfall decreases with distance from storm center
    storm_y, storm_x = gs * 0.2, gs * 0.5
    r = np.sqrt((y - storm_y)**2 + (x - storm_x)**2)
    decay = np.exp(-r / (gs * 0.3))
    # Add spatial variability
    noise = rng.rand(gs, gs) * 0.3 + 0.7
    rainfall = rainfall_mm * decay * noise
    return rainfall


def compute_trigger_susceptibility(terrain, slope_deg, pga_field, rainfall_field,
                                   trigger_type, pga_threshold, rain_threshold,
                                   phi_deg, cohesion):
    """
    Compute landslide trigger susceptibility (0–1) based on:
    - Slope stability (Mohr-Coulomb)
    - PGA (earthquake trigger)
    - Rainfall infiltration (rain trigger)

    Returns susceptibility map and initial failure mask.
    """
    phi_rad = np.radians(phi_deg)
    slope_rad = np.radians(slope_deg)

    # ── Slope stability (infinite slope model) ──
    # Factor of safety: FS = (c + σ'·tan(φ)) / (γ·h·sin(θ))
    # where σ' = effective normal stress, γ = unit weight of soil
    gamma_soil = 18000.0  # N/m³ (typical for saturated soil)
    h_soil = 2.0  # m — assumed soil depth
    # Effective stress (simplified: assume 50% saturation)
    sigma_eff = gamma_soil * h_soil * np.cos(slope_rad) * 0.5
    shear_resistance = cohesion + sigma_eff * np.tan(phi_rad)
    shear_stress = gamma_soil * h_soil * np.sin(slope_rad)
    fs = np.where(slope_deg > 5, shear_resistance / (shear_stress + 1e-10), 10.0)
    fs = np.maximum(fs, 0.01)

    # Susceptibility from slope stability (lower FS = higher susceptibility)
    slope_suscept = np.clip(1.0 - fs, 0, 1)

    # ── Trigger mechanism ──
    if trigger_type == 'earthquake':
        # PGA-induced failure: FS reduced by seismic coefficient
        # Newmark analysis: failure when a_max > g·(FS - 1)·sin(θ)
        seismic_coeff = pga_field * G  # m/s²
        # Seismic reduction in FS
        fs_seismic = fs - seismic_coeff / (G * np.sin(slope_rad + 0.01))
        fs_seismic = np.maximum(fs_seismic, 0.01)
        trigger = np.clip(1.0 - fs_seismic, 0, 1)
        # Only trigger where PGA exceeds threshold
        trigger = np.where(pga_field > pga_threshold, trigger, 0.0)

    elif trigger_type == 'rainfall':
        # Rainfall infiltration reduces effective stress
        # Simplified: effective stress reduction proportional to rainfall
        rain_factor = np.clip(rainfall_field / (rain_threshold * 2), 0, 1)
        fs_rain = fs * (1.0 - 0.7 * rain_factor)  # up to 70% reduction
        fs_rain = np.maximum(fs_rain, 0.01)
        trigger = np.clip(1.0 - fs_rain, 0, 1)
        # Only trigger where rainfall exceeds threshold
        trigger = np.where(rainfall_field > rain_threshold * 0.3, trigger, 0.0)

    elif trigger_type == 'volcanic':
        # Lahar trigger: rapid snow/ice melt from volcanic heat
        # Assume lahar source near volcano vent (center of grid)
        gs_n = terrain.shape[0]
        cy, cx = gs_n // 2, gs_n // 2
        y, x = np.meshgrid(np.arange(gs_n), np.arange(gs_n), indexing='ij')
        r = np.sqrt((y - cy)**2 + (x - cx)**2)
        # Lahar probability decreases with distance from vent
        lahar_prob = np.exp(-r / (gs_n * 0.25)) * (slope_deg > 15).astype(np.float64)
        trigger = np.clip(lahar_prob, 0, 1)

    else:
        trigger = np.zeros_like(terrain)

    # Combine slope susceptibility with trigger
    susceptibility = slope_suscept * trigger
    susceptibility = np.clip(susceptibility, 0, 1)

    # Initial failure mask: high susceptibility cells
    failure_mask = susceptibility > 0.3

    return susceptibility, failure_mask, fs


def simulate_landslide(params):
    """
    Depth-averaged debris flow simulation with Voellmy friction law.

    Solves:
      ∂h/∂t + ∇·(h·u) = 0                           (mass conservation)
      ∂(hu)/∂t + ∇·(hu⊗u) = -gh∇(h+z) - τ_b/ρ        (momentum)

    Friction: τ_b = μ·ρ·g·h·cos(θ) + ξ·ρ·|u|·u (Voellmy)
    """
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    trigger_type = params.get('trigger_type', 'earthquake')
    magnitude = float(params.get('magnitude', 6.5))
    pga_threshold = float(params.get('pga_threshold', PGA_THRESHOLD))
    rainfall_mm = float(params.get('rainfall_mm', 200))
    duration_hours = float(params.get('duration_hours', 2))
    phi_deg = float(params.get('friction_angle', PHI_DEFAULT))
    cohesion = float(params.get('cohesion', C_DEFAULT))
    lat = float(params.get('lat', 36.1699))
    lon = float(params.get('lon', -115.8090))

    # Grid spacing: 20 m/cell (mountain terrain)
    dx = 20.0  # meters
    dt = 0.1   # time step (s) — CFL: max_vel * dt / dx < 0.5

    # ── Generate terrain ──
    terrain = generate_terrain(gs)
    slope_deg, dz_dx, dz_dy = compute_slope(terrain, dx)

    # ── Compute trigger fields ──
    # Earthquake epicenter (off-map, simulating distant earthquake)
    eq_y, eq_x = int(gs * 0.7), int(gs * 0.3)
    pga_field = compute_pga_field(magnitude, eq_y, eq_x, gs, dx)

    # Rainfall field
    rainfall_field = compute_rainfall_field(rainfall_mm, gs, dx)

    # ── Compute trigger susceptibility ──
    susceptibility, failure_mask, fs = compute_trigger_susceptibility(
        terrain, slope_deg, pga_field, rainfall_field,
        trigger_type, pga_threshold, RAIN_THRESHOLD, phi_deg, cohesion
    )

    # ── Initialize debris flow state ──
    # h: flow depth (m), hu: x-momentum, hv: y-momentum
    h = np.zeros((gs, gs), dtype=np.float64)
    hu = np.zeros((gs, gs), dtype=np.float64)
    hv = np.zeros((gs, gs), dtype=np.float64)

    # Initial landslide volume at failure points
    # Volume proportional to susceptibility and slope
    initial_volume = np.where(failure_mask, susceptibility * slope_deg * 100, 0.0)
    # Cap initial depth
    h = np.clip(initial_volume / (dx * dx), 0, 50.0)  # max 50m initial depth

    # Source cells (where landslide initiates)
    source_cells = int(failure_mask.sum())
    if source_cells == 0:
        # Fallback: create source at steepest slope
        steepest = np.unravel_index(np.argmax(slope_deg), slope_deg.shape)
        h[steepest] = 20.0
        source_cells = 1

    print(f"\n{'='*60}")
    print("TERRANOETIS — LANDSLIDE DEBRIS FLOW SIMULATION")
    print(f"{'='*60}")
    print(f"Trigger: {trigger_type} | Grid: {gs}x{gs} | dx={dx}m")
    print(f"Voellmy: μ={MU_DEFAULT}, ξ={XI_DEFAULT} m/s²")
    print(f"Mohr-Coulomb: φ={phi_deg}°, c={cohesion} Pa")
    print(f"Source cells: {source_cells} | Initial volume: {h.sum()*dx*dx/1e6:.2f} M m³")

    # ── Time stepping (Lax-Friedrichs scheme) ──
    total_steps = int(duration_hours * 3600 / dt)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    # Precompute friction parameters
    mu = MU_DEFAULT
    xi = XI_DEFAULT
    rho = RHO_DEBRIS

    # Runout distance from source
    source_y, source_x = np.where(h > 0)
    if len(source_y) > 0:
        sy, sx = source_y.mean(), source_x.mean()
    else:
        sy, sx = gs // 2, gs // 2
    y_grid, x_grid = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    runout_distance = np.sqrt((y_grid - sy)**2 + (x_grid - sx)**2) * dx / 1000.0  # km

    # Downslope direction (negative gradient)
    slope_mag = np.sqrt(dz_dx**2 + dz_dy**2) + 1e-10
    grad_x = -dz_dx / slope_mag  # downslope x-direction
    grad_y = -dz_dy / slope_mag  # downslope y-direction
    sin_theta = np.sin(np.radians(slope_deg))
    cos_theta = np.cos(np.radians(slope_deg))

    print(f"Total steps: {total_steps}")

    for step_i in range(total_steps):
        t = step_i * dt

        # ── Compute velocity from momentum (safe division) ──
        u = np.zeros_like(h)
        v = np.zeros_like(h)
        wet = h > 0.01
        u[wet] = hu[wet] / h[wet]
        v[wet] = hv[wet] / h[wet]
        # Clamp velocity to prevent instability
        u = np.clip(u, -50, 50)
        v = np.clip(v, -50, 50)

        # ── Lax-Friedrichs for continuity equation ──
        # ∂h/∂t + ∂(hu)/∂x + ∂(hv)/∂y = 0
        # LF: h_new = 0.5*(h_r + h_l) - 0.5*dt/dx*(flux_r - flux_l)
        h_r = np.roll(h, -1, 1); h_r[:, -1] = h[:, -1]
        h_l = np.roll(h, 1, 1); h_l[:, 0] = h[:, 0]
        h_d = np.roll(h, -1, 0); h_d[-1, :] = h[-1, :]
        h_u = np.roll(h, 1, 0); h_u[0, :] = h[0, :]

        u_r = np.roll(u, -1, 1); u_r[:, -1] = u[:, -1]
        u_l = np.roll(u, 1, 1); u_l[:, 0] = u[:, 0]
        u_d = np.roll(u, -1, 0); u_d[-1, :] = u[-1, :]
        u_u = np.roll(u, 1, 0); u_u[0, :] = u[0, :]

        v_r = np.roll(v, -1, 1); v_r[:, -1] = v[:, -1]
        v_l = np.roll(v, 1, 1); v_l[:, 0] = v[:, 0]
        v_d = np.roll(v, -1, 0); v_d[-1, :] = v[-1, :]
        v_u = np.roll(v, 1, 0); v_u[0, :] = v[0, :]

        # Lax-Friedrichs flux: average of neighbors minus diffusion
        # h_new = 0.25*(h_r + h_l + h_d + h_u) - 0.5*dt/dx*(flux_x_r - flux_x_l + flux_y_d - flux_y_u)
        flux_x_r = h_r * u_r  # flux at right face
        flux_x_l = h_l * u_l  # flux at left face
        flux_y_d = h_d * v_d  # flux at bottom face
        flux_y_u = h_u * v_u  # flux at top face

        h_new = 0.25 * (h_r + h_l + h_d + h_u) \
                - 0.5 * (dt / dx) * ((flux_x_r - flux_x_l) + (flux_y_d - flux_y_u))

        # Clamp depth to prevent overflow
        h_new = np.clip(h_new, 0, 100)

        # ── Momentum update (semi-implicit for stability) ──
        # Gravity source: drives flow downslope
        gravity_x = rho * G * h * sin_theta * grad_x
        gravity_y = rho * G * h * sin_theta * grad_y

        # Voellmy friction: τ_b = μ·ρ·g·h·cos(θ) + ξ·ρ·|u|·u
        u_mag = np.sqrt(u**2 + v**2) + 1e-10
        tau_coulomb = mu * rho * G * h * cos_theta
        tau_turbulent = xi * rho * u_mag * np.maximum(h, 0)
        tau_total = tau_coulomb + tau_turbulent

        # Friction force (opposes velocity)
        friction_x = -tau_total * np.where(wet, u / u_mag, 0)
        friction_y = -tau_total * np.where(wet, v / u_mag, 0)

        # Momentum update
        hu_new = hu + dt * (gravity_x + friction_x) / rho
        hv_new = hv + dt * (gravity_y + friction_y) / rho

        # ── Deposition: where driving stress < resisting friction ──
        driving = rho * G * h * sin_theta
        deposit_mask = (driving < tau_total) & wet
        hu_new = np.where(deposit_mask, 0, hu_new)
        hv_new = np.where(deposit_mask, 0, hv_new)

        # ── Boundary conditions: zero gradient (outflow) ──
        h_new[0, :] = h_new[1, :]; h_new[-1, :] = h_new[-2, :]
        h_new[:, 0] = h_new[:, 1]; h_new[:, -1] = h_new[:, -2]
        hu_new[0, :] = hu_new[1, :]; hu_new[-1, :] = hu_new[-2, :]
        hv_new[0, :] = hv_new[1, :]; hv_new[-1, :] = hv_new[-2, :]

        # ── Ensure non-negative depth ──
        h_new = np.maximum(h_new, 0)

        # ── Check for NaN and reset if needed ──
        if np.any(np.isnan(h_new)) or np.any(np.isinf(h_new)):
            h_new = np.nan_to_num(h_new, nan=0, posinf=0, neginf=0)
            hu_new = np.nan_to_num(hu_new, nan=0, posinf=0, neginf=0)
            hv_new = np.nan_to_num(hv_new, nan=0, posinf=0, neginf=0)

        # Update state
        h = h_new
        hu = hu_new
        hv = hv_new

        # ── Snapshot ──
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            u = np.where(h > 0.01, hu / h, 0)
            v = np.where(h > 0.01, hv / h, 0)
            v_mag = np.sqrt(u**2 + v**2)

            snapshots.append({
                'depth': h.astype(np.float32),
                'velocity': v_mag.astype(np.float32),
                'time_seconds': round(t, 1),
                'max_depth': float(h.max()),
                'max_velocity': float(v_mag.max()),
            })
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                print(f"  [{pct:5.1f}%] t={t:.0f}s | max_depth={h.max():.1f}m | max_vel={v_mag.max():.1f}m/s | "
                      f"cells={int((h > 0.01).sum())}")

    elapsed = time.time() - t0

    # ── Final results ──
    u = np.where(h > 0.01, hu / h, 0)
    v = np.where(h > 0.01, hv / h, 0)
    v_mag = np.sqrt(u**2 + v**2)

    # Runout distance: max distance from source where debris reached
    debris_mask = h > 0.01
    max_runout = float(runout_distance[debris_mask].max()) if debris_mask.any() else 0.0

    # Affected area
    affected_cells = int(debris_mask.sum())
    affected_area_km2 = affected_cells * (dx / 1000.0)**2

    # Total volume
    total_volume = float(h.sum() * dx * dx)

    final = {
        'landslide_depth': h.astype(np.float32),
        'landslide_velocity': v_mag.astype(np.float32),
        'velocity_x': u.astype(np.float32),
        'velocity_y': v.astype(np.float32),
        'runout_distance': runout_distance.astype(np.float32),
        'terrain': terrain.astype(np.float32),
        'susceptibility': susceptibility.astype(np.float32),
        'trigger_map': pga_field.astype(np.float32) if trigger_type == 'earthquake' else rainfall_field.astype(np.float32),
        'slope': slope_deg.astype(np.float32),
        'max_depth': float(h.max()),
        'max_velocity': float(v_mag.max()),
        'max_runout_km': max_runout,
        'affected_area_km2': affected_area_km2,
        'total_volume_m3': total_volume,
        'source_cells': source_cells,
    }

    print(f"\n[DONE] {elapsed:.1f}s | max_depth={final['max_depth']:.1f}m | "
          f"max_vel={final['max_velocity']:.1f}m/s | runout={max_runout:.1f}km | "
          f"affected={affected_area_km2:.1f}km² | vol={total_volume/1e6:.1f}M m³")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'trigger_type': trigger_type, 'magnitude': magnitude,
                       'pga_threshold': pga_threshold, 'rainfall_mm': rainfall_mm,
                       'duration_hours': duration_hours, 'friction_angle': phi_deg,
                       'cohesion': cohesion, 'lat': lat, 'lon': lon,
                       'mu': MU_DEFAULT, 'xi': XI_DEFAULT, 'rho_debris': RHO_DEBRIS},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'model': 'depth_averaged_debris_flow',
                         'friction_law': 'voellmy',
                         'solver': 'lax_friedrichs'}}


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Landslide Simulation (Debris Flow)")
    print("=" * 60)
    params_path = 'params.json'
    if os.path.exists(params_path):
        with open(params_path) as f:
            params = json.load(f)
    else:
        params = {'grid_size': 256, 'trigger_type': 'earthquake', 'magnitude': 6.5,
                  'pga_threshold': 0.15, 'rainfall_mm': 200, 'duration_hours': 2,
                  'friction_angle': 35, 'cohesion': 500, 'lat': 36.1699, 'lon': -115.8090}
    try:
        result = simulate_landslide(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/landslide_depth.npy', result['final']['landslide_depth'])
        np.save(f'{out}/landslide_velocity.npy', result['final']['landslide_velocity'])
        np.save(f'{out}/velocity_x.npy', result['final']['velocity_x'])
        np.save(f'{out}/velocity_y.npy', result['final']['velocity_y'])
        np.save(f'{out}/runout_distance.npy', result['final']['runout_distance'])
        np.save(f'{out}/terrain.npy', result['final']['terrain'])
        np.save(f'{out}/susceptibility.npy', result['final']['susceptibility'])
        np.save(f'{out}/trigger_map.npy', result['final']['trigger_map'])
        np.save(f'{out}/slope.npy', result['final']['slope'])
        snap_d = np.stack([s['depth'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_depth.npy', snap_d)
        snap_v = np.stack([s['velocity'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_velocity.npy', snap_v)
        np.save(f'{out}/snapshot_times.npy', np.array([s['time_seconds'] for s in result['snapshots']]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_depth': result['final']['max_depth'],
                                'max_velocity': result['final']['max_velocity'],
                                'max_runout_km': result['final']['max_runout_km'],
                                'affected_area_km2': result['final']['affected_area_km2'],
                                'total_volume_m3': result['final']['total_volume_m3'],
                                'source_cells': result['final']['source_cells']},
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
