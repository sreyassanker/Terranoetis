"""
Terranoetis — Professional 3D Earthquake Elastic Wave + GMPE ShakeMap Simulation
Upgraded: 3D Elastic Wave Equation (displacement formulation, 3D leapfrog stencil)
with P-wave, S-wave, Rayleigh, and Love wave propagation.
3D GMPE-based PGA/PGV/Sa + ShakeMap with MMI.

Physics:
  - 3D elastodynamic wave equation in displacement formulation (ux, uy, uz):
      ρ ∂²u_x/∂t² = (λ+2μ) ∂²u_x/∂x² + μ (∂²u_x/∂y² + ∂²u_x/∂z²) 
                    + (λ+μ) (∂²u_y/∂x∂y + ∂²u_z/∂x∂z) + f_x
      ρ ∂²u_y/∂t² = (λ+2μ) ∂²u_y/∂y² + μ (∂²u_y/∂x² + ∂²u_y/∂z²) 
                    + (λ+μ) (∂²u_x/∂x∂y + ∂²u_z/∂y∂z) + f_y
      ρ ∂²u_z/∂t² = (λ+2μ) ∂²u_z/∂z² + μ (∂²u_z/∂x² + ∂²u_z/∂y²) 
                    + (λ+μ) (∂²u_x/∂x∂z + ∂²u_y/∂y∂z) + f_z

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np


# ── JSON-safe conversion ───────────────────────────────────────────
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


# ── Physical Constants ──────────────────────────────────────────────
RHO_CRUST = 2700.0     # kg/m³ — average crustal density
VP_CRUST = 6000.0      # m/s — P-wave velocity (crust)
VS_CRUST = 3464.0      # m/s — S-wave velocity (crust) ≈ VP/√3


# ── GMPE Attenuation Model (NGA-West2 Formulation) ──────────────────
C0, C1, C2, C3, C4, C5 = -4.2411, 0.80, -0.80, 5.0, -0.0040, -0.30

def nga_west2_pga(magnitude, distance_km, vs30=760):
    """NGA-West2 Peak Ground Acceleration (PGA) in cm/s²."""
    M = magnitude
    R = np.maximum(distance_km, 1.0)
    ln_pga_g = (C0 + C1 * M + C2 * np.log(R + C3)
                + C4 * (R + C3) + C5 * np.log(vs30 / 760.0))
    return np.exp(ln_pga_g) * 981.0  # g → cm/s²

def nga_west2_pgv(magnitude, distance_km, vs30=760):
    """NGA-West2 Peak Ground Velocity (PGV) in cm/s."""
    M = magnitude
    R = np.maximum(distance_km, 1.0)
    ln_pgv = (-0.5 + 0.58 * M - 0.90 * np.log(R + 4.0)
              - 0.0032 * (R + 4.0) - 0.20 * np.log(vs30 / 760.0))
    return np.exp(ln_pgv)

def spectral_acceleration(magnitude, distance_km, period=1.0, vs30=760):
    """1.0-second Spectral Acceleration Sa(T) (cm/s²)."""
    pga_cm = nga_west2_pga(magnitude, distance_km, vs30)
    amp = 1.8 + 0.2 * np.log(1.0 + period)
    decay_R = np.exp(-distance_km / (60.0 + 30.0 * magnitude))
    return pga_cm * amp * decay_R

def compute_mmi_from_pga(pga_cm_s2):
    """Modified Mercalli Intensity from PGA (Wald et al. 1999)."""
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
    """Modified Mercalli Intensity from PGV (Wald & Worden 2000)."""
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


# ── 3D Elastic Wave Solver (Displacement Formulation) ──────────────
def simulate_elastic_wave_3d(params):
    """
    3D elastic wave equation solver using explicit leapfrog finite difference.
    Grid shape: (nx, ny, nz) representing X (east-west), Y (north-south), Z (depth).
    """
    t0 = time.time()
    
    # 3D Grid dimensions (nx, ny, nz)
    nx = int(params.get('grid_size_x', params.get('grid_size', 96)))
    ny = int(params.get('grid_size_y', params.get('grid_size', 96)))
    nz = int(params.get('grid_size_z', 48))

    magnitude = float(params.get('magnitude', 6.5))
    depth_km = float(params.get('depth_km', 12.0))
    duration_s = float(params.get('duration_seconds', 20.0))
    lat = float(params.get('lat', 35.68))
    lon = float(params.get('lon', 139.65))

    extent_km = float(params.get('extent_km', 48.0))
    dx = (extent_km * 1000.0 / nx) if extent_km > 0 else 500.0  # dx = dy = dz in meters
    dy = dx
    dz = dx

    # 3D CFL condition: Vp * dt * sqrt(1/dx² + 1/dy² + 1/dz²) ≤ 1
    dt = 0.02  # Time step in seconds

    # ── Create 3D Velocity & Density Model ──
    z_indices = np.arange(nz)
    z_depth_km = (z_indices * dz) / 1000.0

    vp = np.full((nx, ny, nz), VP_CRUST, dtype=np.float64)
    vs = np.full((nx, ny, nz), VS_CRUST, dtype=np.float64)
    rho = np.full((nx, ny, nz), RHO_CRUST, dtype=np.float64)

    # Sedimentary layer (0 - 2 km depth) -> Rayleigh/Love wave trap
    for z_i in range(nz):
        depth_val = z_depth_km[z_i]
        if depth_val < 2.0:
            vp[:, :, z_i] = 1800.0
            vs[:, :, z_i] = 500.0
            rho[:, :, z_i] = 1900.0
        elif depth_val > 15.0:
            grad = 1.0 + (depth_val - 15.0) / 80.0
            vp[:, :, z_i] = VP_CRUST * grad
            vs[:, :, z_i] = VS_CRUST * grad

    # 3D Lamé parameters
    lam = rho * (vp**2 - 2.0 * vs**2)
    mu = rho * vs**2

    # ── 3D Displacement Arrays ──
    ux_prev = np.zeros((nx, ny, nz), dtype=np.float64)
    ux_curr = np.zeros((nx, ny, nz), dtype=np.float64)
    uy_prev = np.zeros((nx, ny, nz), dtype=np.float64)
    uy_curr = np.zeros((nx, ny, nz), dtype=np.float64)
    uz_prev = np.zeros((nx, ny, nz), dtype=np.float64)
    uz_curr = np.zeros((nx, ny, nz), dtype=np.float64)

    # ── Source Allocation ──
    src_x = nx // 2
    src_y = ny // 2
    src_z = min(int(depth_km * 1000.0 / dz), nz - 2)

    f0 = 1.2  # Dominant frequency
    t0_src = 1.5 / f0
    M0_src = 10.0 ** (1.5 * magnitude + 9.1)
    M0_ref = 10.0 ** (1.5 * 6.0 + 9.1)
    src_amp = 1e4 * np.sqrt(M0_src / M0_ref)

    # ── 3D Damping Sponge Layer (6 boundary faces) ──
    margin = max(6, min(nx, ny, nz) // 10)
    damp = np.ones((nx, ny, nz), dtype=np.float64)
    for i in range(margin):
        factor = (margin - i) / margin
        # X boundaries
        damp[i, :, :] *= factor
        damp[-i-1, :, :] *= factor
        # Y boundaries
        damp[:, i, :] *= factor
        damp[:, -i-1, :] *= factor
        # Z boundaries
        damp[:, :, i] *= factor
        damp[:, :, -i-1] *= factor

    total_steps = int(duration_s / dt)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    print(f"\n{'='*60}")
    print("TERRANOETIS — 3D ELASTIC WAVE SIMULATION")
    print(f"{'='*60}")
    print(f"M{magnitude:.1f} @ {lat:.4f}, {lon:.4f} | depth={depth_km}km | Grid: {nx}x{ny}x{nz}")
    print(f"CFL Index: {VP_CRUST * dt * np.sqrt(3.0 / dx**2):.3f}")

    dt2 = dt * dt
    dx2, dy2, dz2 = dx * dx, dy * dy, dz * dz
    dx_dy_4 = 4.0 * dx * dy
    dx_dz_4 = 4.0 * dx * dz
    dy_dz_4 = 4.0 * dy * dz

    # Slices for inner grid calculations (1..N-2)
    lam_i = lam[1:-1, 1:-1, 1:-1]
    mu_i = mu[1:-1, 1:-1, 1:-1]
    rho_i = rho[1:-1, 1:-1, 1:-1]

    wallclock_max = float(params.get('wallclock_max_sec', 480))

    for step_i in range(total_steps):
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Reached limit at step {step_i}")
            break
        t = step_i * dt

        # Source Wavelet (Ricker Force)
        arg = np.pi * f0 * (t - t0_src)
        ricker = (1.0 - 2.0 * arg**2) * np.exp(-arg**2)
        f_val = src_amp * ricker * dt2 / rho[src_x, src_y, src_z]

        # ── 3D Derivatives calculation for Ux, Uy, Uz ──
        # Direct second partial derivatives
        d2ux_dx2 = (ux_curr[2:, 1:-1, 1:-1] - 2*ux_curr[1:-1, 1:-1, 1:-1] + ux_curr[:-2, 1:-1, 1:-1]) / dx2
        d2ux_dy2 = (ux_curr[1:-1, 2:, 1:-1] - 2*ux_curr[1:-1, 1:-1, 1:-1] + ux_curr[1:-1, :-2, 1:-1]) / dy2
        d2ux_dz2 = (ux_curr[1:-1, 1:-1, 2:] - 2*ux_curr[1:-1, 1:-1, 1:-1] + ux_curr[1:-1, 1:-1, :-2]) / dz2

        d2uy_dx2 = (uy_curr[2:, 1:-1, 1:-1] - 2*uy_curr[1:-1, 1:-1, 1:-1] + uy_curr[:-2, 1:-1, 1:-1]) / dx2
        d2uy_dy2 = (uy_curr[1:-1, 2:, 1:-1] - 2*uy_curr[1:-1, 1:-1, 1:-1] + uy_curr[1:-1, :-2, 1:-1]) / dy2
        d2uy_dz2 = (uy_curr[1:-1, 1:-1, 2:] - 2*uy_curr[1:-1, 1:-1, 1:-1] + uy_curr[1:-1, 1:-1, :-2]) / dz2

        d2uz_dx2 = (uz_curr[2:, 1:-1, 1:-1] - 2*uz_curr[1:-1, 1:-1, 1:-1] + uz_curr[:-2, 1:-1, 1:-1]) / dx2
        d2uz_dy2 = (uz_curr[1:-1, 2:, 1:-1] - 2*uz_curr[1:-1, 1:-1, 1:-1] + uz_curr[1:-1, :-2, 1:-1]) / dy2
        d2uz_dz2 = (uz_curr[1:-1, 1:-1, 2:] - 2*uz_curr[1:-1, 1:-1, 1:-1] + uz_curr[1:-1, 1:-1, :-2]) / dz2

        # Cross partial derivatives
        d2uy_dxdy = (uy_curr[2:, 2:, 1:-1] - uy_curr[2:, :-2, 1:-1] - uy_curr[:-2, 2:, 1:-1] + uy_curr[:-2, :-2, 1:-1]) / dx_dy_4
        d2uz_dxdz = (uz_curr[2:, 1:-1, 2:] - uz_curr[2:, 1:-1, :-2] - uz_curr[:-2, 1:-1, 2:] + uz_curr[:-2, 1:-1, :-2]) / dx_dz_4
        
        d2ux_dxdy = (ux_curr[2:, 2:, 1:-1] - ux_curr[2:, :-2, 1:-1] - ux_curr[:-2, 2:, 1:-1] + ux_curr[:-2, :-2, 1:-1]) / dx_dy_4
        d2uz_dydz = (uz_curr[1:-1, 2:, 2:] - uz_curr[1:-1, 2:, :-2] - uz_curr[1:-1, :-2, 2:] + uz_curr[1:-1, :-2, :-2]) / dy_dz_4

        d2ux_dxdz = (ux_curr[2:, 1:-1, 2:] - ux_curr[2:, 1:-1, :-2] - ux_curr[:-2, 1:-1, 2:] + ux_curr[:-2, 1:-1, :-2]) / dx_dz_4
        d2uy_dydz = (uy_curr[1:-1, 2:, 2:] - uy_curr[1:-1, 2:, :-2] - uy_curr[1:-1, :-2, 2:] + uy_curr[1:-1, :-2, :-2]) / dy_dz_4

        # ── 3D Leapfrog Updates ──
        ux_next = np.zeros_like(ux_curr)
        uy_next = np.zeros_like(uy_curr)
        uz_next = np.zeros_like(uz_curr)

        ux_next[1:-1, 1:-1, 1:-1] = (
            2.0 * ux_curr[1:-1, 1:-1, 1:-1] - ux_prev[1:-1, 1:-1, 1:-1] +
            dt2 * ((lam_i + 2.0*mu_i) * d2ux_dx2 + mu_i * (d2ux_dy2 + d2ux_dz2) +
                   (lam_i + mu_i) * (d2uy_dxdy + d2uz_dxdz)) / rho_i
        )

        uy_next[1:-1, 1:-1, 1:-1] = (
            2.0 * uy_curr[1:-1, 1:-1, 1:-1] - uy_prev[1:-1, 1:-1, 1:-1] +
            dt2 * ((lam_i + 2.0*mu_i) * d2uy_dy2 + mu_i * (d2uy_dx2 + d2uy_dz2) +
                   (lam_i + mu_i) * (d2ux_dxdy + d2uz_dydz)) / rho_i
        )

        uz_next[1:-1, 1:-1, 1:-1] = (
            2.0 * uz_curr[1:-1, 1:-1, 1:-1] - uz_prev[1:-1, 1:-1, 1:-1] +
            dt2 * ((lam_i + 2.0*mu_i) * d2uz_dz2 + mu_i * (d2uz_dx2 + d2uz_dy2) +
                   (lam_i + mu_i) * (d2ux_dxdz + d2uy_dydz)) / rho_i
        )

        # Force application at epicenter depth
        uz_next[src_x, src_y, src_z] += f_val
        ux_next[src_x, src_y, src_z] += 0.5 * f_val  # Shear component

        # Boundary absorption
        ux_next *= damp
        uy_next *= damp
        uz_next *= damp

        # Advance timesteps
        ux_prev, ux_curr = ux_curr, ux_next
        uy_prev, uy_curr = uy_curr, uy_next
        uz_prev, uz_curr = uz_curr, uz_next

        # Snapshots
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            vx = (ux_curr - ux_prev) / dt
            vy = (uy_curr - uy_prev) / dt
            vz = (uz_curr - uz_prev) / dt
            
            v_mag_3d = np.sqrt(vx**2 + vy**2 + vz**2)
            disp_mag_3d = np.sqrt(ux_curr**2 + uy_curr**2 + uz_curr**2)

            snapshots.append({
                'displacement_surface': disp_mag_3d[:, :, 0].astype(np.float32),
                'velocity_surface': v_mag_3d[:, :, 0].astype(np.float32),
                'displacement_3d': disp_mag_3d.astype(np.float32),
                'velocity_3d': v_mag_3d.astype(np.float32),
                'time_seconds': round(t, 2),
                'peak_velocity_ms': float(v_mag_3d.max()),
            })

    elapsed = time.time() - t0

    # ── Calculate Surface 2D Field & ShakeMap GMPEs ──
    x_grid, y_grid = np.meshgrid(np.arange(nx), np.arange(ny), indexing='ij')
    dist_2d_km = np.sqrt((x_grid - src_x)**2 + (y_grid - src_y)**2) * (dx / 1000.0)
    dist_3d_km = np.sqrt(dist_2d_km**2 + depth_km**2)

    pga = nga_west2_pga(magnitude, dist_3d_km, vs30=760)
    pgv = nga_west2_pgv(magnitude, dist_3d_km, vs30=760)
    sa_1s = spectral_acceleration(magnitude, dist_3d_km, period=1.0, vs30=760)

    mmi_pga = compute_mmi_from_pga(pga)
    mmi_pgv = compute_mmi_from_pgv(pgv)
    mmi = np.maximum(mmi_pga, mmi_pgv)

    final = {
        'pga_cm_s2': pga.astype(np.float32),
        'pgv_cm_s': pgv.astype(np.float32),
        'sa_1s_cm_s2': sa_1s.astype(np.float32),
        'mmi': mmi.astype(np.float32),
        'final_displacement_3d': snapshots[-1]['displacement_3d'] if snapshots else np.zeros((nx, ny, nz), dtype=np.float32),
        'final_velocity_3d': snapshots[-1]['velocity_3d'] if snapshots else np.zeros((nx, ny, nz), dtype=np.float32),
        'max_pga': float(pga.max()),
        'max_pgv': float(pgv.max()),
        'max_mmi': float(mmi.max()),
        'epicenter_cells_broken': int((mmi >= 8).sum()),
    }

    print(f"\n[DONE 3D] {elapsed:.1f}s | Max PGA={final['max_pga']:.1f} cm/s² | "
          f"Max PGV={final['max_pgv']:.2f} cm/s | Max MMI={final['max_mmi']:.0f}")

    return {
        'final': final,
        'snapshots': snapshots,
        'params': {
            'grid_size_x': nx, 'grid_size_y': ny, 'grid_size_z': nz,
            'magnitude': magnitude, 'depth_km': depth_km,
            'duration_seconds': duration_s, 'lat': lat, 'lon': lon,
            'vp_crust': VP_CRUST, 'vs_crust': VS_CRUST,
            'cell_size_m': dx
        },
        'metadata': {
            'elapsed_seconds': elapsed,
            'num_snapshots': len(snapshots),
            'wave_type': 'elastic_3d_p_s_rayleigh_love',
            'solver': '3d_displacement_leapfrog'
        }
    }


# ── Executable Entry point ──────────────────────────────────────────
EMBEDDED_PARAMS = None

def _load_params():
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
    print("TERRANOETIS — 3D Kaggle Earthquake CFD/Wave Simulation")
    print("=" * 60)
    params = _load_params()
    if params is None:
        params = {
            'grid_size_x': 96, 'grid_size_y': 96, 'grid_size_z': 48,
            'magnitude': 6.5, 'depth_km': 12, 'duration_seconds': 20,
            'lat': 35.68, 'lon': 139.65
        }

    try:
        result = simulate_elastic_wave_3d(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)

        # Save surface fields for primary overlay
        np.save(f'{out}/pga_cm_s2.npy', result['final']['pga_cm_s2'])
        np.save(f'{out}/pgv_cm_s.npy', result['final']['pgv_cm_s'])
        np.save(f'{out}/sa_1s_cm_s2.npy', result['final']['sa_1s_cm_s2'])
        np.save(f'{out}/mmi.npy', result['final']['mmi'])

        # Save 3D volumetric fields for 3D visualization
        np.save(f'{out}/final_displacement_3d.npy', result['final']['final_displacement_3d'])
        np.save(f'{out}/final_velocity_3d.npy', result['final']['final_velocity_3d'])

        if result['snapshots']:
            np.save(f'{out}/snapshots_u_curr.npy', np.stack([s['displacement_surface'] for s in result['snapshots']]))
            np.save(f'{out}/snapshots_velocity.npy', np.stack([s['velocity_surface'] for s in result['snapshots']]))
            np.save(f'{out}/snapshot_times.npy', np.array([s['time_seconds'] for s in result['snapshots']]))
        
        meta = {
            'params': result['params'],
            'metadata': result['metadata'],
            'final_stats': {
                'max_pga': result['final']['max_pga'],
                'max_pgv': result['final']['max_pgv'],
                'max_mmi': result['final']['max_mmi'],
                'epicenter_cells_broken': result['final']['epicenter_cells_broken'],
            },
            'snapshot_count': len(result['snapshots'])
        }
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(_json_safe(meta), f, indent=2)

        print(f"\n{'='*60}\n3D SIMULATION COMPLETE\n{'='*60}")

    except Exception as e:
        print(f"\n[ERROR] {e}")
        traceback.print_exc()
        with open('/kaggle/working/error.log', 'w') as f:
            traceback.print_exc(file=f)
        raise

if __name__ == '__main__':
    main()