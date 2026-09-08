# Tsunami propagation — narrative

Verified data and all measured behaviour — including the known instability — are on [tsunami.html](tsunami.html).

## What the scenario represents

A megathrust-style offshore rupture is modelled as a vertical seafloor displacement — a rectangular dip-slip patch whose amplitude scales with seismic moment and whose dimensions grow with magnitude — imposed on the water column over real GEBCO 2020 bathymetry, then propagated with the shallow-water equations using a finite-volume HLL/minmod solver. That is the standard textbook architecture for screening-scale tsunami modelling, and the design intent (generation → shoaling → runup toward the drawn coast) is sound.

## What this review found

Executed carefully, the kernel's behaviour is uncomfortable: its own conservation gate passes (as designed — it runs on a flat water column where the problematic terms vanish), flat-bed propagation is stable at a conservative timestep, but every run over non-flat bathymetry — including a real GEBCO grid fetched off Tohoku through the same endpoint the product uses — grew without bound in the free-surface field. The instability sits in the momentum update's explicit bathymetry source term, which is not well-balanced, and in boundary handling that couples opposite domain edges; the default main-loop timestep additionally exceeds the stability bound of its own second-order scheme. The full mechanism decomposition, with reproduction commands, is the D-1 register entry on the [methodology page](../methodology.html#known-limitations).

## What that means for users

Treat tsunami output as unvalidated science: the page states this in its own words, and no scenario result should inform decisions until the solver is corrected (the flood kernel already demonstrates the needed ingredient — hydrostatic reconstruction — on this same codebase). We are documenting a defect, not hiding one.

## Why real bathymetry is mandatory anyway

An earlier revision fabricated a smooth parabolic ocean floor. The kernel now refuses to run without a real GEBCO sample, because a tsunami's path, speed and runup are defined by the seafloor you did not supply.
