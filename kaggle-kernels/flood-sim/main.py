"""
Terranoetis — Shallow Water Equations (SWE) Flood Simulation
Runs on Kaggle CPU/GPU.

Solves the 2D Saint-Venant equations using a stable Lax-Friedrichs scheme.
TUNED for visually impressive flooding: higher resolution, heavy rainfall,
dam breach scenario, steep terrain with floodplain.

Author: Terranoetis / Freebuff
"""

import json
import os
import time
import traceback
import numpy as np
import torch

# Force CPU for Kaggle P100 compatibility
DEVICE = torch.device('cpu')
print(f"[INIT] Using device: {DEVICE}")

# Physical velocity cap (m/s) — flood waters rarely exceed this; guards
# against wet/dry front spikes producing absurd arrow magnitudes.
VMAX_VEL = 30.0


class SWESolver:
    """2D Shallow Water Equations solver — Lax-Friedrichs finite volume."""

    def __init__(self, grid_size=512, dx=5.0, dt=0.1, g=9.81, friction=0.005):
        self.N = grid_size
        self.dx = dx
        self.dt = dt
        self.g = g
        self.nu = friction
        self.device = DEVICE
        # Physical ceiling — wet/dry fronts + steep terrain shouldn't exceed this
        self.q_max_vel = 30.0  # m/s

        # State: h (depth), hu, hv (momentum)
        shape = (grid_size, grid_size)
        self.h  = torch.zeros(shape, device=self.device, dtype=torch.float64)
        self.hu = torch.zeros(shape, device=self.device, dtype=torch.float64)
        self.hv = torch.zeros(shape, device=self.device, dtype=torch.float64)
        self.z  = torch.zeros(shape, device=self.device, dtype=torch.float64)
        self.rainfall = torch.zeros(shape, device=self.device, dtype=torch.float64)

    def set_terrain(self, terrain_np):
        from scipy.ndimage import zoom as scipy_zoom
        if terrain_np.shape[0] != self.N or terrain_np.shape[1] != self.N:
            zf = (self.N / terrain_np.shape[0], self.N / terrain_np.shape[1])
            terrain_np = scipy_zoom(terrain_np, zf, order=1)
        self.z = torch.from_numpy(terrain_np.astype(np.float64)).to(self.device)
        print(f"[TERRAIN] {self.N}x{self.N}, elev {self.z.min():.1f}–{self.z.max():.1f} m  "
              f"relief {self.z.max() - self.z.min():.1f} m")

    def set_initial_water(self, frac_cy=0.5, frac_cx=0.5, frac_r=0.15, depth=5.0):
        cy, cx, r = int(frac_cy * self.N), int(frac_cx * self.N), int(frac_r * self.N)
        yy, xx = torch.meshgrid(
            torch.arange(self.N, dtype=torch.float64, device=self.device),
            torch.arange(self.N, dtype=torch.float64, device=self.device), indexing='ij')
        dist = torch.sqrt((yy - cy)**2 + (xx - cx)**2)
        mask = dist < r
        self.h[mask] = depth * (1.0 - dist[mask] / r)
        print(f"[INIT] Water blob: radius={r} cells, depth={depth:.1f} m, "
              f"volume={self.h.sum().item()*self.dx**2/1e6:.1f} M m³")

    def set_dam_reservoir(self, dam_y=0.3, dam_width=0.08, reservoir_depth=25.0):
        """Place a dam wall across the valley and fill the reservoir behind it."""
        N = self.N
        yy = torch.arange(N, dtype=torch.float64, device=self.device).unsqueeze(1)

        # Reservoir region: everything above the dam line
        dam_row = int(dam_y * N)
        half_w = int(dam_width * N)

        # Fill reservoir (upstream of dam) with water
        for row in range(0, dam_row):
            dist_to_center = torch.abs(torch.arange(N, dtype=torch.float64, device=self.device) - N // 2)
            # Width of valley at this row increases away from dam
            valley_half = int((dam_row - row) * 0.4) + half_w
            in_valley = dist_to_center < valley_half
            depth_factor = reservoir_depth * (1.0 - (dam_row - row) / dam_row * 0.6)
            self.h[row, in_valley] = depth_factor
        print(f"[DAM] Reservoir at row {dam_row}, depth={reservoir_depth:.0f} m, "
              f"volume={self.h.sum().item()*self.dx**2/1e6:.1f} M m³")

    def set_rainfall(self, mm_hr):
        self.rainfall.fill_(mm_hr / 1000.0 / 3600.0)
        print(f"[RAIN] {mm_hr:.1f} mm/hr")

    def step(self):
        """One time step using Lax-Friedrichs (guaranteed stable for CFL ≤ 0.5)."""
        h, hu, hv, z = self.h, self.hu, self.hv, self.z
        g, dx, dt, nu = self.g, self.dx, self.dt, self.nu

        # Wet mask: where water exists above terrain
        h = torch.clamp(h, min=0.0)
        total = z + h
        wet = h > 0.01

        # Velocities (safe division)
        h_safe = torch.where(wet, h, torch.ones_like(h))
        u = hu / h_safe
        v = hv / h_safe

        # Lax-Friedrichs averaged values (neighbor averages)
        # Pad with zeros (solid wall boundary)
        h_r  = torch.roll(h,  -1, dims=1);  h_r[:, -1]  = 0
        h_l  = torch.roll(h,   1, dims=1);  h_l[:, 0]   = 0
        h_d  = torch.roll(h,  -1, dims=0);  h_d[-1, :]  = 0
        h_u  = torch.roll(h,   1, dims=0);  h_u[0, :]   = 0

        hu_r = torch.roll(hu, -1, dims=1); hu_r[:, -1]  = 0
        hu_l = torch.roll(hu,  1, dims=1); hu_l[:, 0]   = 0
        hu_d = torch.roll(hu, -1, dims=0); hu_d[-1, :]  = 0
        hu_u = torch.roll(hu,  1, dims=0); hu_u[0, :]   = 0
        hv_r = torch.roll(hv, -1, dims=1); hv_r[:, -1]  = 0
        hv_l = torch.roll(hv,  1, dims=1); hv_l[:, 0]   = 0
        hv_d = torch.roll(hv, -1, dims=0); hv_d[-1, :]  = 0
        hv_u = torch.roll(hv,  1, dims=0); hv_u[0, :]   = 0

        # Averaged states (all 4 neighbors)
        h_avg  = 0.25 * (h_r + h_l + h_u + h_d)
        hu_avg = 0.25 * (hu_r + hu_l + hu_u + hu_d)
        hv_avg = 0.25 * (hv_r + hv_l + hv_u + hv_d)

        # ── HYPERBOLIC CORE: conservative flux divergences ────────────────
        # Mass fluxes F_h = hu (x-dir) and G_h = hv (y-dir)
        dF_h_dx = (hu_r - hu_l) / (2.0 * dx)
        dG_h_dy = (hv_d - hv_u) / (2.0 * dx)

        # Clamp velocity before computing nonlinear fluxes so the wet/dry
        # front doesn't send machine-inf into the roll/difference stencils.
        u_clamped = u.clamp(-self.q_max_vel, self.q_max_vel)
        v_clamped = v.clamp(-self.q_max_vel, self.q_max_vel)
        h_clamped = h.clamp(max=200.0)  # 200 m ceiling — beyond this is a numerical artifact

        # Momentum pressure + convective fluxes at cell faces
        # F(hu) = hu²/h + ½·g·h²,   G(hv) = hv²/h + ½·g·h², cross terms hu·hv/h
        gh2_half = 0.5 * g * h_clamped**2
        Fu_x = h_clamped * u_clamped * u_clamped + gh2_half  # = hu²/h + ½gh²
        Fu_y = h_clamped * u_clamped * v_clamped             # cross term
        Gv_x = h_clamped * v_clamped * u_clamped
        Gv_y = h_clamped * v_clamped * v_clamped + gh2_half
        dFu_dx = (torch.roll(Fu_x, -1, dims=1) - torch.roll(Fu_x, 1, dims=1)) / (2.0 * dx)
        dFu_dy = (torch.roll(Fu_y, -1, dims=0) - torch.roll(Fu_y, 1, dims=0)) / (2.0 * dx)
        dGv_dx = (torch.roll(Gv_x, -1, dims=1) - torch.roll(Gv_x, 1, dims=1)) / (2.0 * dx)
        dGv_dy = (torch.roll(Gv_y, -1, dims=0) - torch.roll(Gv_y, 1, dims=0)) / (2.0 * dx)

        # Lateral slopes from terrain (pressure gradient)
        dzdx = torch.zeros_like(z)
        dzdy = torch.zeros_like(z)
        dzdx[:, 1:] = (total[:, 1:] - total[:, :-1]) / dx
        dzdx[:, 0]  = dzdx[:, 1]
        dzdy[1:, :] = (total[1:, :] - total[:-1, :]) / dx
        dzdy[0, :]  = dzdy[1, :]

        # Source terms: friction + gravity slope
        speed = torch.sqrt(u**2 + v**2).clamp(min=1e-8)
        src_hu = -g * h * dzdx - nu * speed * u
        src_hv = -g * h * dzdy - nu * speed * v

        # Update with Lax-Friedrichs (half step average + source)
        # Full 2D Lax-Friedrichs:
        #   h_new  = avg(h)  − dt·[∂(hu)/∂x + ∂(hv)/∂y]   + rain/infiltration
        #   hu_new = avg(hu) − dt·[∂Fu/∂x + ∂Fu/∂y]       + dt·src_hu
        self.h  = h_avg - dt * (dF_h_dx + dG_h_dy) + dt * (self.rainfall - 0.002 * h)
        self.hu = hu_avg - dt * (dFu_dx + dFu_dy) + dt * src_hu
        self.hv = hv_avg - dt * (dGv_dx + dGv_dy) + dt * src_hv

        # Enforce positivity and cap depth (physical ceiling prevents runaway)
        self.h = torch.clamp(self.h, min=0.0, max=200.0)
        self.hu = torch.where(self.h > 0.01, self.hu, torch.zeros_like(self.hu))
        self.hv = torch.where(self.h > 0.01, self.hv, torch.zeros_like(self.hv))
        # Cap momentum so velocity stays in the physically defensible range
        vel_scale = torch.clamp(self.h, min=1e-4)
        self.hu = torch.clamp(self.hu, -self.q_max_vel * vel_scale, self.q_max_vel * vel_scale)
        self.hv = torch.clamp(self.hv, -self.q_max_vel * vel_scale, self.q_max_vel * vel_scale)

        # Replace any NaN/Inf
        self.h  = torch.where(torch.isfinite(self.h),  self.h,  torch.zeros_like(self.h))
        self.hu = torch.where(torch.isfinite(self.hu), self.hu, torch.zeros_like(self.hu))
        self.hv = torch.where(torch.isfinite(self.hv), self.hv, torch.zeros_like(self.hv))

    def generate_heightmap(self, method='valley'):
        from scipy.ndimage import zoom as scipy_zoom, gaussian_filter
        N = self.N
        if method == 'valley':
            # Dramatic river valley with steep walls and wide floodplain
            yy, xx = torch.meshgrid(
                torch.linspace(-1, 1, N, device=self.device),
                torch.linspace(-1, 1, N, device=self.device), indexing='ij')
            # Meandering river centerline
            river_y = (0.25 * torch.sin(xx * 3.5)
                       + 0.12 * torch.sin(xx * 6.2 + 0.5)
                       + 0.06 * torch.sin(xx * 11 + 1.2))
            dist = torch.abs(yy - river_y)

            # Two-zone terrain: flat floodplain near river, steep hills beyond
            floodplain_width = 0.15  # fraction of grid
            fp_dist = torch.clamp(dist - floodplain_width, min=0.0)
            terrain = torch.where(
                dist < floodplain_width,
                5.0 + 15.0 * (dist / floodplain_width)**2,       # gentle floodplain
                20.0 + 180.0 * fp_dist**1.2                       # steep hills
            )
            terrain = terrain.numpy()
            terrain += np.random.randn(N, N).astype(np.float64) * 3
            terrain = gaussian_filter(terrain, sigma=2)

        elif method == 'urban':
            # Urban basin: mostly flat with low retaining walls
            yy, xx = np.meshgrid(np.linspace(-1, 1, N), np.linspace(-1, 1, N))
            # Flat center, ring of hills
            r = np.sqrt(xx**2 + yy**2)
            terrain = np.where(r < 0.3, 5.0, 5.0 + 200.0 * (r - 0.3)**1.5)
            terrain += np.random.randn(N, N).astype(np.float64) * 2
            terrain = gaussian_filter(terrain, sigma=3)

        else:
            noise = np.random.randn(max(4, N // 10), max(4, N // 10))
            terrain = scipy_zoom(noise, N / noise.shape[0], order=1)[:N, :N]
            terrain = ((terrain - terrain.min()) / (terrain.max() - terrain.min() + 1e-8) * 200)

        self.set_terrain(terrain.astype(np.float32))
        return terrain

    def snapshot(self):
        h = self.h.cpu().numpy().astype(np.float32)
        # Compute velocity only at wet cells to avoid inf/nan at dry cells
        wet = h > 0.01
        u = np.zeros_like(h)
        v = np.zeros_like(h)
        hu_np = self.hu.cpu().numpy().astype(np.float32)
        hv_np = self.hv.cpu().numpy().astype(np.float32)
        u[wet] = hu_np[wet] / h[wet]
        v[wet] = hv_np[wet] / h[wet]
        u = np.nan_to_num(u, nan=0.0, posinf=0.0, neginf=0.0)
        v = np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0)
        # Clamp velocities to a physical bound — wet/dry front spikes (hu/h with
        # vanishing h) produce absurd values that would corrupt visualization.
        u = np.clip(u, -VMAX_VEL, VMAX_VEL)
        v = np.clip(v, -VMAX_VEL, VMAX_VEL)
        return {
            'water_depth': h, 'velocity_x': u, 'velocity_y': v,
            'terrain': self.z.cpu().numpy().astype(np.float32),
            'max_depth': float(h.max()), 'total_volume': float(h.sum() * self.dx**2),
            'flooded_cells': int((h > 0.01).sum()),
        }


def run_flood_simulation(params):
    t0 = time.time()
    gs   = int(params.get('grid_size', 512))
    rain = float(params.get('rainfall_mm', 300))
    dur  = float(params.get('duration_hours', 6))
    sat  = float(params.get('soil_saturation', 0.3))
    dam  = params.get('dam_breach', True)
    terr = params.get('terrain_type', 'valley')
    lat  = float(params.get('lat', 29.76))
    lon  = float(params.get('lon', -95.37))

    print(f"\n{'='*60}")
    print(f"TERRANOETIS — FLOOD SWE SIMULATION (TUNED)")
    print(f"{'='*60}")
    print(f"Location: {lat:.4f}, {lon:.4f}")
    print(f"Grid: {gs}x{gs} ({gs**2:,} cells) | Duration: {dur:.1f}h | Device: {DEVICE}")
    print(f"Rainfall: {rain:.0f} mm/hr | Soil sat: {sat:.1f} | Dam breach: {dam}")

    # Use smaller dx for higher spatial resolution (5m per cell), scaled to study area
    extent_km = float(params.get('extent_km', 0.0))
    dx_flood = (extent_km * 1000.0 / gs) if extent_km > 0 else 5.0
    solver = SWESolver(grid_size=gs, dx=dx_flood, dt=0.1, g=9.81, friction=0.005)
    solver.generate_heightmap(method=terr)

    if dam:
        # Dramatic dam breach: large reservoir upstream
        solver.set_dam_reservoir(dam_y=0.30, dam_width=0.06, reservoir_depth=25.0)
    else:
        # Heavy rain event: start with wet ground, moderate initial pooling
        solver.set_initial_water(0.5, 0.5, 0.12, 2.0)

    effective_rain = rain * (1.0 - sat * 0.3)
    solver.set_rainfall(effective_rain)

    dt_sim = solver.dt * 10  # each solver step = 1s sim time
    total_steps = int(dur * 3600 / dt_sim)
    snap_interval = max(1, total_steps // 30)  # 30 snapshots for smoother animation

    print(f"[SIM] {total_steps} steps, snapshot every {snap_interval} steps...")
    snapshots = []
    wallclock_max = float(params.get('wallclock_max_sec', 480))
    print(f"Wall-clock cap: {wallclock_max:.0f}s")
    for step_i in range(total_steps):
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at step {step_i} (elapsed {time.time()-t0:.0f}s)")
            break
        solver.step()
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            s = solver.snapshot()
            s['time_hours'] = step_i * dt_sim / 3600
            snapshots.append(s)
            pct = (step_i + 1) / total_steps * 100
            print(f"  [{pct:5.1f}%] t={s['time_hours']:.1f}h | "
                  f"max={s['max_depth']:.2f}m | vol={s['total_volume']/1e6:.1f}M m³ | "
                  f"flooded={s['flooded_cells']:,}/{gs**2:,}")

    elapsed = time.time() - t0
    final = solver.snapshot()
    flood_pct = final['flooded_cells'] / (gs * gs) * 100
    print(f"\n[DONE] {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"[DONE] max_depth={final['max_depth']:.2f}m, "
          f"volume={final['total_volume']/1e6:.1f}M m³, "
          f"flooded={flood_pct:.1f}% of grid")

    return {
        'final': final, 'snapshots': snapshots,
        'params': {'grid_size': gs, 'rainfall_mm': rain, 'duration_hours': dur,
                    'lat': lat, 'lon': lon, 'soil_saturation': sat,
                    'dam_breach': dam, 'terrain_type': terr,
                    'cell_size_m': dx_flood},
        'metadata': {'device': str(DEVICE), 'elapsed_seconds': elapsed,
                      'total_steps': total_steps, 'num_snapshots': len(snapshots)},
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
    print("TERRANOETIS — Kaggle Flood Simulation (TUNED FOR IMPACT)")
    print("=" * 60)

    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(params, indent=2)}")
    else:
        # Tuned defaults for visually impressive flooding
        params = {
            'lat': 29.76, 'lon': -95.37,
            'rainfall_mm': 300,        # Extreme rainfall (3× before)
            'duration_hours': 6,        # 6× longer duration
            'grid_size': 512,           # 4× more cells (512² vs 256²)
            'soil_saturation': 0.3,     # Low absorption = more runoff
            'dam_breach': True,         # Dramatic dam breach scenario
            'terrain_type': 'valley',   # Steep valley with floodplain
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
            # Wall-clock cap tripped before the first snapshot — ship the
            # final frame as the only snapshot so the client still renders.
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
        print(f"Time: {result['metadata']['elapsed_seconds']:.1f}s | "
              f"Device: {result['metadata']['device']}")
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
