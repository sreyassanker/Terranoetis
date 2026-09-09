# Landslide debris flow — narrative

Verified parameters, convergence numbers and measured runs: [landslide.html](landslide.html).

## What the scenario represents

The model is the depth-averaged Voellmy–Salm debris-flow equations: a Mohr–Coulomb infinite-slope assessment turns a steepness/susceptibility field into a source mass, and the flow is routed under gravity with Coulomb plus turbulent (velocity-squared) basal resistance, optional velocity-proportional bed entrainment, and one-way outflow boundaries. The friction pair (μ, ξ) is not asserted from the literature run-to-run — it is treated as free calibration parameters, which is the certified-grade practice for quantitative debris-flow work.

## Calibration and uncertainty are first-class

The platform exposes the same kernel to two scientific endpoints: a grid-search calibration against an observed runout distance (a documented event value — the code's own docstring insists on this), and Monte-Carlo quantification that returns per-cell depth statistics (P50/P95/exceedance) for an ensemble. This review re-ran the shipped convergence script: the area refinement metric passes its 0.25 gate across 64/128/256 grids and the closed-box conservation error is zero.

## Honest limits

Source localization is heuristic (steepness and susceptibility thresholds with documented caps so the failure mass is physical rather than grid-wide); the main() path does not itself invoke the conservation verifier (the convergence script is the authority); and in-domain mass-ledger drift of ~1.6 % appeared in one measured run — the code states its genuine proof is the closed-box test, not the algebraic ledger. All of this is on the page with citations.
