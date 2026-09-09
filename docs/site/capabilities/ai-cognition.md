# AI chat & cognition — narrative

Verified thresholds and structure: [ai-cognition.html](ai-cognition.html).

## The design idea

The chat surface is a dispatcher, not a chatbot. A query is classified into one of eight typed intents; simple intents resolve against real tools (live data, analytical models, simulations, globe commands) without ever asking a language model; ambiguous or novel questions escalate through deliberate reasoning — HTN decomposition, a four-persona debate with a critic, causal and counterfactual passes — and even then, the answer is only trusted if it survives verification scoring. Fast-path answers are cached by embedding similarity; slow-path answers leave an auditable trace.

## Why the thresholds matter

The routing decision points (0.92 / 0.70 similarity bands, 10 s vs 45 s reasoning budgets, a three-round tool loop, a 150-second hard stream cap, a ≥0.4 acceptance floor for LLM intent classification) exist to bound cost and latency: a geospatial operator asking "earthquakes in Japan today" should get USGS numbers, not prose. The router that picks the underlying LLM (nine providers, tiered by complexity, circuit-broken per provider, local GGUF as the floor) makes the same guarantee from the other side: the pipeline never depends on any one provider being up.

## Honest limits

This subsystem's behaviour above the thresholds is code-verified and was seen starting in a live boot; it was not exercised against providers in this review, and the site never claims accuracy rates for LLM output. The explainability layer (traces, evidence chains, bias audits, the human-override queue) exists precisely because that evaluation is a deployment-time responsibility, not a marketing statement.
