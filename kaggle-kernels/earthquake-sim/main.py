"""
Terranoetis — Earthquake Elastic Wave + GMPE ShakeMap Simulation
Upgraded: 2D elastic wave equation (displacement formulation, leapfrog) with
P-wave, S-wave, and surface-wave (Rayleigh) propagation.
GMPE-based PGA/PGV/Sa + ShakeMap with MMI.

Physics:
  - 2D elastic wave equation in displacement form:
      ∂²u_x/∂t² = (λ+2μ)∂²u_x/∂x² + μ∂²u_x/∂z² + (λ+μ)∂²u_z/∂x∂z + f_x/ρ
      ∂²u_z/∂t² = μ∂²u_z/∂x² + (λ+2μ)∂²u_z/∂z² + (λ+μ)∂²u_x/∂x∂z + f_z/ρ
      (mixed-derivative coefficient is (λ+μ) — receives one power from the
      divergence term and one from the shear (curl) term; bare λ is wrong)
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

# ── GMPE: NGA-West2 magnitude scaling + geometric spreading —┐
# Functional form matches Campbell & Bozorgnia (2014, Earthquake Spectra
# 30(3):1087–1115) far-field branch for PGA, but the coefficients are a
# simplified regional fit (Western US), NOT the full CB14 c0..c11 tables.
# ln(PGA[g]) = c0 + c1·M + c2·ln(R_rup + c3) + c4·(R_rup + c3) + c5·ln(Vs30/760)
# Calibrated to match published NGA-West2 reference points (strike-slip
# crustal, Vs30=760 m/s, joyner-boore distance):
#   M5 @ R=10km→0.085g   M6 @ R=10km→0.19g    M7 @ R=10km→0.42g
#   M7 @ R=30km→0.20g    M7 @ R=100km→0.06g   M8 @ R=10km→0.94g
C0, C1, C2, C3, C4, C5 = -4.2411, 0.80, -0.80, 5.0, -0.0040, -0.30

def nga_west2_pga(magnitude, distance_km, vs30=760):
    """NGA-West2-shaped PGA attenuation in cm/s² (CB14-style fit).
    Returns physically plausible values at all distances (no silent clip
    needed as a regularizer)."""
    M = magnitude
    R = np.maximum(distance_km, 1.0)  # km, avoid singular at epicenter
    ln_pga_g = (C0 + C1 * M + C2 * np.log(R + C3)
                + C4 * (R + C3) + C5 * np.log(vs30 / 760.0))
    return np.exp(ln_pga_g) * 981.0  # g → cm/s²

def nga_west2_pgv(magnitude, distance_km, vs30=760):
    """PGV attenuation (cm/s) — NGA-West2 far-field branch."""
    M = magnitude
    R = np.maximum(distance_km, 1.0)
    ln_pgv = (-0.5 + 0.58 * M - 0.90 * np.log(R + 4.0)
              - 0.0032 * (R + 4.0) - 0.20 * np.log(vs30 / 760.0))
    return np.exp(ln_pgv)  # cm/s

def spectral_acceleration(magnitude, distance_km, period=1.0, vs30=760):
    """Spectral acceleration Sa(T) via a period-dependent amplification
    envelope around the deterministic NGA-West2-shaped PGA (cm/s²)."""
    pga_cm = nga_west2_pga(magnitude, distance_km, vs30)
    if period < 0.1:
        amp = 1.0 + 0.5 * np.exp(-magnitude / 5.0)
    elif period < 1.0:
        amp = 1.5 + 0.3 * np.log(1.0 + period)
    else:
        amp = 1.8 + 0.2 * np.log(1.0 + period)
    # Long-period energy decays faster with distance than peak acceleration
    decay_R = np.exp(-distance_km / (60.0 + 30.0 * magnitude))
    return pga_cm * amp * decay_R

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

    # Grid spacing: 0.5 km/cell, scaled to study area extent
    extent_km = float(params.get('extent_km', 0.0))
    dx = (extent_km * 1000.0 / gs) if extent_km > 0 else 500.0  # meters
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
    # Seismic moment M0 = 10^(1.5·M + 9.1)  (N·m); force amplitude scales
    # with sqrt(M0/M0_ref) so that one magnitude unit doubles the injected
    # energy rather than linearly adding a constant force. Reference Mw=6.0.
    M0_src = 10.0 ** (1.5 * magnitude + 9.1)
    M0_ref = 10.0 ** (1.5 * 6.0 + 9.1)
    src_amp = 1e3 * np.sqrt(M0_src / M0_ref)  # force amplitude (log-moment scaled)

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

    wallclock_max = float(params.get('wallclock_max_sec', 480))
    print(f"Wall-clock cap: {wallclock_max:.0f}s")
    for step_i in range(total_steps):
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at step {step_i} (elapsed {time.time()-t0:.0f}s)")
            break
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

        # Interior update — displacement-form 2D elastic wave equation.
        # The mixed-derivative term requires (λ + μ), not λ alone:
        #   ρ·ü_x = (λ+2μ)·u_x,xx  +  μ·u_x,zz  +  (λ+μ)·u_z,xz  + f_x
        #   ρ·ü_z = μ·u_z,xx  +  (λ+2μ)·u_z,zz  +  (λ+μ)·u_x,xz  + f_z
        ux_next[1:-1, 1:-1] = (
            2 * ux_curr[1:-1, 1:-1] - ux_prev[1:-1, 1:-1] +
            dt2 * ((lam_int + 2*mu_int) * d2ux_dx2 + mu_int * d2ux_dz2 +
                   (lam_int + mu_int) * d2uz_dxdz) / rho_int
        )
        uz_next[1:-1, 1:-1] = (
            2 * uz_curr[1:-1, 1:-1] - uz_prev[1:-1, 1:-1] +
            dt2 * (mu_int * d2uz_dx2 + (lam_int + 2*mu_int) * d2uz_dz2 +
                   (lam_int + mu_int) * d2ux_dxdz) / rho_int
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

    # PGA from NGA-West2-shaped GMPE (calibrated to CB14 reference points)
    pga = nga_west2_pga(magnitude, dist_km, vs30=760)
    n_clip = int((pga > 2000).sum())
    if n_clip > 0:
        print(f"  [GMPE] {n_clip} cells clipped at 2000 cm/s² "
              f"(pre-clip max {float(np.nanmax(pga)):.0f} cm/s²)")
    pga = np.clip(pga, 0, 2000)

    # PGV from GMPE
    pgv = nga_west2_pgv(magnitude, dist_km, vs30=760)
    n_pgv = int((pgv > 200).sum())
    if n_pgv > 0:
        print(f"  [GMPE] {n_pgv} cells PGV-clipped at 200 cm/s")
    pgv = np.clip(pgv, 0, 200)

    # Spectral acceleration (Sa at 1s)
    sa_1s = spectral_acceleration(magnitude, dist_km, period=1.0, vs30=760)
    n_sa = int((sa_1s > 2000).sum())
    if n_sa > 0:
        print(f"  [GMPE] {n_sa} cells Sa-clipped at 2000 cm/s²")
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
                       'vp_crust': VP_CRUST, 'vs_crust': VS_CRUST,
                       'cell_size_m': dx},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'wave_type': 'elastic_p_s_surface',
                         'solver': 'displacement_leapfrog'}}


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
    print("TERRANOETIS — Kaggle Earthquake ShakeMap Simulation")
    print("=" * 60)
    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(params, indent=2)}")
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
        if result['snapshots']:
            np.save(f'{out}/snapshots_u_curr.npy', np.stack([s['displacement'] for s in result['snapshots']]))
            np.save(f'{out}/snapshots_velocity.npy', np.stack([s['velocity'] for s in result['snapshots']]))
            np.save(f'{out}/snapshot_times.npy', np.array([s['time_seconds'] for s in result['snapshots']]))
        else:
            np.save(f'{out}/snapshots_u_curr.npy', np.expand_dims(result['final']['final_displacement'], axis=0))
            np.save(f'{out}/snapshots_velocity.npy', np.expand_dims(result['final']['final_velocity'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
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
