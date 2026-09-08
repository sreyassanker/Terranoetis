# Volcanic eruption — narrative

Verified data, benchmark results and measured budgets: [volcano.html](volcano.html).

## What the scenario represents

The kernel models an eruption as three coupled physical pieces, each with a lineage in the literature: lava flows as a depth-averaged viscous yield-fluid (conservative shallow-water equations with Arrhenius viscosity, temperature-dependent Bingham yield, radiative/convective cooling with a crust-insulation factor, and enthalpy-porosity solidification); the eruption column as a Morton–Taylor buoyant plume integrated from vent conditions to neutral buoyancy; and ash as an advection–diffusion–settling transport problem over height-resolved winds with Schiller–Naumann drag. Terrain is supplied from real relief sampling — the kernel refuses to invent a cone.

## How it is validated

Unusually for this platform, the volcano kernel ships its own benchmark suite, and this review re-ran it: mass conservation on flat and steep closed beds, an ash isopach comparison against Pinatubo 1990–91 observed thickness–distance data, and a lava-runout comparison against the ~13.5 km Kilauea 2018 flow (the model returns 15.0 km). Four of four gates pass. The per-run stdout also reports exact mass and ash budgets (injected = deposited + airborne + advected-off-domain) at machine precision — visible in the measured table on the page.

## What to read into the numbers

VEI bins are order-of-magnitude categories — the code says so and offers a `mass_scale` knob so ensembles can explore that spread instead of trusting the bin midpoint. The plume model and the historical column-height table disagree (the VEI 3 default table value is 10 km; a physically integrated column from the same mass flux reaches a few hundred metres), which is exactly the distinction between bulk tephra flux and fine-ash injection height. Use the ensemble endpoints for hazard ranking; use the defaults as scenario illustrations.
