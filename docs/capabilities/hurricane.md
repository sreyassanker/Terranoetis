# Hurricane wind & surge — narrative

Verified equations, parameters, gate output and measured runs: [hurricane.html](hurricane.html).

## What the scenario represents

A landfalling tropical cyclone composed of five validated parametric/numerical pieces: the Holland (1980) gradient-wind vortex (with the Atkinson–Hollan empirical B estimate and Coriolis correction, advected along a track that crosses the user-pinned landfall point at mid-duration); a 2D nonlinear shallow-water surge forced by wind stress (saturated drag coefficient), bottom friction and the storm's pressure field, over real coastal topography when supplied; fetch-limited wave growth capped at the Pierson–Moskowitz fully-developed limit with USACE breaking and setup rules; Lonfat-shaped parametric rainfall; and USDA TR-55 curve-number runoff accumulating on land. The composite "surge" product follows the NHC/USGS convention: water level over ocean, inundation depth over land.

## What the physics gate catches

Before emitting fields, the kernel verifies its own relations — wind at R_max against V_max, B in its physical band, the inverse-barometer constant, a TR-55 reference value, wave-growth ordering, rainfall shape — and refuses to produce output if any check fails. This review watched the gate pass on every run and printed its internals: B = 2.29, V(Rmax) = 69.0 against a 70 target, 41.1 mm runoff for the CN75 reference event.

## Reading the numbers

Two structural limits deserve emphasis: a point-vortex model has no eyewall fine structure and no intensification/decay, and grid resolution matters — when R_max is comparable to the cell size the sampled wind maximum falls well below the storm's true peak (observed directly: a Cat 5 with 5 km RMW on 2.5 km cells peaked at 32 m/s). Choose extent so that R_max spans several cells, and read the Cat-5 boundary row on the page as a demonstration of that sampling behaviour, not a defect of Holland's model.
