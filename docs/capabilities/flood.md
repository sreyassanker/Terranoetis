# Flood inundation — narrative

Verified parameters, gates and measured mass-balance numbers: [flood.html](flood.html).

## What the scenario represents

Rainfall-runoff inundation over topography, solved with the local-inertial (diffusive-inertial) shallow-water system — the same simplification family used by LISFLOOD-FP, SFINCS and RIM2D, chosen because it captures overland flow across entire DEMs at modest cost. Water accumulates where rain falls, routes into lows, ponds in depressions; roughness comes from real ESA WorldCover land cover mapped through a published Manning table, infiltration is a saturation-modulated constant loss (labelled “Green-Ampt” in the source; described here as implemented — see limitation D-8).

## Why conservation is a hard gate

The kernel refuses to run unless it passes two numerical proofs built into `main()`: a closed-box mass-conservation test at 1e-9 relative tolerance and a lake-at-rest well-balanced test. This review executed the solver directly: both ran, the rain event completed with a reported mass-balance closure error of 0.0000 %, and the observed behaviour at minimum rainfall (all infiltration, no inundation) matched the physics. A flood model that silently loses or invents water is worse than no model; the gate makes that failure mode loud.

## Venue notes

The kernel writes results to Kaggle's working directory unconditionally, so a standalone local run computes the physics but fails at the write step — observed and documented (D-2). The production path pushes it to Kaggle, where that path exists.
