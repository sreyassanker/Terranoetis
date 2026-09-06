"""
validate_convergence.py — numerical verification for the landslide kernel.

A "certified-grade" model must prove three things beyond a single pretty run:
  1. Mass is conserved (closed-box test, machine precision).
  2. Answers converge under mesh refinement (grid-convergence study).
  3. Terrain fidelity for a coarse→simulation upsampling path is quantified.

Run:  python3 validate_convergence.py

Prints a report and exits non-zero if any gate fails.
"""
import os, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main as m  # noqa: E402  (landslide kernel)

CONSERV_TOL = 1e-8          # closed-box relative mass error
RUNOUT_CONV_TOL = 0.25      # |Ro256 - Ro128|/Ro256 (loose convergence gate)
GRID_SIZES = [64, 128, 256]


def report(title, rows, fmt):
    print(f"\n== {title} ==")
    print("  " + " | ".join(rows))
    for r in fmt:
        print("  " + " | ".join(str(x) for x in r))


def main() -> int:
    failed = False

    # ── 1. Mass conservation (closed box, machine precision) ──
    print(f"\n[1] Closed-box mass conservation (tolerance {CONSERV_TOL})")
    ches = []
    for ent, erod in [(0.0, 0.0), (0.01, 5.0)]:
        passed, fin, exp, err = m.verify_closed_box(gs=64, steps=400,
                                                     entrainment_rate=ent,
                                                     erodible_depth_m=erod)
        ches.append((ent, err))
        failed |= not passed

    # ── 2. Grid convergence study ψ(h/2) − ψ(h) → 0 ──
    print(f"\n[2] Grid-convergence study at {GRID_SIZES}")
    # FIX the domain so gs↑ refines dx on the SAME area.
    base = {'trigger_type': 'earthquake', 'magnitude': 6.5, 'pga_threshold': 0.15,
            'rainfall_mm': 200, 'duration_hours': 0.5, 'friction_angle': 35,
            'cohesion': 500, 'lat': 36.1699, 'lon': -115.8090, 'extent_km': 5.12}
    # Inject ONE fixed 256×256 terrain field for every grid size so the sims
    # refine the SAME continuous terrain (nested), not three noise realisations.
    # This is also the real client path (Cesium terrain → kernel upsample).
    terrain_hi = m.generate_terrain(256, 20.0)
    stats = {}
    for gs in GRID_SIZES:
        t0 = time.time()
        r = m.simulate_landslide(dict(
            base, grid_size=gs,
            terrain=terrain_hi.flatten().tolist(), terrain_gs=256,
        ))
        f = r['final']
        print(f"  [conv] gs={gs} dx={r['params']['cell_size_m']:.2f}m "
              f"max_depth={f['max_depth']:.2f} runout={f['max_runout_km']:.3f} "
              f"area={f['affected_area_km2']:.2f} ({time.time()-t0:.0f}s)")
        stats[gs] = {
            'max_depth': f['max_depth'], 'runout_km': f['max_runout_km'],
            'area_km2': f['affected_area_km2'],
            'sec': time.time() - t0,
        }
    report('Grid convergence on a FIXED 5.12 km domain with refined dx',
           ['gs', 'dx(m)', 'max_depth(m)', 'runout(km)', 'area(km²)', 'sec'],
           [[g, f"{5.12 * 1000 / g:.2f}", f"{stats[g]['max_depth']:.2f}",
             f"{stats[g]['runout_km']:.3f}", f"{stats[g]['area_km2']:.2f}",
             f"{stats[g]['sec']:.0f}"] for g in GRID_SIZES])
    try:
        # Refine twice (64→128→256): relative change should shrink toward 0.
        c1 = abs(stats[128]['area_km2'] - stats[64]['area_km2']) / max(stats[128]['area_km2'], 1e-9)
        c2 = abs(stats[256]['area_km2'] - stats[128]['area_km2']) / max(stats[256]['area_km2'], 1e-9)
        print(f"\n  area refinement $\\Delta_1$={c1:.3f} → $\\Delta_2$={c2:.3f} "
              f"(should decrease toward 0; gate ≤ {RUNOUT_CONV_TOL})")
        failed |= not (c2 <= RUNOUT_CONV_TOL) or c2 > c1 + 0.1
        d1 = abs(stats[128]['max_depth'] - stats[64]['max_depth']) / max(stats[128]['max_depth'], 1e-9)
        d2 = abs(stats[256]['max_depth'] - stats[128]['max_depth']) / max(stats[256]['max_depth'], 1e-9)
        print(f"  depth refinement $\\Delta_1$={d1:.3f} → $\\Delta_2$={d2:.3f}")
        failed |= not (d2 <= RUNOUT_CONV_TOL) or d2 > d1 + 0.1
    except Exception:
        failed = True

    # ── 3. Terrain upsampling fidelity (64→256 bilinear) ──
    print(f"\n[3] Terrain upsampling fidelity (64×64 → 256×256 bilinear)")
    dx = 20.0
    full = m.generate_terrain(256, dx)
    coarse = full[::4, ::4]                       # 64×64 honest downsample
    up = m._bilinear_upsample(coarse, 64, 256)
    rmse = float(np.sqrt(np.mean((up - full) ** 2)))
    peak = float(np.max(full) - np.min(full))
    print(f"  terrain RMSE = {rmse:.3f} m  (rel {rmse/peak:.1%} of {peak:.0f} m relief)")
    failed |= rmse > max(0.1 * peak, 30.0)

    print(f"\n{'PASS — all gates OK' if not failed else 'FAIL — see gate(s) above'}")
    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())