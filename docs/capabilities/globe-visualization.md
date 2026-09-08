# 3D globe visualization — narrative

Verified counts and overlay architecture: [globe-visualization.html](globe-visualization.html).

## The rendering thesis

The globe is the interface's core claim: geospatial intelligence is legible in situ. The client is deliberately thin over CesiumJS: live entities (flights, vessels, satellites, quakes, fires) become primitives refreshed from the API; analytical and simulation results become draped scalar fields, arrow fields, particle streams and intensity colormaps rendered by purpose-built GPU *rendering* primitives; and the same data powers 2D panels, DuckDB workbench and PDF reports.

## What "GPU" means here — and where it does not

The WebGL layer is GPU-accelerated in the ordinary browser sense (shaders, primitives, post-process sensor looks). That is a rendering fact. It must not be read as compute: the simulation kernels that produce those fields execute NumPy on CPU (see [hazard simulations](hazard-simulations.html#modes) and correction C-1). Keeping the two straight is one of the reasons this documentation set exists.

## Scale honestly stated

A single App shell of ~11k lines coordinating 11 lazily-loaded panels and 41 rendering modules is not the architecture a greenfield review would choose; it is the architecture that exists, and the counts are verified. The overlay system for simulation results is the newest, most structured subsystem (shared colormaps, legend/animation widgets, per-hazard wrappers over a generic scalar-surface primitive), and the "honest 2D mode" exists precisely so results drape flatly when terrain cannot support them.
