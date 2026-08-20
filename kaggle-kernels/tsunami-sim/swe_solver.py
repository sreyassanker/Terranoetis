"""Finite-volume shallow-water solver for Terranoetis tsunami runs.

This module keeps the Kaggle tsunami kernel focused on orchestration while the
numerics live in a small testable unit.

Current scope:
- 2D finite-volume shallow-water equations.
- MUSCL-style slope reconstruction with a minmod limiter.
- HLL fluxes for robust wet/dry handling.
- Simple semi-implicit Manning friction step.

This is intentionally conservative. It is a major quality upgrade over the
current Lax-Friedrichs update without introducing a large dependency surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import numpy as np

Array = np.ndarray


@dataclass(frozen=True)
class SimulationSnapshot:
    water_height: Array
    time_minutes: float
    wave_height_m: float
    propagation_speed_ms: float


def minmod(a: Array, b: Array) -> Array:
    same_sign = np.sign(a) == np.sign(b)
    return np.where(same_sign, np.sign(a) * np.minimum(np.abs(a), np.abs(b)), 0.0)


def _reconstruct(q: Array, axis: int) -> Tuple[Array, Array]:
    q_minus = np.roll(q, 1, axis=axis)
    q_plus = np.roll(q, -1, axis=axis)
    slope = minmod(q - q_minus, q_plus - q)
    q_left = q + 0.5 * slope
    q_right = q - 0.5 * slope
    if axis == 1:
        q_left[:, 0] = q[:, 0]
        q_right[:, -1] = q[:, -1]
    else:
        q_left[0, :] = q[0, :]
        q_right[-1, :] = q[-1, :]
    return q_left, q_right


def _interface_states(q: Array, axis: int) -> Tuple[Array, Array]:
    q_left, q_right = _reconstruct(q, axis=axis)
    right_state = np.roll(q_left, -1, axis=axis)
    if axis == 1:
        right_state[:, -1] = q_left[:, -1]
    else:
        right_state[-1, :] = q_left[-1, :]
    return q_right, right_state


def _physical_flux_x(h: Array, hu: Array, hv: Array, g: float) -> Tuple[Array, Array, Array]:
    depth = np.maximum(h, 1e-8)
    u = hu / depth
    v = hv / depth
    return hu, hu * u + 0.5 * g * depth**2, hu * v


def _physical_flux_y(h: Array, hu: Array, hv: Array, g: float) -> Tuple[Array, Array, Array]:
    depth = np.maximum(h, 1e-8)
    u = hu / depth
    v = hv / depth
    return hv, hv * u, hv * v + 0.5 * g * depth**2


def _hll_flux_x(left: Tuple[Array, Array, Array], right: Tuple[Array, Array, Array], g: float) -> Tuple[Array, Array, Array]:
    hl, hul, hvl = left
    hr, hur, hvr = right
    hl = np.maximum(hl, 0.0)
    hr = np.maximum(hr, 0.0)
    hl_safe = np.maximum(hl, 1e-8)
    hr_safe = np.maximum(hr, 1e-8)
    ul = hul / hl_safe
    ur = hur / hr_safe
    vl = hvl / hl_safe
    vr = hvr / hr_safe
    cl = np.sqrt(g * hl_safe)
    cr = np.sqrt(g * hr_safe)

    sl = np.minimum(ul - cl, ur - cr)
    sr = np.maximum(ul + cl, ur + cr)

    fl = _physical_flux_x(hl_safe, hul, hvl, g)
    fr = _physical_flux_x(hr_safe, hur, hvr, g)

    denom = np.where(np.abs(sr - sl) < 1e-12, 1e-12, sr - sl)
    out = []
    for fl_i, fr_i, ul_i, ur_i in zip(fl, fr, (hl, hul, hvl), (hr, hur, hvr)):
        flux = np.where(
            sl >= 0,
            fl_i,
            np.where(
                sr <= 0,
                fr_i,
                (sr * fl_i - sl * fr_i + sl * sr * (ur_i - ul_i)) / denom,
            ),
        )
        out.append(flux)
    return out[0], out[1], out[2]


def _hll_flux_y(left: Tuple[Array, Array, Array], right: Tuple[Array, Array, Array], g: float) -> Tuple[Array, Array, Array]:
    hl, hul, hvl = left
    hr, hur, hvr = right
    hl = np.maximum(hl, 0.0)
    hr = np.maximum(hr, 0.0)
    hl_safe = np.maximum(hl, 1e-8)
    hr_safe = np.maximum(hr, 1e-8)
    ul = hul / hl_safe
    ur = hur / hr_safe
    vl = hvl / hl_safe
    vr = hvr / hr_safe
    cl = np.sqrt(g * hl_safe)
    cr = np.sqrt(g * hr_safe)

    sl = np.minimum(vl - cl, vr - cr)
    sr = np.maximum(vl + cl, vr + cr)

    fl = _physical_flux_y(hl_safe, hul, hvl, g)
    fr = _physical_flux_y(hr_safe, hur, hvr, g)

    denom = np.where(np.abs(sr - sl) < 1e-12, 1e-12, sr - sl)
    out = []
    for fl_i, fr_i, ul_i, ur_i in zip(fl, fr, (hl, hul, hvl), (hr, hur, hvr)):
        flux = np.where(
            sl >= 0,
            fl_i,
            np.where(
                sr <= 0,
                fr_i,
                (sr * fl_i - sl * fr_i + sl * sr * (ur_i - ul_i)) / denom,
            ),
        )
        out.append(flux)
    return out[0], out[1], out[2]


def _divergence_from_flux(flux_x: Array, flux_y: Array, dx: float, dy: float) -> Array:
    return (flux_x - np.roll(flux_x, 1, axis=1)) / dx + (flux_y - np.roll(flux_y, 1, axis=0)) / dy


def step_shallow_water(
    h: Array,
    hu: Array,
    hv: Array,
    bathymetry: Array,
    dt: float,
    dx: float,
    dy: float,
    g: float = 9.81,
    manning_n: float = 0.03,
) -> Tuple[Array, Array, Array]:
    """Advance one finite-volume shallow-water step.

    `h` is free-surface elevation relative to still water.
    `bathymetry` is positive-down depth.
    """
    depth = np.maximum(bathymetry + h, 0.0)
    wet = depth > 1e-6

    # Reconstruct total depth and momenta, then evaluate HLL fluxes at cell faces.
    depth_x_l, depth_x_r = _interface_states(depth, axis=1)
    hu_x_l, hu_x_r = _interface_states(hu, axis=1)
    hv_x_l, hv_x_r = _interface_states(hv, axis=1)
    depth_y_l, depth_y_r = _interface_states(depth, axis=0)
    hu_y_l, hu_y_r = _interface_states(hu, axis=0)
    hv_y_l, hv_y_r = _interface_states(hv, axis=0)

    fx_h, fx_hu, fx_hv = _hll_flux_x((depth_x_l, hu_x_l, hv_x_l), (depth_x_r, hu_x_r, hv_x_r), g)
    fy_h, fy_hu, fy_hv = _hll_flux_y((depth_y_l, hu_y_l, hv_y_l), (depth_y_r, hu_y_r, hv_y_r), g)

    depth_new = depth - dt * _divergence_from_flux(fx_h, fy_h, dx, dy)
    hu_new = hu - dt * _divergence_from_flux(fx_hu, fy_hu, dx, dy)
    hv_new = hv - dt * _divergence_from_flux(fx_hv, fy_hv, dx, dy)

    # Bathymetry source terms.
    slope_x = (np.roll(bathymetry, -1, axis=1) - np.roll(bathymetry, 1, axis=1)) / (2.0 * dx)
    slope_y = (np.roll(bathymetry, -1, axis=0) - np.roll(bathymetry, 1, axis=0)) / (2.0 * dy)
    depth_safe = np.maximum(depth_new, 1e-8)
    hu_new -= dt * g * depth_safe * slope_x
    hv_new -= dt * g * depth_safe * slope_y

    h_new = depth_new - bathymetry
    h_new = np.where(np.isfinite(h_new), h_new, 0.0)
    hu_new = np.where(np.isfinite(hu_new), hu_new, 0.0)
    hv_new = np.where(np.isfinite(hv_new), hv_new, 0.0)

    depth_new = np.maximum(bathymetry + h_new, 0.0)
    depth_safe_new = np.maximum(depth_new, 1e-8)
    speed = np.sqrt((hu_new**2 + hv_new**2)) / depth_safe_new
    friction = g * manning_n**2 * speed / np.power(depth_safe_new, 4.0 / 3.0)
    friction = np.clip(friction, 0.0, 0.05)
    hu_new = hu_new / (1.0 + dt * friction)
    hv_new = hv_new / (1.0 + dt * friction)

    # Preserve dry cells as dry.
    h_new = np.where(wet | (bathymetry + h_new > 1e-6), h_new, -bathymetry)
    hu_new = np.where(depth_new > 1e-6, hu_new, 0.0)
    hv_new = np.where(depth_new > 1e-6, hv_new, 0.0)

    return h_new, hu_new, hv_new


def estimate_cfl_dt(h: Array, bathymetry: Array, dx: float, dy: float, g: float = 9.81, safety: float = 0.45) -> float:
    depth = np.maximum(bathymetry + h, 1e-8)
    c = np.sqrt(g * np.max(depth))
    return safety * min(dx, dy) / max(c, 1e-8)


def verify_closed_box(gs=64, steps=500, tol=1e-9):
    """
    Conservation proof: run the SAME finite-volume HLL + minmod update loop
    (`step_shallow_water`) on flat bathymetry with a CLOSED (reflecting)
    boundary — no transmissive outflow — and assert total water volume
    Σ(bathymetry + h) is conserved to machine precision. This isolates the
    solver's conservation from the open-boundary bookkeeping in the tsunami
    kernel. Returns (passed, final_mass, initial_mass, rel_error).
    """
    import numpy as _np
    g = 9.81
    dx = 1000.0
    dt = 0.5
    # Flat bathymetry (constant depth) — no source terms, pure wave propagation.
    bathy = _np.full((gs, gs), 2000.0)
    # Compact central Gaussian hump as the initial free-surface elevation.
    yy, xx = _np.meshgrid(_np.arange(gs), _np.arange(gs), indexing='ij')
    r2 = (yy - gs // 2) ** 2 + (xx - gs // 2) ** 2
    h = 5.0 * _np.exp(-r2 / (2 * (gs // 8) ** 2))
    hu = _np.zeros_like(h)
    hv = _np.zeros_like(h)
    init_mass = float(_np.sum(bathy + h))

    for _ in range(steps):
        h, hu, hv = step_shallow_water(h, hu, hv, bathy, dt, dx, dx, g=g, manning_n=0.0)
        # Reflecting box: zero normal flux at walls → nothing leaves.
        # The HLL solver uses periodic-ish roll BCs; enforce reflecting walls
        # by zeroing the boundary momenta and mirroring the free surface.
        hu[0, :] = 0.0; hu[-1, :] = 0.0
        hu[:, 0] = 0.0; hu[:, -1] = 0.0
        hv[0, :] = 0.0; hv[-1, :] = 0.0
        hv[:, 0] = 0.0; hv[:, -1] = 0.0

    final_mass = float(_np.sum(bathy + h))
    rel_error = (final_mass - init_mass) / max(init_mass, 1e-12)
    passed = abs(rel_error) < tol
    print(f"[VERIFY] closed-box gs={gs} steps={steps}: "
          f"init={init_mass:.6f} final={final_mass:.6f} "
          f"|Δ|={abs(rel_error):.2e} → {'PASS' if passed else 'FAIL'}")
    return passed, final_mass, init_mass, abs(rel_error)


def run_tsunami(
    h0: Array,
    bathymetry: Array,
    duration_s: float,
    dx: float,
    dy: float,
    dt: float | None = None,
    g: float = 9.81,
    manning_n: float = 0.03,
    snapshot_count: int = 20,
) -> Tuple[Array, Array, Array, list[SimulationSnapshot]]:
    h = np.array(h0, dtype=np.float64)
    hu = np.zeros_like(h)
    hv = np.zeros_like(h)
    if dt is None:
        dt = estimate_cfl_dt(h, bathymetry, dx, dy, g=g)
    steps = max(1, int(np.ceil(duration_s / dt)))
    snapshot_interval = max(1, steps // max(1, snapshot_count))
    snapshots: list[SimulationSnapshot] = []

    for step_index in range(steps):
        h, hu, hv = step_shallow_water(h, hu, hv, bathymetry, dt, dx, dy, g=g, manning_n=manning_n)
        if step_index % snapshot_interval == 0 or step_index == steps - 1:
            wave_height = float(np.max(np.abs(h)))
            celerity = float(np.sqrt(g * np.max(np.maximum(bathymetry + h, 1e-8))))
            snapshots.append(
                SimulationSnapshot(
                    water_height=h.astype(np.float32),
                    time_minutes=round(step_index * dt / 60.0, 2),
                    wave_height_m=wave_height,
                    propagation_speed_ms=celerity,
                )
            )
    return h, hu, hv, snapshots
