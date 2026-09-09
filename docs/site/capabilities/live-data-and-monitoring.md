# Live data & monitoring — narrative

Verified inventories and thresholds: [live-data-and-monitoring.html](live-data-and-monitoring.html).

## Two loops, one bus

The platform runs an open loop (REST pulls of live feeds: seismic, storms, fires, aviation, maritime, satellites, quality, economics — 82 registered integrations with per-source metadata) and a closed loop (Sentinel polls those feeds for user watch-zones, compares against baselines, and raises anomalies; the correlation engine fuses streams within a 30-minute window; reflex rules translate events into globe actions — zoom, layer, alert — and three or more simultaneous reflexes escalate the client into a documented "trauma mode").

## Thresholds are published, not mystical

Detection defaults are named in code — magnitude 4.0, 50 hotspots, 3 flood events, 50 kt, AQI 100 — overridable per zone, with z-score/isolation-forest/graph/ensemble detectors behind publish gates that require both an anomaly score and a confidence floor before an alert ships. The intent is operational: an operator can audit any alert back to the poll that raised it.

## Transport reality

Event distribution runs through an in-process publish/subscribe bus with WebSocket/SSE fan-out to connected clients — accurate to say plainly, because earlier docs credited Redis with the pub/sub role (logged correction C-3). Multi-process fan-out would need external infrastructure the design does not pretend to have.
