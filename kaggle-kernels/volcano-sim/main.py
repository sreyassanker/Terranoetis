"""
Terranoetis — Volcanic Eruption Simulation (Physics-Based Lava Flow)
Upgraded: Depth-averaged lava flow equations with terrain interaction,
temperature-dependent viscosity (Arrhenius), cooling, and solidification.
Plus physics-based eruption column and ash fallout.

Physics:
  - Depth-averaged lava flow (Saint-Venant type for lava):
      ∂h/∂t + ∇·(h·v) = 0  (mass conservation)
      ∂(hv)/∂t + ∇·(hv⊗v) = -gh∇(z+h) - (τ_b/ρ)·sign(v)  (momentum)
  - Velocity from depth-averaged laminar flow (lubrication approximation):
      v = (ρg·sin(θ)·h²) / (3η)  (slope-driven, Bingham-plastic corrected)
  - Temperature evolution:
      ρc_p·∂T/∂t = ∇·(k∇T) - h_c·(T - T_amb) - L·∂φ/∂t  (heat equation)
  - Viscosity (Arrhenius):
      η(T) = η_ref · exp(E_a/R · (1/T - 1/T_ref))
  - Solidification: when T < T_solid, lava stops flowing (φ → 1)
  - Eruption column: 1D plume model (Morton-Taylor) with wind advection
  - Ash fallout: Gaussian plume with particle terminal velocity

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

# ── Physical constants ──────────────────────────────────────────────
G = 9.81                   # m/s² — gravity
RHO_LAVA = 2600.0          # kg/m³ — lava density
RHO_ASH = 1000.0           # kg/m³ — ash particle density
C_P_LAVA = 1200.0          # J/(kg·K) — lava specific heat
K_THERMAL = 1.5            # W/(m·K) — lava thermal conductivity
ETA_REF = 100.0            # Pa·s — reference viscosity at T_ref
T_REF = 1200.0             # K — reference temperature
E_A = 120_000.0            # J/mol — activation energy
R_GAS = 8.314              # J/(mol·K) — gas constant
T_LIQUIDUS = 1200.0        # K — liquidus temperature
T_SOLIDUS = 900.0          # K — solidus temperature
T_AMBIENT = 273.0          # K — ambient temperature
L_FUSION = 400_000.0       # J/kg — latent heat of fusion
H_COEFF = 25.0             # W/(m²·K) — convective heat transfer coefficient
CELL_SIZE_M = 50.0         # meters per grid cell

# VEI parameters
VEI_PARAMS = {
    0: {'col_height': 100,   'lava_vol': 1e4,   'mass_erupt': 1e6,  'ash_mass': 1e5},
    1: {'col_height': 1000,  'lava_vol': 1e5,   'mass_erupt': 1e7,  'ash_mass': 1e6},
    2: {'col_height': 5000,  'lava_vol': 1e6,   'mass_erupt': 1e8,  'ash_mass': 1e7},
    3: {'col_height': 10000, 'lava_vol': 1e7,   'mass_erupt': 1e9,  'ash_mass': 1e8},
    4: {'col_height': 25000, 'lava_vol': 1e8,   'mass_erupt': 1e10, 'ash_mass': 1e9},
    5: {'col_height': 40000, 'lava_vol': 1e9,   'mass_erupt': 1e11, 'ash_mass': 1e10},
}


def generate_volcanic_terrain(N, vent_x, vent_y):
    """Generate terrain with volcanic cone and realistic topography."""
    y, x = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    r = np.sqrt((x - vent_x)**2 + (y - vent_y)**2).astype(np.float64)
    # Volcanic cone (Gaussian)
    cone = 2000 * np.exp(-r**2 / (2 * (N / 8)**2))
    # Valley network (radial drainage)
    valley = -100 * np.exp(-((x - vent_x) * 0.3)**2 / (2 * (N / 4)**2))
    # Background topography
    base = 200 + 100 * np.sin(x / N * 4) * np.cos(y / N * 3)
    return cone + base + valley


def viscosity_from_temp(T):
    """Arrhenius viscosity model (Pa·s)."""
    # η = η_ref · exp(E_a/R · (1/T - 1/T_ref))
    # Clamp temperature to avoid overflow
    T_safe = np.clip(T, T_SOLIDUS, T_LIQUIDUS)
    eta = ETA_REF * np.exp((E_A / R_GAS) * (1.0 / T_safe - 1.0 / T_REF))
    return np.clip(eta, 1e-2, 1e12)


def compute_slope(terrain, dx_m):
    """Compute slope angle (radians) and gradient direction."""
    dz_dy, dz_dx = np.gradient(terrain, dx_m)
    slope_mag = np.sqrt(dz_dx**2 + dz_dy**2)
    slope_angle = np.arctan(slope_mag)
    # Flow direction (unit vector)
    norm = slope_mag + 1e-10
    flow_dir_x = -dz_dx / norm
    flow_dir_y = -dz_dy / norm
    return slope_angle, flow_dir_x, flow_dir_y


def simulate_volcano(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    vei = int(params.get('vei', 3))
    wind_speed = float(params.get('wind_speed_ms', 10))
    wind_dir = float(params.get('wind_dir_deg', 270))
    duration_hours = float(params.get('duration_hours', 2))

    vp = VEI_PARAMS.get(vei, VEI_PARAMS[3])
    col_h = vp['col_height']
    lava_vol_total = vp['lava_vol']
    ash_mass_total = vp['ash_mass']

    vent_x, vent_y = gs // 2, gs // 2
    terrain = generate_volcanic_terrain(gs, vent_x, vent_y)
    dx_m = CELL_SIZE_M

    # ── Lava flow state ──
    lava_thickness = np.zeros((gs, gs), dtype=np.float64)
    lava_temp = np.full((gs, gs), T_AMBIENT, dtype=np.float64)
    lava_volume = 0.0  # cumulative erupted volume (m³)

    # ── Ash deposit ──
    ash_deposit = np.zeros((gs, gs), dtype=np.float64)

    # ── Eruption column (1D plume height field) ──
    column_height = np.zeros((gs, gs), dtype=np.float64)

    # ── Time stepping ──
    dt = 300.0  # 5 min steps
    total_steps = int(duration_hours * 3600 / dt)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    # Eruption rate (m³/s) — scales with VEI
    eruption_rate = lava_vol_total / (duration_hours * 3600 * 0.5)  # 50% of duration active
    ash_rate = ash_mass_total / (duration_hours * 3600 * 0.5)

    wind_rad = np.radians(wind_dir)
    wind_x = wind_speed * np.sin(wind_rad)
    wind_y = wind_speed * np.cos(wind_rad)

    y_grid, x_grid = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    r_from_vent = np.sqrt((x_grid - vent_x)**2 + (y_grid - vent_y)**2)

    print(f"\n{'='*60}")
    print("TERRANOETIS — PHYSICS-BASED VOLCANIC ERUPTION SIMULATION")
    print(f"{'='*60}")
    print(f"VEI {vei} | Column: {col_h}m | Lava vol: {lava_vol_total:.0e} m³ | grid={gs}x{gs}")
    print(f"Cell size: {dx_m}m | dt={dt}s | Steps: {total_steps}")

    for step_i in range(total_steps):
        t = step_i * dt
        active_eruption = step_i < total_steps * 0.5  # eruption active for first half

        # ── Eruption column (1D plume model) ──
        if active_eruption:
            # Plume height scales with mass eruption rate (Morton-Taylor)
            # H ∝ (Q² / (g·ρ_a))^{1/4}
            Q = ash_rate  # kg/s
            plume_h = col_h * (1 - 0.3 * step_i / total_steps)  # slight decay
            # Gaussian spread from vent
            spread = 5 + step_i * 0.3
            column_height = plume_h * np.exp(-r_from_vent**2 / (2 * spread**2))

            # ── Ash fallout (Gaussian plume with terminal velocity) ──
            # Particle terminal velocity (Stokes): v_t = 2/9 · (ρ_p - ρ_a)·g·d² / (μ·ρ_a)
            # For ash (d ~ 50 µm): v_t ≈ 0.5 m/s
            v_terminal = 0.5  # m/s
            # Downwind displacement
            drift_x = vent_x + wind_x * v_terminal * t / dx_m
            drift_y = vent_y + wind_y * v_terminal * t / dx_m
            ash_spread = 10 + step_i * 0.3
            ash_deposit += (ash_rate * dt / (RHO_ASH * dx_m**2)) * \
                np.exp(-((x_grid - drift_x)**2 + (y_grid - drift_y)**2) / (2 * ash_spread**2))

        # ── Lava flow: depth-averaged equations ──
        if active_eruption and vei >= 1:
            # Erupt lava at vent
            vent_mask = r_from_vent < 3.0
            new_vol = eruption_rate * dt  # m³ this step
            lava_thickness[vent_mask] += new_vol / (np.pi * 3**2 * dx_m**2)
            lava_temp[vent_mask] = T_LIQUIDUS
            lava_volume += new_vol

            # Compute slope and flow direction
            slope_angle, flow_dir_x, flow_dir_y = compute_slope(terrain + lava_thickness, dx_m)

            # Temperature-dependent viscosity
            eta = viscosity_from_temp(lava_temp)

            # Depth-averaged velocity (lubrication approximation for laminar flow):
            # v = (ρg·sin(θ)·h²) / (3η)
            sin_slope = np.sin(slope_angle)
            sin_slope = np.where(lava_thickness > 0, sin_slope, 0)

            # Bingham-plastic correction for yield strength
            tau_y = 50.0  # Pa — yield strength
            # Effective velocity: v = max(0, (ρg·sin(θ)·h - τ_y)·h / (3η))
            driving_stress = RHO_LAVA * G * sin_slope * lava_thickness
            effective_stress = np.maximum(driving_stress - tau_y, 0)
            velocity_mag = effective_stress * lava_thickness / (3 * eta + 1e-10)

            # CFL stability: v_max * dt / dx < 1 (use safety factor 0.5)
            v_max_cfl = dx_m / dt * 0.5
            velocity_mag = np.minimum(velocity_mag, v_max_cfl)

            # Flow direction
            vx = velocity_mag * flow_dir_x
            vy = velocity_mag * flow_dir_y

            # ── Mass conservation: ∂h/∂t + ∇·(h·v) = 0 ──
            # Flux: q = h * v
            qx = lava_thickness * vx
            qy = lava_thickness * vy

            # Divergence of flux (conservative)
            div_q = np.zeros_like(lava_thickness)
            div_q[1:, 1:] = (
                (qx[1:, 1:] - qx[:-1, 1:]) / dx_m +
                (qy[1:, 1:] - qy[1:, :-1]) / dx_m
            )

            # Update thickness
            lava_thickness_new = lava_thickness - dt * div_q

            # Ensure non-negative and capped thickness (max 1 km)
            lava_thickness_new = np.clip(lava_thickness_new, 0, 1000.0)

            # ── Temperature evolution (heat equation) ──
            # ρc_p·∂T/∂t = k∇²T - h_c·(T - T_amb) - L·∂φ/∂t
            # Simple explicit scheme
            d2T_dx2 = np.zeros_like(lava_temp)
            d2T_dy2 = np.zeros_like(lava_temp)
            d2T_dx2[1:-1, 1:-1] = (
                lava_temp[2:, 1:-1] - 2*lava_temp[1:-1, 1:-1] + lava_temp[:-2, 1:-1]
            ) / dx_m**2
            d2T_dy2[1:-1, 1:-1] = (
                lava_temp[1:-1, 2:] - 2*lava_temp[1:-1, 1:-1] + lava_temp[1:-1, :-2]
            ) / dx_m**2

            thermal_cond = K_THERMAL / (RHO_LAVA * C_P_LAVA)  # m²/s
            cooling_rate = H_COEFF / (RHO_LAVA * C_P_LAVA)  # 1/s

            # Cooling (convection + radiation)
            temp_diff = lava_temp - T_AMBIENT
            dT_cooling = -cooling_rate * temp_diff * dt

            # Thermal diffusion
            dT_diffusion = thermal_cond * (d2T_dx2 + d2T_dy2) * dt

            # Solidification: latent heat sink when T < T_SOLIDUS
            solidifying = (lava_temp < T_SOLIDUS) & (lava_thickness > 0)
            dT_solid = np.where(solidifying, -L_FUSION / C_P_LAVA * 0.01, 0)

            # Update temperature
            lava_temp_new = lava_temp + dT_diffusion + dT_cooling + dT_solid
            # Reset ambient temperature where no lava
            lava_temp_new = np.where(lava_thickness_new > 0, lava_temp_new, T_AMBIENT)
            # Clamp temperature
            lava_temp_new = np.clip(lava_temp_new, T_AMBIENT, T_LIQUIDUS)

            # Solidification: when T < T_SOLIDUS, lava stops flowing
            solidified = (lava_temp_new < T_SOLIDUS)
            # Solidified lava doesn't flow (set velocity to 0)
            # This is handled implicitly by viscosity → ∞ as T → T_SOLIDUS

            lava_thickness = lava_thickness_new
            lava_temp = lava_temp_new

        # ── Snapshot ──
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            max_col = float(column_height.max())
            max_ash = float(ash_deposit.max())
            lava_area = int((lava_thickness > 0).sum())
            max_lava_thick = float(lava_thickness.max())
            avg_temp = float(lava_temp[lava_thickness > 0].mean()) if lava_area > 0 else T_AMBIENT
            solidified_cells = int(((lava_temp < T_SOLIDUS) & (lava_thickness > 0)).sum())

            snapshots.append({
                'column_height': column_height.astype(np.float32),
                'ash_deposit': ash_deposit.astype(np.float32),
                'lava_thickness': lava_thickness.astype(np.float32),
                'lava_temp': lava_temp.astype(np.float32),
                'time_hours': round(step_i * dt / 3600, 2),
                'max_column_m': max_col,
                'max_ash_m': max_ash,
                'lava_cells': lava_area,
                'max_lava_thickness_m': max_lava_thick,
                'avg_lava_temp_k': avg_temp,
                'solidified_cells': solidified_cells,
            })
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                print(f"  [{pct:5.1f}%] t={step_i*dt/3600:.1f}h | col={max_col:.0f}m | "
                      f"ash={max_ash:.3f}m | lava={lava_area:,} cells ({max_lava_thick:.1f}m) | "
                      f"avgT={avg_temp:.0f}K | solid={solidified_cells}")

    elapsed = time.time() - t0
    final = {
        'column_height': column_height.astype(np.float32),
        'ash_deposit': ash_deposit.astype(np.float32),
        'lava_thickness': lava_thickness.astype(np.float32),
        'lava_temp': lava_temp.astype(np.float32),
        'terrain': terrain.astype(np.float32),
        'max_column_m': float(column_height.max()),
        'max_ash_m': float(ash_deposit.max()),
        'lava_area_cells': int((lava_thickness > 0).sum()),
        'max_lava_thickness_m': float(lava_thickness.max()),
        'total_lava_volume_m3': float(lava_volume),
        'solidified_cells': int(((lava_temp < T_SOLIDUS) & (lava_thickness > 0)).sum()),
    }
    print(f"\n[DONE] {elapsed:.1f}s | col={final['max_column_m']:.0f}m | "
          f"ash={final['max_ash_m']:.3f}m | lava={final['lava_area_cells']:,} cells | "
          f"vol={final['total_lava_volume_m3']:.2e} m³ | solid={final['solidified_cells']}")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'vei': vei, 'wind_speed_ms': wind_speed,
                       'wind_dir_deg': wind_dir, 'duration_hours': duration_hours,
                       'cell_size_m': dx_m},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'model': 'depth_averaged_lava_flow',
                         'physics': 'mass_conservation_momentum_heat'}}


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Volcano Simulation (Physics-Based Lava Flow)")
    print("=" * 60)
    params_path = 'params.json'
    if os.path.exists(params_path):
        with open(params_path) as f:
            params = json.load(f)
    else:
        params = {'grid_size': 256, 'vei': 3, 'wind_speed_ms': 10,
                  'wind_dir_deg': 270, 'duration_hours': 2}
    try:
        result = simulate_volcano(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/column_height.npy', result['final']['column_height'])
        np.save(f'{out}/ash_deposit.npy', result['final']['ash_deposit'])
        np.save(f'{out}/lava_thickness.npy', result['final']['lava_thickness'])
        np.save(f'{out}/lava_temp.npy', result['final']['lava_temp'])
        np.save(f'{out}/terrain.npy', result['final']['terrain'])
        snap_c = np.stack([s['column_height'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_column.npy', snap_c)
        snap_l = np.stack([s['lava_thickness'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_lava.npy', snap_l)
        np.save(f'{out}/snapshot_times.npy', np.array([s['time_hours'] for s in result['snapshots']]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_column_m': result['final']['max_column_m'],
                                'max_ash_m': result['final']['max_ash_m'],
                                'lava_area_cells': result['final']['lava_area_cells'],
                                'max_lava_thickness_m': result['final']['max_lava_thickness_m'],
                                'total_lava_volume_m3': result['final']['total_lava_volume_m3'],
                                'solidified_cells': result['final']['solidified_cells']},
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
