"""
calibrate.py — calibrate Voellmy friction parameters (μ, ξ) to an observed event.

"Certified-grade" debris-flow modelling requires the free parameters to be fit
to a real slide, not guessed. This does a coarse grid search over (μ, ξ),
scoring each trial by how closely the simulated runout distance matches the
observed runout (in km) you supply from a documented event.

For a deeper fit you would extend the objective to match deposit extent +
thickness + arrival time and use a nonlinear optimizer; this is the calibration
scaffold the model needs as its lowest-cost step.

Sample runout resources: Hungr et al. (2001) runout databases, or local
geohazard surveys of the site you are modelling.

Run:  python3 calibrate.py --observed-runout-km 2.8
"""
import argparse, os, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main as m  # noqa: E402

MU_GRID = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
XI_GRID = [100.0, 250.0, 500.0, 800.0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--observed-runout-km', type=float, required=True,
                    help='Observed landslide runout distance (km) from a documented event.')
    ap.add_argument('--grid-size', type=int, default=128, help='Simulation grid (smaller = faster calibration).')
    ap.add_argument('--hours', type=float, default=0.5, help='Simulated duration in hours.')
    ap.add_argument('--terrain-gs0', type=int, default=0, help='If >0, calibrate with a coarse real-terrain grid from params.json.')
    args = ap.parse_args()

    target = args.observed_runout_km
    base = {
        'grid_size': args.grid_size, 'trigger_type': 'earthquake', 'magnitude': 6.5,
        'pga_threshold': 0.15, 'rainfall_mm': 200, 'duration_hours': args.hours,
        'friction_angle': 35, 'cohesion': 500, 'lat': 36.1699, 'lon': -115.8090,
    }

    # Optional: calibrate against the SAME real terrain the user runs live.
    tp = 'params.json'
    if args.terrain_gs0 > 0 and os.path.exists(tp):
        with open(tp) as f:
            import json
            js = json.load(f)
        if js.get('terrain') and js.get('terrain_gs', 0) == args.terrain_gs0:
            base['terrain'] = js['terrain']
            base['terrain_gs'] = js['terrain_gs']
            print(f"[CALIBRATE] using real terrain {args.terrain_gs0}×{args.terrain_gs0} from {tp}")

    print(f"[CALIBRATE] target runout = {target:.2f} km")
    print(f"[CALIBRATE] grid search over {len(MU_GRID)}×{len(XI_GRID)} = {len(MU_GRID)*len(XI_GRID)} trials")
    best = None
    t_start = time.time()
    for mu in MU_GRID:
        for xi in XI_GRID:
            t0 = time.time()
            r = m.simulate_landslide(dict(base, mu=mu, xi=xi))
            ro = r['final']['max_runout_km']
            err = abs(ro - target)
            trial = {'mu': mu, 'xi': xi, 'runout_km': ro, 'err': err,
                     'max_depth': r['final']['max_depth'], 'sec': time.time() - t0}
            print(f"[CALIBRATE] μ={mu:.2f} ξ={xi:4.0f} → runout={ro:.2f} km (err {err:.2f})")
            if best is None or err < best['err']:
                best = trial
    print(f"\n[CALIBRATE] BEST: μ={best['mu']:.2f}, ξ={best['xi']:.0f}, "
          f"runout={best['runout_km']:.2f} km (obs {target:.2f}), "
          f"err={best['err']:.2f} km, max_depth={best['max_depth']:.1f} m, "
          f"elapsed={time.time()-t_start:.0f}s")
    print("[CALIBRATE] rerun the live simulation with these μ/ξ values.")
    return 0


if __name__ == '__main__':
    sys.exit(main())