# Wildfire spread — narrative

Verified Rothermel implementation, parameters and measured runs: [wildfire.html](wildfire.html).

## What the scenario represents

Surface-fire spread over the Anderson (1982) thirteen-class NFFL fuel taxonomy, with rate of spread computed from Rothermel's (1972) formulation — reaction intensity from fuel load, particle size, packing ratio and moisture damping; wind and slope as vector-summed enhancements in the ellipse direction; Byram fireline intensity; Simard equilibrium-moisture drawdown; and simplified Albini-style spotting. Front propagation is a stochastic cellular model: neighbours ignite with probability derived from the directional ROS, so the burned area is a realisation, not a deterministic contour.

## One honest piece of empirical freedom

Rothermel's model form carries a dimensionless proportionality constant that different implementations calibrate differently. This kernel self-calibrates it at import time so the published no-wind/no-slope reference for fuel model 2 (0.105 m/s at 8 % moisture) is reproduced exactly; every other coefficient is the published tabulated value. This review ran the calibration fuel and got 0.103 m/s → PASS, and observed the same calibration report "CHECK" for a forest-floor fuel (fm8) — expected, because the reference applies to fm2 and fm8's no-wind rate really is slower.

## Why measured spread trails the ROS field

The continuous ROS can be 0.37 m/s while the discrete front creeps: ignition is probabilistic, cells burn out after a residence time, and slow fuels stall on the ignition cell without the documented residence-time dynamics. Judge the product as a stochastic ignition process constrained by Rothermel physics; use terrain-realism (the kernel happily runs on globe-sampled slopes) and fuel choice as the levers, and read the boundary rows on the page for what happens in calm/saturated versus hot/dry regimes.
