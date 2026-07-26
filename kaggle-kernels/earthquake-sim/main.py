"""
Terranoetis — Earthquake Elastic Wave + GMPE ShakeMap Simulation
Upgraded: 2D elastic wave equation (displacement formulation, leapfrog) with
P-wave, S-wave, and surface-wave (Rayleigh) propagation.
GMPE-based PGA/PGV/Sa + ShakeMap with MMI.

Physics:
  - 2D elastic wave equation in displacement form:
      ∂²u_x/∂t² = (λ+2μ)∂²u_x/∂x² + μ∂²u_x/∂z² + λ∂²u_z/∂x∂z + f_x/ρ
      ∂²u_z/∂t² = μ∂²u_z/∂x² + (λ+2μ)∂²u_z/∂z² + λ∂²u_x/∂x∂z + f_z/ρ
  - P-wave velocity: Vp = sqrt((λ+2μ)/ρ)
  - S-wave velocity: Vs = sqrt(μ/ρ)
  - Surface waves: low-velocity surface layer generates Rayleigh waves
  - GMPE: Campbell-Bozorgnia NGA-West2 for PGA, PGV, Sa
  - ShakeMap: interpolated ground motion field with MMI (Wald et al. 1999)
  - Sponge layer (damping zone) at boundaries for absorbing conditions

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

# ── Physical constants ──────────────────────────────────────────────
RHO_CRUST = 2600.0     # kg/m³ — crustal density
VP_CRUST = 6000.0      # m/s — P-wave velocity (crust)
VS_CRUST = 3464.0      # m/s — S-wave velocity (crust) ≈ VP/√3
VPWATER = 1500.0       # m/s — P-wave velocity (water/seafloor)
LAMBDA_CRUST = RHO_CRUST * (VP_CRUST**2 - 2 * VS_CRUST**2)  # Lame λ
MU_CRUST = RHO_CRUST * VS_CRUST**2                           # Lame μ

# ── GMPE: Campbell-Bozorgnia NGA-West2 (simplified) ────────────────
def campbell_bozorgnia_pga(magnitude, distance_km, vs30=760):
    """Simplified Campbell-Bozorgnia NGA-West2 PGA attenuation (cm/s²)."""
    M = magnitude
    R = np.maximum(distance_km, 1.0)
    ln_pga = (3.586 + 0.707 * M - 1.093 * np.log(R + 10.0)
              - 0.0053 * (R + 10.0) + 0.25 * np.log(vs30 / 760))
    return np.exp(ln_pga) * 981.0  # convert g → cm/s²

def campbell_bozorgnia_pgv(magnitude, distance_km, vs30=760):
    """Simplified PGV attenuation (cm/s) — empirical scaling."""
    M = magnitude
    R = np.maximum(distance_km, 1.0)
    ln_pgv = (0.5 + 0.5 * M - 0.8 * np.log(R + 10.0) + 0.15 * np.log(vs30 / 760))
    return np.exp(ln_pgv) * 100.0  # cm/s

def spectral_acceleration(magnitude, distance_km, period=1.0, vs30=760):
    """Simplified Sa(T) from PGA using site amplification + magnitude scaling."""
    pga = campbell_bozorgnia_pga(magnitude, distance_km, vs30) / 981.0  # back to g
    if period < 0.1:
        amp = 1.0 + 0.5 * np.exp(-magnitude / 5)
    elif period < 1.0:
        amp = 1.5 + 0.3 * np.log(1 + period)
    else:
        amp = 1.8 + 0.2 * np.log(1 + period)
    decay = np.exp(-distance_km / (50.0 + 20.0 * magnitude))
    return pga * amp * decay * 981.0  # cm/s²

def compute_mmi_from_pga(pga_cm_s2):
    """MMI from PGA (Wald et al. 1999)."""
    pga_g = pga_cm_s2 / 981.0
    return np.where(pga_g < 0.0015, 1,
           np.where(pga_g < 0.0064, 2,
           np.where(pga_g < 0.014, 3,
           np.where(pga_g < 0.039, 4,
           np.where(pga_g < 0.092, 5,
           np.where(pga_g < 0.180, 6,
           np.where(pga_g < 0.340, 7,
           np.where(pga_g < 0.600, 8,
           np.where(pga_g < 1.100, 9, 10)))))))))

def compute_mmi_from_pgv(pgv_cm_s):
    """MMI from PGV (Wald & Worden 2000)."""
    pgv_mm = pgv_cm_s * 10.0
    return np.where(pgv_mm < 0.1, 1,
           np.where(pgv_mm < 1.0, 2,
           np.where(pgv_mm < 5.0, 3,
           np.where(pgv_mm < 15.0, 4,
           np.where(pgv_mm < 50.0, 5,
           np.where(pgv_mm < 100.0, 6,
           np.where(pgv_mm < 200.0, 7,
           np.where(pgv_mm < 400.0, 8,
           np.where(pgv_mm < 800.0, 9, 10)))))))))


# ── Elastic wave solver (displacement formulation, leapfrog) ────────
def simulate_elastic_wave(params):
    """
    2D elastic wave equation using displacement formulation with
    leapfrog time integration.

    ∂²u_x/∂t² = (λ+2μ)∂²u_x/∂x² + μ∂²u_x/∂z² + λ∂²u_z/∂x∂z + f_x/ρ
    ∂²u_z/∂t² = μ∂²u_z/∂x² + (λ+2μ)∂²u_z/∂z² + λ∂²u_x/∂x∂z + f_z/ρ

    Supports P-waves (VP), S-waves (VS), and surface (Rayleigh) waves
    via a low-velocity surface layer.

    CFL: VP*dt/dx ≤ 1/√2 ≈ 0.707 for 2D stability.
    """
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    magnitude = float(params.get('magnitude', 6.5))
    depth_km = float(params.get('depth_km', 15))
    duration_s = float(params.get('duration_seconds', 30))
    lat = float(params.get('lat', 35.68))
    lon = float(params.get('lon', 139.65))

    # Grid spacing: 0.5 km/cell
    dx = 500.0  # meters
    dz = dx
    # CFL for 2D elastic: VP*dt/dx ≤ 1/√2 ≈ 0.707
    # dt = 0.03 → CFL = 6000*0.03/500 = 0.36 (safe)
    dt = 0.03   # time step (s)

    # ── Velocity model: layered half-space with surface low-velocity layer ──
    z_cells = np.arange(gs)
    z_depth = z_cells * dz / 1000.0  # km

    vp = np.full((gs, gs), VP_CRUST, dtype=np.float64)
    vs = np.full((gs, gs), VS_CRUST, dtype=np.float64)
    rho = np.full((gs, gs), RHO_CRUST, dtype=np.float64)

    # Surface low-velocity layer (0–2 km depth) → generates Rayleigh waves
    surface_layer = z_depth < 2.0
    vp[surface_layer] = 1500.0   # m/s (weathered sediment)
    vs[surface_layer] = 400.0    # m/s
    rho[surface_layer] = 1800.0  # kg/m³

    # Depth-dependent velocity increase (gradient) for realistic wave speeds
    for i in range(gs):
        if z_depth[i] > 20.0:
            grad = 1.0 + (z_depth[i] - 20.0) / 100.0
            vp[:, i] = VP_CRUST * grad
            vs[:, i] = VS_CRUST * grad

    # Lame parameters
    lam = rho * (vp**2 - 2 * vs**2)
    mu = rho * vs**2

    # ── Displacement arrays (leapfrog: need u^{n-1} and u^n) ──
    ux_prev = np.zeros((gs, gs), dtype=np.float64)
    ux_curr = np.zeros((gs, gs), dtype=np.float64)
    uz_prev = np.zeros((gs, gs), dtype=np.float64)
    uz_curr = np.zeros((gs, gs), dtype=np.float64)

    # ── Source: Ricker wavelet force at depth ──
    cy, cx = gs // 2, gs // 2
    src_depth_cells = int(depth_km * 1000 / dz)
    src_y = min(cy + src_depth_cells, gs - 2)

    f0 = 1.5  # dominant frequency (Hz)
    t0_src = 1.5 / f0  # source delay
    src_amp = 1e3 * (magnitude - 3.0)  # force amplitude

    # ── Sponge layer (damping zone near boundaries) ──
    margin = max(10, gs // 16)
    damp = np.ones((gs, gs), dtype=np.float64)
    for i in range(margin):
        f = (margin - i) / margin
        damp[i, :] *= f
        damp[-i-1, :] *= f
        damp[:, i] *= f
        damp[:, -i-1] *= f

    # ── Time stepping ──
    total_steps = int(duration_s / dt)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    print(f"\n{'='*60}")
    print("TERRANOETIS — ELASTIC WAVE SIMULATION (Displacement Formulation)")
    print(f"{'='*60}")
    print(f"M{magnitude:.1f} @ {lat:.4f}, {lon:.4f} | depth={depth_km}km | grid={gs}x{gs}")
    print(f"VP: {vp[cy,cx]:.0f} m/s | VS: {vs[cy,cx]:.0f} m/s | dt={dt}s | CFL={vp[cy,cx]*dt/dx:.3f}")
    print(f"Total steps: {total_steps}")

    # Precompute coefficients for interior points
    lam_int = lam[1:-1, 1:-1]
    mu_int = mu[1:-1, 1:-1]
    rho_int = rho[1:-1, 1:-1]
    dt2 = dt * dt
    dx2 = dx * dx
    dz2 = dz * dz
    dx_dz_4 = 4 * dx * dz

    for step_i in range(total_steps):
        t = step_i * dt

        # ── Source injection (vertical force) ──
        arg = np.pi * f0 * (t - t0_src)
        ricker = (1 - 2 * arg**2) * np.exp(-arg**2)
        src_val = src_amp * ricker * dt2 / rho_int[cy-1, cx-1] if 0 < cy < gs-1 and 0 < cx < gs-1 else 0

        # ── Compute spatial derivatives (5-point Laplacian + 4-point mixed) ──
        # For interior points (1..gs-2, 1..gs-2)
        # ∂²u_x/∂x²
        d2ux_dx2 = (ux_curr[2:, 1:-1] - 2*ux_curr[1:-1, 1:-1] + ux_curr[:-2, 1:-1]) / dx2
        # ∂²u_x/∂z²
        d2ux_dz2 = (ux_curr[1:-1, 2:] - 2*ux_curr[1:-1, 1:-1] + ux_curr[1:-1, :-2]) / dz2
        # ∂²u_z/∂x∂z (4-point stencil)
        d2uz_dxdz = (uz_curr[2:, 2:] - uz_curr[2:, :-2] - uz_curr[:-2, 2:] + uz_curr[:-2, :-2]) / dx_dz_4

        # ∂²u_z/∂x²
        d2uz_dx2 = (uz_curr[2:, 1:-1] - 2*uz_curr[1:-1, 1:-1] + uz_curr[:-2, 1:-1]) / dx2
        # ∂²u_z/∂z²
        d2uz_dz2 = (uz_curr[1:-1, 2:] - 2*uz_curr[1:-1, 1:-1] + uz_curr[1:-1, :-2]) / dz2
        # ∂²u_x/∂x∂z (4-point stencil)
        d2ux_dxdz = (ux_curr[2:, 2:] - ux_curr[2:, :-2] - ux_curr[:-2, 2:] + ux_curr[:-2, :-2]) / dx_dz_4

        # ── Leapfrog update: u^{n+1} = 2u^n - u^{n-1} + dt² * (spatial + source) ──
        ux_next = np.zeros_like(ux_curr)
        uz_next = np.zeros_like(uz_curr)

        # Interior update
        ux_next[1:-1, 1:-1] = (
            2 * ux_curr[1:-1, 1:-1] - ux_prev[1:-1, 1:-1] +
            dt2 * ((lam_int + 2*mu_int) * d2ux_dx2 + mu_int * d2ux_dz2 + lam_int * d2uz_dxdz) / rho_int
        )
        uz_next[1:-1, 1:-1] = (
            2 * uz_curr[1:-1, 1:-1] - uz_prev[1:-1, 1:-1] +
            dt2 * (mu_int * d2uz_dx2 + (lam_int + 2*mu_int) * d2uz_dz2 + lam_int * d2uz_dxdz) / rho_int
        )

        # Source injection (vertical force at depth)
        if 0 < src_y < gs-1 and 0 < cx < gs-1:
            uz_next[src_y, cx] += src_val

        # Apply sponge layer
        ux_next *= damp
        uz_next *= damp

        # Update for next step
        ux_prev = ux_curr
        ux_curr = ux_next
        uz_prev = uz_curr
        uz_curr = uz_next

        # ── Snapshot ──
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            # Ground velocity (time derivative of displacement)
            vx = (ux_curr - ux_prev) / dt
            vz = (uz_curr - uz_prev) / dt
            v_mag = np.sqrt(vx**2 + vz**2)
            peak_vel = float(v_mag.max())

            # Displacement magnitude
            disp_mag = np.sqrt(ux_curr**2 + uz_curr**2)

            snapshots.append({
                'displacement': disp_mag.astype(np.float32),
                'velocity': v_mag.astype(np.float32),
                'time_seconds': round(t, 2),
                'peak_velocity_ms': peak_vel,
            })
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                print(f"  [{pct:5.1f}%] t={t:.1f}s | peak_vel={peak_vel:.4f} m/s")

    elapsed = time.time() - t0

    # ── GMPE-based ShakeMap ──
    cy, cx = gs // 2, gs // 2
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    dist_km = np.sqrt((y - cy)**2 + (x - cx)**2) * (dx / 1000.0)

    # Epicentral distance correction for depth
    dist_km = np.sqrt(dist_km**2 + depth_km**2)

    # PGA from GMPE
    pga = campbell_bozorgnia_pga(magnitude, dist_km, vs30=760)
    pga = np.clip(pga, 0, 2000)

    # PGV from GMPE
    pgv = campbell_bozorgnia_pgv(magnitude, dist_km, vs30=760)
    pgv = np.clip(pgv, 0, 200)

    # Spectral acceleration (Sa at 1s)
    sa_1s = spectral_acceleration(magnitude, dist_km, period=1.0, vs30=760)
    sa_1s = np.clip(sa_1s, 0, 2000)

    # MMI from PGA (primary) and PGV (secondary)
    mmi_pga = compute_mmi_from_pga(pga)
    mmi_pgv = compute_mmi_from_pgv(pgv)
    mmi = np.maximum(mmi_pga, mmi_pgv)

    # ── Surface wave amplification ──
    vs_surface = vs[0, 0]  # surface layer Vs
    vs_bedrock = vs[gs // 4, 0]  # bedrock Vs
    amplification = np.where(
        z_depth < 2.0,
        1.0 + 2.0 * (vs_bedrock / vs_surface - 1.0),
        1.0
    )

    final = {
        'pga_cm_s2': pga.astype(np.float32),
        'pgv_cm_s': pgv.astype(np.float32),
        'sa_1s_cm_s2': sa_1s.astype(np.float32),
        'mmi': mmi.astype(np.float32),
        'final_displacement': snapshots[-1]['displacement'] if snapshots else np.zeros((gs, gs), dtype=np.float32),
        'final_velocity': snapshots[-1]['velocity'] if snapshots else np.zeros((gs, gs), dtype=np.float32),
        'max_pga': float(pga.max()),
        'max_pgv': float(pgv.max()),
        'max_mmi': float(mmi.max()),
        'epicenter_cells_broken': int((mmi >= 8).sum()),
        'surface_amplification': float(amplification.max()),
    }

    print(f"\n[DONE] {elapsed:.1f}s | max_PGA={final['max_pga']:.1f} cm/s² | "
          f"max_PGV={final['max_pgv']:.2f} cm/s | max_MMI={final['max_mmi']:.0f} | "
          f"surf_amp={final['surface_amplification']:.1f}x")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'magnitude': magnitude, 'depth_km': depth_km,
                       'duration_seconds': duration_s, 'lat': lat, 'lon': lon,
                       'vp_crust': VP_CRUST, 'vs_crust': VS_CRUST},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'wave_type': 'elastic_p_s_surface',
                         'solver': 'displacement_leapfrog'}}


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Earthquake Simulation (Elastic Wave)")
    print("=" * 60)
    params_path = 'params.json'
    if os.path.exists(params_path):
        with open(params_path) as f:
            params = json.load(f)
    else:
        params = {'grid_size': 256, 'magnitude': 6.5, 'depth_km': 15,
                  'duration_seconds': 30, 'lat': 35.68, 'lon': 139.65}
    try:
        result = simulate_elastic_wave(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/pga_cm_s2.npy', result['final']['pga_cm_s2'])
        np.save(f'{out}/pgv_cm_s.npy', result['final']['pgv_cm_s'])
        np.save(f'{out}/sa_1s_cm_s2.npy', result['final']['sa_1s_cm_s2'])
        np.save(f'{out}/mmi.npy', result['final']['mmi'])
        np.save(f'{out}/final_displacement.npy', result['final']['final_displacement'])
        np.save(f'{out}/final_velocity.npy', result['final']['final_velocity'])
        snap_d = np.stack([s['displacement'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_u_curr.npy', snap_d)
        snap_v = np.stack([s['velocity'] for s in result['snapshots']])
        np.save(f'{out}/snapshots_velocity.npy', snap_v)
        np.save(f'{out}/snapshot_times.npy', np.array([s['time_seconds'] for s in result['snapshots']]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_pga': result['final']['max_pga'],
                                'max_pgv': result['final']['max_pgv'],
                                'max_mmi': result['final']['max_mmi'],
                                'epicenter_cells_broken': result['final']['epicenter_cells_broken'],
                                'surface_amplification': result['final']['surface_amplification']},
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
