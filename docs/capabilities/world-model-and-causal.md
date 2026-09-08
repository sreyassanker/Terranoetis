# World model & causal reasoning — narrative

Verified structures and timers: [world-model-and-causal.html](world-model-and-causal.html).

## The purpose

Between "what is happening" (live data) and "what was computed" (engines, kernels) sits the question the platform actually promises researchers: what happens next, and why? The world-model subsystem records causal structure (SQLite-backed causal graph with embedded entities and edges; a temporal KG v2 whose edges decay on a 72-hour time constant; write-through of chat interactions as graph edges), fuses forecasts from five weighted sources (physics, statistical, pattern, causal, LLM) with per-domain weight sets, and — critically — keeps a ledger: predictions are scored when they resolve (Brier, calibration) on a six-hour sweep.

## Prediction hygiene over prediction marketing

The subsystem's most important property is the scoring loop: forecasts are persisted as falsifiable claims with horizons, and the validation report exists so that accuracy is measured, never asserted. The physics layer feeding it is explicit hand-coded relations (Gutenberg–Richter, Omori, vapour-pressure, Rothermel) with their constants in source, not hidden weights. Causal discovery through the optional DoWhy microservice is an external analysis path, off unless deployed.

## What to avoid reading into it

"World model" here denotes a structured state store plus forecast/counterfactual machinery — not a learned simulator of the Earth. The earthgen latent module and dream/fork engines explore synthetic scenario space; they are research scaffolding with honest headers (one literally states the entropy mixer "is not a neural net") and their outputs are clearly separated from the kernels' physics in every UI surface.
