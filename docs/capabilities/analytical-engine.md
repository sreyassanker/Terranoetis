# Analytical equation engine — narrative

Verified counts, measured tool outputs and the full workflow: [analytical-engine.html](analytical-engine.html); the catalog itself is [MODELS.md](../MODELS.md).

## What it is

150 deterministic scientific functions — one per row of the catalog — spanning 26 domains from boundary-layer meteorology to orbital mechanics. Each function is an implementation of a published equation, carries its source citation in the catalog, ships a worked `steps[]` derivation with every result, and is covered by math-verification unit tests (the 1,653-test suite that gates this engine exercises the equations directly, no mocks). None of them is a machine-learning approximation: a tool returns what its cited paper returns.

## How a tool runs

A user's question or panel request enters through `contextEngine.computeWithContext`, which first enriches inputs from live feeds (terrain elevation, weather, ocean state, seismic catalog) so the same tool called twice at different places computes different, real numbers. The 7-stage workflow in `toolWorkflows.ts` then wraps validation, preprocessing, computation, QC, uncertainty and interpretation around the equation call. Two contracts govern the whole surface: **a tool must never throw** (unexpected input paths return honest NaN with an explanation), and **no value is fabricated** (missing catalog data yields NaN and a warning, not a plausible constant).

## How to read a result

Every result includes: the equation as evaluated, the parameter substitution, unit, a QC verdict against the source's valid range, and an uncertainty statement (method: analytical propagation, empirical RMSE, or qualitative). Treat "qualitative" honestly — some tools (e.g. disaster-risk indices) are defined in their sources without error models; the uncertainty block says so instead of inventing one.

## The parts

Parts I–VII run from Earth-system core (atmosphere, hydrology, seismology, remote sensing, soils) through biosphere and chemistry, ocean and coastal mechanics, geomorphology and cryosphere, climate dynamics, space environment, and finally engineering/risk/assimilation. The per-domain tool counts in the site table are measured from the catalog structure, not copied from prose.
