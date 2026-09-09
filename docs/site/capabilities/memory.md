# Memory system — narrative

Verified tiers and tables: [memory.html](memory.html).

## Why a chat platform needs tiers

An intelligence assistant that forgets everything is a search engine. Terranoetis models memory the way cognitive architecture literature does: a large short-lived sensory buffer, a small working set, durable episodic records of what happened, semantic entity/relation knowledge, procedural patterns of what worked, and a predictive layer holding forecast models with their track record. Two implementations coexist (v1 and v2); the v2 manager is the active facade.

## Storage without pretension

Everything is local: SQLite tables per tier, with Redis used only as a hot key/value path for the fastest tiers and falling back to SQLite when absent. Retrieval is embedding-augmented (768-dim cosine), consolidation is a 6-hour sweep that promotes successful episodic traces into semantic records (procedural patterns are captured live from tool-chain outcomes, not by the sweep), and every memory read that enters a prompt is attributed (per-user isolation, tenant-guarded deletes).

## Honest boundary

Memory systems are convenient to overclaim. This documentation restricts itself to what the code provably does — retention capacities, timers, tables, APIs — and makes no statements about long-horizon assistant quality, which is an evaluation question for deployment (the ml/evals harnesses are where that work belongs).
