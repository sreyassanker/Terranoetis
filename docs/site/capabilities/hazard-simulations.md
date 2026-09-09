# Hazard simulations — narrative

The structured overview — layer table, execution-mode matrix, job lifecycle and endpoints — is at [hazard-simulations.html](hazard-simulations.html). This file explains the design.

## Why this shape

The platform's disaster scenarios are scientific instruments, not visual effects. Each hazard therefore has exactly one Python kernel (in `kaggle-kernels/`) that is the single source of truth for its physics. The same kernel code is reused by the calibration and Monte-Carlo endpoints: for landslide and volcano the server imports the kernel's simulate-function into a short-lived `python3` process rather than copying its math into TypeScript. When a physics result appears anywhere in the product — map overlay, report, or chat answer — it was computed by that kernel.

## How a run travels

The user's UI state (sliders, a drawn study box, an optional globe-click origin point) is converted to a wire request by a zod contract in the client. The contract exists so that no component between the UI and the kernel needs to re-check units or ranges: bounds mirror the kernels' own validity windows, and a missing required value throws rather than being defaulted. A server-side runner then picks the execution venue: the three small 2D kernels run locally in seconds; the four heavier kernels are pushed to Kaggle. Both paths produce the same directory layout — NumPy grids plus a metadata.json — so the streaming status, grid download and GeoTIFF endpoints do not care where the computation happened.

## Honest execution venues

“Kaggle GPU kernels” was the historical description of the remote path. It is imprecise, and the site now states the verified reality: every kernel is pure NumPy (there are no GPU code paths), and only the flood kernel's Kaggle metadata requests the GPU accelerator. The venue is Kaggle because it provides a free, reproducible compute environment with an output filesystem the pipeline expects — not because the simulation needs a GPU. The full correction is logged in the [discrepancy log](../methodology.html#discrepancy-log).

## Trusting a result

Three layers make a run auditable. The kernels refuse to emit results when their internal physics or conservation gates fail. Every page in this section shows a reproduction command that produced at least one number on the page. And each page carries a measured table that distinguishes what was executed from what was only read — the distinction is preserved even when it is inconvenient, including for the tsunami solver, whose known instability is documented prominently rather than glossed.
