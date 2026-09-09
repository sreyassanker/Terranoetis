# Getting started

This is the narrative companion to [Getting started (site page)](../getting-started.html), which carries the verified commands, measured outputs and feature-availability tables. Read this file for context; trust the page for numbers.

## What Terranoetis is

Terranoetis is a real-time geospatial intelligence platform. A React 19 + CesiumJS client renders a WebGL globe; an Express/TypeScript API serves live data from public providers, a catalog of 150 literature-cited analytical equations, and seven hazard-physics simulation kernels; the same API hosts an AI chat pipeline with dual-process (System 1 / System 2) cognition and continuous monitoring engines. Everything runs on your machine: the analytical engine and three simulation kernels need no external credentials at all.

## Mental model

Three facts orient everything else:

1. **The API is the product boundary.** The globe UI and any script you write hit the same `/api` endpoints. If you can `curl` it, you can automate it.
2. **Simulations are kernels, not cloud services.** Each hazard is a Python file in `kaggle-kernels/`. Three of them (earthquake, wildfire, hurricane) are executed locally by the server with `python3`; four (flood, tsunami, volcano, landslide) are dispatched to Kaggle as an execution venue — the code itself is pure NumPy, run on CPU instances except flood-sim, whose kernel metadata requests Kaggle's GPU accelerator.
3. **Nothing is fabricated silently.** Inputs that are required but missing raise at the client boundary; analytical tools that cannot obtain real data return NaN with an explanation. The docs mirror this: every claim on the site carries a `file:line` citation, and unexecuted claims are labelled.

## First hour

1. Install and run: the commands and the measured health payload are on the [site page](../getting-started.html#install).
2. Run one simulation end-to-end: a `curl` earthquake job completes in well under a second with no keys configured — the page shows the transcript.
3. Read one capability page top to bottom (start with [earthquake](../capabilities/earthquake.html)) to see what a fully-cited page contains: equations, parameter contract, outputs, validity limits, measured runs, reproduction.
4. When you need raw endpoints, use the [API reference](../reference/api.html) and [`/api/openapi.json`](https://github.com/sreyassanker/Terranoetis/blob/main/server/routes/openapi.ts); when you need the simulation wire format, use the [simulation job API](../reference/simulation-api.html).

## Where each document lives

Markdown in this repository is the source of truth for prose; the HTML site (generated from `scripts/docs/`) carries structured, verified data and navigation. If you edit prose, edit Markdown; if you edit a parameter table or an equation, edit the page spec under `scripts/docs/` and rebuild (`node scripts/docs/build.mjs`), then pass the quality gate (`node scripts/docs/quality-gate.mjs`).
