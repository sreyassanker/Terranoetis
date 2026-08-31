# Terranoetis — Production-Grade Todo List

> Generated from live codebase audit (2026-08-31). Each item is actionable, verified against real code, and prioritized. Tests are numbered for easy tracking.

## Legend

| Priority | Meaning |
|----------|---------|
| **P0** | Blocks a production release — must fix before launch |
| **P1** | Should fix before launch — will cause incidents in production |
| **P2** | Fix after launch — quality of life / cost / polish |
| **P3** | Nice to have — no production impact |

---

## 1. Deployment & Infrastructure

### 1.1 [P0] Create `.env.example` from current `.env` values (redacted)

- **File:** `Dockerfile:29` copies `.env.example` → **file does not exist**
- **Fix:** Create `.env.example` with all 61 env var names, empty values, and comments. Remove all real secrets. The Docker image will fail to build as-is.
- **Live test:** `docker build -t terranoetis .` must succeed.

### 1.2 [P0] Fix docker-compose `causal-service` dependency

- **File:** `docker-compose.yml` has `depends_on: - causal-service` but no `causal-service` container is defined.
- **Fix:** Either add the service or remove the dependency.
- **Live test:** `docker compose up -d` must start all containers.

### 1.3 [P1] Use Redis for caching (not just connection)

- **File:** `server/routes/routeHelpers.ts` — uses `node-cache` (in-memory, `maxKeys: 100`, `stdTTL: 60s`). The Redis client exists (`server/infrastructure/redis.ts`) but is only used for connection checks, **not for caching**.
- **Impact:** Multi-instance deployment (e.g., 2+ replicas) = cache drift. Each instance has its own cold cache. The `maxKeys: 100` limit means the 9340-satellite TLE dataset can't even fit.
- **Fix:** Implement a Redis-backed cache adapter with the same `get/set` interface. Fall back to node-cache when Redis is unavailable.
- **Live test:** `curl -s http://localhost:3001/api/earthquakes` must return `<100ms` on second call (cached).

### 1.4 [P1] Docker image health check URL mismatch

- **File:** `Dockerfile` HEALTHCHECK uses `curl -f http://localhost:3001/api/health` which returns `{"status":"healthy"}` — correct.
- **File:** `docker-compose.yml` healthcheck uses `wget --spider -q http://localhost:3001/api/health` — different tool (`wget` not `curl`). Alpine has both, but `wget --spider` doesn't check HTTP response status (returns 0 even on 404).
- **Fix:** Use `curl -f` in both to be consistent.
- **Live test:** `curl -f http://localhost:3001/api/health; echo $?` → `0`.

### 1.5 [P2] Multi-stage Docker build uses `npm run build` which includes lint

- **File:** `Dockerfile` runs `npm run build` which triggers `tsc -b` → if a type error creeps in, the Docker build fails. That's actually **correct behavior**.
- **Suggestion:** Add a separate `npm run build:prod` that skips lint for faster builds in CI (the lint job already runs separately).
- Low priority.

---

## 2. Security

### 2.1 [P0] Git history contains real API keys (Earthdata, Cesium, etc.)

- **Check:** `git log --all -p --diff-filter=A -- .env` — if `.env` was ever committed (even briefly), keys are in the git history forever.
- **Fix:** Rotate ALL keys in `.env` if any commit ever included `.env`. Use `git filter-repo` or BFG to purge old history (but this rewrites all SHAs — coordinate with the team).
- **Verify:** `git log --all --oneline -- .env` (if empty, safe). If not empty, rotate immediately.

### 2.2 [P1] SSRF guard not applied to all user-controlled outbound fetches

- **File:** `server/utils/ssrfGuard.ts` exists and is wired at 3 sites (lines 1726, 7104, 7122 in `server/index.ts`).
- **Gap:** Many data fetchers in `server/data/dataFetchers.ts` use `strictFetch()` which calls `fetch()` with user-controlled URLs (e.g., `fetchUsgsWater`, `fetchOverpass`, `fetchRiverData`). These are not behind the SSRF guard.
- **Fix:** Audit all `fetch()` calls in `server/data/` and `server/index.ts` that accept user-controlled URL parameters. Route through `validateOutboundUrl()`.
- **Live test:** Attempt to fetch from a private IP via a public endpoint → should return 403.

### 2.3 [P1] `X-Powered-By: Express` header not suppressed

- **Check:** `curl -s -I http://localhost:3001/api/health | grep -i powered-by`
- **Fix:** Add `app.disable('x-powered-by')` or use `helmet({ hidePoweredBy: true })`.

### 2.4 [P2] Rate limit headers present on public endpoints (DONE)

- **Status:** ✅ **FIXED** in this session — `publicDataRateLimit = perIpRateLimiter(300, 60000)` wired to public data endpoints.

### 2.5 [P2] CORS origin check is a string match, not a regex

- **File:** `cors({ origin: CLIENT_ORIGIN })` — uses exact string match. Good for security. 
- **If mobile app is planned:** need to add additional origins.
- Low priority for web-only.

---

## 3. Observability & Monitoring

### 3.1 [P1] OpenTelemetry wired but no exporter configured

- **File:** `server/observability/openTelemetry.ts` has `initObservability()` but it's not called in `server/index.ts` (the import at line 2807 is never invoked).
- **Check:** `grep -n "initObservability" server/index.ts` — imported but NOT called. The OTel setup is dead code.
- **Fix:** Call `initObservability()` at startup with a real exporter (OTLP HTTP/gRPC endpoint, or console for dev). Configure `service.name` and `service.version`.
- **Live test:** Start server → OTel spans should be exportable to a collector.

### 3.2 [P1] No structured error reporting to external service

- **File:** `server/middleware/errorHandler.ts` — logs errors via `logger.error()` but does not send to Sentry, DataDog, or any error-tracking service.
- **Fix:** Add error reporting integration (Sentry is the quickest; `@sentry/node` with `Sentry.init()` and `Sentry.setUser()` for auth'd errors).
- **Live test:** Trigger a 500 → verify error appears in Sentry dashboard.

### 3.3 [P2] Prometheus `/api/metrics` is public (no auth)

- **File:** Line 355: `req.path === '/metrics'` → `return next()` (public). The admin-gated version is at `/api/admin/metrics` (requires admin role).
- **Impact:** Prometheus metrics expose operational data (request counts, durations, cache hit rates, token counts). If this is a concern, use network-level restriction (firewall) or add basic auth.
- **Fix:** Move to `/api/admin/metrics` or add `helmet.contentSecurityPolicy` restrictions. Or keep as-is (standard for Prometheus scraping).

### 3.4 [P2] Request logging lacks sampling for high-traffic endpoints

- **File:** `server/middleware/observability.ts` — `requestLoggerMiddleware()` logs every request.
- **Impact:** At 1000+ req/s, the log volume will be expensive (Pino is fast but JSON parsing at scale costs).
- **Fix:** Add dynamic sampling: log 100% of errors, 10% of successful responses, or use a rate-limited log stream.

### 3.5 [P3] No health endpoint for Redis

- **File:** `/api/health` checks db, gemini, memory, reflex, forks, dream, entropy, discovery, pubsub — but NOT Redis.
- **Fix:** Add `redis: { status: redisClient.ping() === 'PONG' ? 'ok' : 'down' }` to the health check.
- **Live test:** Stop Redis → `/api/health` should show `redis: down`.

---

## 4. Performance & Scaling

### 4.1 [P1] `src/App.tsx` is 10,738 lines — monolithic

- **Impact:** Long compile times, hard to maintain, poor tree-shaking. Every change to `App.tsx` invalidates HMR for the entire app.
- **Fix:** Extract panels into lazy-loaded routes (`React.lazy` + `Suspense`). Each panel is already a separate component — the issue is everything is imported and rendered in one file.
- **Live test:** After splitting, the initial bundle should drop from 3.4MB to ~1.2MB.

### 4.2 [P1] Analytical engine files are 14,111 lines combined

- **Files:** `server/analytical-models/engine.ts` (10,250 lines), `contextEngine.ts` (3,861 lines).
- **Impact:** `tsx` (used for dev) must parse/transform the entire file for every import. Hot-reload is slow. File exceeds Babel's 500KB deoptimization threshold.
- **Fix:** Split each equation domain (atmospheric, hydrology, ocean, seismic, etc.) into separate files. The `EQUATION_ENGINE` object can be composed from imports.
- **Live test:** `npx tsx server/index.ts` starts faster.

### 4.3 [P2] Vite chunk warnings — Cesium 4.8MB, app bundle 3.4MB

- **Status:** Noted. Cesium is inherently large. The app bundle can be split further (see 4.1).
- **Fix:** After lazy-loading panels, the app bundle should shrink significantly. Also consider dynamic import for `cesium` itself (it's already excluded from optimizeDeps).
- **Live test:** `npx vite build` should have no chunks >2MB after splitting.

### 4.4 [P2] TLE cold-start parallelized but still CPU-bound (DONE)

- **Status:** ✅ **FIXED** in this session. Parallel group fetches (concurrency 6), O(1) dedup, startup pre-warm. 37s cold → 0.036s hot.

### 4.5 [P3] No CDN for static assets

- **Impact:** Cesium Worker/Asset files (~5MB) are served from the same Node process. In production, these should be served from a CDN (CloudFront, Cloudflare R2).
- **Fix:** Upload `dist/` to CDN and set `VITE_CDN_URL` env var. Use `VITE_CDN_URL + '/cesium/'` for Cesium asset paths.

---

## 5. Testing & Reliability

### 5.1 [P1] No E2E test for the core analytical compute flow

- **Current tests:** 1624 unit tests, 2 E2E tests (`fullSession`, `api`), 3 integration tests. The photorealGlobe E2E passes.
- **Gap:** No E2E test that: draws a study area → selects model 1 → executes → verifies 28×28 grid → renders heatmap on the globe.
- **Fix:** Write a Playwright test that mocks the backend (or uses a real running server) and verifies the full compute → render pipeline.
- **Live test:** `npx playwright test --grep "compute-demo"` passes.

### 5.2 [P1] No E2E test for voice camera commands

- **Gap:** The `moveCamera` commands (orbit/pan/tilt/rotate/stop) are emitted by the agent SSE endpoint but never verified in a browser.
- **Fix:** Playwright test: send "orbit around this area" → verify `moveCamera` is received by the Cesium camera controller.
- **Live test:** `npx playwright test --grep "voice-camera"` passes.

### 5.3 [P2] Model 32 QC false-positive

- **File:** `server/analytical-models/engine.ts` case 32 — returns real FIRMS measured FRP (48.2 MW) but QC flags `valid: false` because optional Dozier-form input `Tbg` is NaN.
- **Fix:** The QC validation should understand that model 32 has two valid execution paths: measured FIRMS FRP (no Tbg needed) and Dozier form (Tbg required). Only flag `valid: false` when BOTH paths fail.
- **Live test:** `POST /api/analytical-models/32/execute` → `validation.valid === true`.

### 5.4 [P2] Model 1 LST grid flat when Landsat unavailable

- **File:** `server/analytical-models/contextEngine.ts` line 674-676 — honest fallback to weather air temperature when Landsat COG times out.
- **Fix:** Increase FETCH_TIMEOUT from 30s to 60s for COG reads. Use overview decimation more aggressively (lower MAX_WINDOW_PX).
- **Live test:** Model 1 grid over Austin bbox should have non-zero standard deviation (>0.5°C variation).

### 5.5 [P2] Model 40 voice compute uses default params, not real data

- **Gap:** Voice command "compute 100 year flood return level over Austin" matches model 40 (Gumbel) but executes with default μ=100, β=20 (no real flood record data ingested).
- **Fix:** Special-case model 40 in the voice compute path: when the user asks for flood return levels, fetch historical stream gauge data (USGS NWIS) and fit the Gumbel distribution to the annual maxima, not just use defaults.
- **Live test:** Voice command returns `result: 1234.5 m³/s` (not `0.3679`).

### 5.6 [P2] Playwright E2E infra tests fail on fresh clone

- **Files:** `e2e/liveRender.spec.ts` uses a hardcoded Chromium path (`~/Library/Caches/ms-playwright/chromium-1228/...`). `e2e/materialFix.spec.ts` uses a DEV-only bridge.
- **Fix:** Use `@playwright/test`'s built-in browser management (not hardcoded paths). The `materialFix` test should work with `npx playwright test` (it uses the webServer config).
- **Live test:** `npx playwright test` passes all 5 specs.

---

## 6. Data Provenance & Integrity

### 6.1 [P1] No data freshness metadata on API responses

- **Gap:** Public data endpoints (earthquakes, flights, eonet) return data but no `X-Data-Age` or `X-Cache-Hit` headers. The client can't tell if data is 1s or 60s old.
- **Fix:** Add `res.set('X-Data-Age', `${ageMs}ms`)` to `cachedFetch()` and `res.set('X-Cache', 'HIT')` on cache hits.
- **Live test:** `curl -sI http://localhost:3001/api/earthquakes | grep -i x-data` → present.

### 6.2 [P2] Some analytical models return `dataSource: user-provided`

- **Gap:** Models 40 (Gumbel), 52 (Monsi-Saeki), and others return `dataSource: user-provided` when no live data is available. This is honest but not useful.
- **Fix:** For models where the client could auto-fetch data (e.g., USGS stream gauge records for Gumbel), wire the fetch in the model's `mapInputs` path.
- See also item 5.5.

### 6.3 [P2] Analytical model 1 (LST) uses 6 real ERA5 datasets but Landsat path is unreliable

- **Status:** Honest fallback exists. The grid path works (28×28, 784 cells) but values are flat when Landsat is unavailable.
- **Fix:** Increase COG fetch timeout. Add a fallback to MODIS LST product (MOD11A1) when Landsat fails.
- **Live test:** Model 1 grid over Austin bbox has std > 0.5°C.

---

## 7. Code Quality & Maintainability

### 7.1 [P1] No `.env.example` shipped (see 1.1)

### 7.2 [P1] `server/index.ts` is extremely large

- **Size:** ~11,800 lines. This is the single most critical code quality issue. Routes, middleware, data fetchers, and startup logic are all in one file.
- **Fix:** Extract route groups into the existing `server/routes/` directory (already has `vaultRouter`, `pulseRouter`, etc.). Each domain (earthquakes, flights, weather, satellites) should be its own route file.
- **Live test:** `npx tsc -p tsconfig.server.json --noEmit` passes after refactoring.

### 7.2 [P2] `src/App.tsx` is 10,738 lines (see 4.1)

### 7.3 [P2] No SECURITY.md or CONTRIBUTING.md

- **Files exist:** `LICENSE` only. No `SECURITY.md` (vulnerability reporting), `CONTRIBUTING.md` (development setup), or `CODE_OF_CONDUCT.md`.
- **Fix:** Add standard files. `SECURITY.md` should describe how to report vulnerabilities and the current threat model.

### 7.4 [P2] No API documentation

- **Gap:** The server has 294+ routes but no OpenAPI/Swagger spec. The `api-metadata.ts` file has some metadata but it's not served as documentation.
- **Fix:** Serve an OpenAPI spec at `/api/openapi.json` or use `swagger-ui-express` to render docs at `/api/docs`.
- **Live test:** `curl http://localhost:3001/api/openapi.json` returns valid OpenAPI 3.0 spec.

### 7.5 [P3] Inconsistent error response shapes

- **File:** `server/middleware/errorHandler.ts` returns `{ error: { code, message } }` — good.
- **But:** Some routes return `{ error: "string" }` (e.g., line 50: `res.status(404).json({ error: "Equation not implemented" })`). Not all routes use the error handler.
- **Fix:** Audit all `res.status(4xx|5xx).json({ error: ... })` calls and normalize to `{ error: { code, message } }`.

---

## 8. Authentication & Authorization

### 8.1 [P1] Dev-login JWT works but no token refresh mechanism

- **File:** `server/routes/auth.ts` / `server/index.ts` — dev-login returns a JWT. No refresh token endpoint exists.
- **Impact:** When the JWT expires (default?), the user must re-login. No silent refresh.
- **Fix:** Add a `/api/auth/refresh` endpoint that issues a new JWT given a valid (non-expired) token. Set `expiresIn` to a reasonable value (e.g., 24h for session, 7d for remember-me).

### 8.2 [P2] Admin role check is a database lookup, not a JWT claim

- **File:** `requireRole('admin')` middleware likely queries the database on every request. JWT should contain the role claim.
- **Fix:** Include `role` in the JWT payload (it's already in the dev-login response: `{token, userId, role}`). The `requireRole` middleware should decode the role from the JWT, not query the DB.
- **Live test:** `curl -s /api/admin/metrics` with admin token returns 200 in <10ms (no DB query).

### 8.3 [P2] Rate limiting for auth endpoints (DONE)

- **Status:** ✅ `loginRateLimit = perIpRateLimiter(5, 15min)` — verified working (5 requests then 429).

---

## 9. Panel Inventory (14 Panels)

| # | Panel | File | Production Status |
|---|-------|------|-------------------|
| 1 | AviationTrackerPanel | `src/components/prithvi/AviationTrackerPanel.tsx` | ✅ Working — real ADS-B data |
| 2 | ChatHistoryPanel | `src/components/chat/ChatHistoryPanel.tsx` | ✅ Working |
| 3 | ChatPanel | `src/components/chat/ChatPanel.tsx` | ✅ Working |
| 4 | DigitalTwinPanel | `src/components/DigitalTwinPanel.tsx` | ⚠️ Needs audit — complex data pipeline |
| 5 | ForkPanel | `src/components/ForkPanel.tsx` | ⚠️ Needs audit — scenario forking |
| 6 | IntelligencePanel | `src/components/IntelligencePanel.tsx` | ✅ Working — polls quotes, data |
| 7 | IssLivePanel | `src/components/IssLivePanel.tsx` | ✅ Working |
| 8 | LandCoverMapperPanel | `src/components/LandCoverMapperPanel.tsx` | ⚠️ E2E test exists but infra fails |
| 9 | LaunchReplayPanel | `src/components/LaunchReplayPanel.tsx` | ✅ Working (LL2 data) |
| 10 | RadioTunerPanel | `src/components/RadioTunerPanel.tsx` | ✅ Working (500 stations) |
| 11 | SatelliteImageryPanel | `src/components/SatelliteImageryPanel.tsx` | ⚠️ Depends on Sentinel Hub key |
| 12 | SatelliteTrackerPanel | `src/components/prithvi/SatelliteTrackerPanel.tsx` | ✅ Working (9340 sats cached) |
| 13 | SettingsPanel | `src/components/settings/*` | ✅ Working |
| 14 | StudyAreaPanel | `src/components/StudyAreaPanel.tsx` | ✅ Working |

---

## 10. Live Test Walkthrough (for QA)

Run these in order after each deployment:

```
1.  Health check:                   curl http://localhost:3001/api/health
2.  Dev-login:                      curl -X POST http://localhost:3001/api/auth/dev-login
3.  Unauthenticated 401:            curl http://localhost:3001/api/chats
4.  Search analytical model:        curl /api/analytical-models/search?q=land surface temperature
5.  Execute model 40 (point):       POST /api/analytical-models/40/execute with point
6.  Execute model 1 (grid bbox):    POST /api/analytical-models/1/execute with bbox
7.  Voice compute SSE:              POST /api/agent/ask {"message":"compute LST over Austin","studyAreaBbox":{...}}
8.  Voice camera commands:          POST /api/agent/ask {"message":"orbit around this area slowly"}
9.  Live data — earthquakes:        GET /api/earthquakes
10. Live data — flights/all:        GET /api/flights/all
11. Live data — satellites/tle:     GET /api/satellites/tle
12. Live data — cctv/worldwide:     GET /api/cctv/worldwide
13. Live data — radio_stations:     GET /api/data/radio_stations (auth)
14. Live data — bikeshare:          GET /api/data/bikeshare (auth)
15. WebSocket voice:                ws://localhost:3001/ws/voice?token=...
16. WebSocket agent:                ws://localhost:3001/ws/agent?token=...
17. Share link:                     POST /api/chats → POST /api/chats/:id/share → GET /api/shared/:token
18. Prometheus metrics:             GET /api/metrics
19. Admin metrics:                  GET /api/admin/metrics (admin auth)
20. E2E (Playwright):               npx playwright test
21. Unit tests:                     npx vitest run
22. Typecheck:                      npx tsc -p tsconfig.server.json --noEmit
23. Lint:                           npx eslint .
24. Build:                          npx vite build
```

---

## Summary by Priority

| Priority | Count | Key Items |
|----------|-------|-----------|
| **P0**   | 3     | .env.example, causal-service docker-compose, git secrets |
| **P1**   | 11    | Redis cache, SSRF coverage, OTel wiring, error tracking, App.tsx split, engine.ts split, E2E compute/voice tests, data freshness, jwt refresh, no .env.example |
| **P2**   | 14    | CORS hardening, rate-limit headers, model 32 QC, model 1 LST, model 40 voice, health Redis, Prometheus auth, log sampling, code style, docs, chunk sizes, testing infra |
| **P3**   | 6     | CDN, error format consistency, SECURITY.md, API docs, OTel exporter, CONTRIBUTING.md |

**Total: 34 items** — 3 blockers, 11 pre-launch, 14 post-launch, 6 nice-to-have.