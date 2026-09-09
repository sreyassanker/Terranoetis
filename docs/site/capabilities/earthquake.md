# Earthquake ground motion — narrative

Verified data, parameters and measured runs: [earthquake.html](earthquake.html).

## What the scenario represents

An earthquake scenario answers one planning question: if a mainshock of magnitude M occurred at this point at this depth, what would the ground shaking field look like around it? The kernel computes the accepted engineering answer directly — the NGA-West2 ground-motion prediction equation of Boore, Stewart, Seyhan & Atkinson (2014) for peak acceleration, peak velocity and 1-second spectral acceleration, with the standard linear-plus-nonlinear site response for the chosen site class, converted to Modified Mercalli Intensity through the USGS instrumental relations. The animation you see on the globe is that field revealed along S-wave arrival times; the hazard itself is computed instantly.

## What it is not

It is not a rupture simulation. There is no fault geometry, directivity or finite rupture; distance is hypocentral from a point source; the magnitude mechanism is unspecified (base case); and no ground-motion variability is drawn — these are the kernel's own documented limits, reproduced verbatim on the page. For scenario screening and education the simplifications are conventional; they are not appropriate for site-specific assessment, where Rupture-to-Scenario style methods and regional GMPE variants are required.

## Why it runs locally

Evaluating a GMPE median on a 256×256 grid is arithmetic, not integration: the measured kernel time for a full ShakeMap was 0.008 seconds (single observation, M 7.5). There is no reason to queue it on a remote machine, so the server spawns it with `python3` and returns results in well under a second end-to-end.

## Reading a ShakeMap honestly

PGA values are medians of empirical distributions whose spread is large (roughly a factor of two in either direction at fixed M and R — the source paper's log-standard-deviation terms `h` are in the coefficient table). MMI bands are decision aids, not physics: the bands saturate for great-earthquake near-fields, which the kernel metadata states. Use the map to rank places, not to certify them.
