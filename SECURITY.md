# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Terranoetis, send an email to the maintainer at **sreyassanker001@gmail.com**. You should receive a response within 48 hours. If not, follow up via the same channel.

Please include:
- A clear description of the issue
- Steps to reproduce (proof-of-concept, affected endpoints, etc.)
- Any relevant logs or error messages
- Your assessment of the potential impact

## Current Threat Model

| Threat | Mitigation |
|--------|------------|
| SSRF via user-controlled URL | `validateOutboundUrl()` + `isAllowedUpstream()` — DNS resolution, private-IP blocking, allowlist. Applied at the 2 user-URL fetch sites (proxy endpoint, custom data-source ingest). |
| Unauthenticated access to protected routes | JWT verification via `authGuard` middleware. Public routes are an explicit allow-list: health/ready/live, metrics, config, OpenAPI/docs, the rate-limited read-only data routes, plus unauthenticated tile/pulse endpoints and share-token reads under <code>/shared/</code>. |
| API key exposure | All keys in `.env` (gitignored). No keys exposed in `GET /api/config/apis`. Docker compose mounts `.env` as read-only volume. |
| Weak/compromised JWT secret | `validateJwtSecretStrength()` at startup — refuses to start in production with a secret <32 chars. |
| Brute-force login | `perIpRateLimiter(5, 15min)` on `/api/auth/login`. Account lockout after 10 failed attempts. |
| Public data endpoint abuse | `perIpRateLimiter(300, 60s)` on the rate-limited public data allow-list (tile, pulse and share routes are public by design and carry their own guards). |
| CORS abuse | Fixed single origin from `CLIENT_ORIGIN` (no reflection), credentials mode on. |
| Injections | Helmet CSP headers, parameterized SQL queries (better-sqlite3), input validation on all POST endpoints. |
| Supply chain | `package-lock.json` committed, `npm ci` in Docker build. |

## Security Practices

- **No secrets in source control.**.env is gitignored. `.env.example` contains only variable names (empty values).
- **Rate limiting** applied at multiple tiers: login (5/15min), data endpoints (300/min), agent/ask (30/min), sandbox (5/min), simulate (10/min).
- **Graceful degradation** — when an upstream API fails, the platform returns an honest `NaN` with a clear warning. No data is fabricated.
- **Circuit breakers** on all 7 LLM providers (5 failures → open → half-open after 30s → failover to healthy provider).
- **Signed URLs** for COG reads use Microsoft Planetary Computer SAS tokens (no auth context shared).
- **Audit logging** for all chat and scenario operations.

## Known Security Events

The following are documented and **resolved**:

1. **Cesium Ion access token** — a live token was committed via `server/.env.example` in an early commit. The token was **rotated** (the old token in git history is now invalid). If you see the old token in history, no action is needed — it no longer works.
2. **Kaggle placeholder credentials** — `Terranoetis_kaggle.json` contained only placeholder values (`YOUR_KAGGLE_USERNAME`); no real secrets were ever committed. The file has since been removed from the repo — real Kaggle credentials belong in `~/.kaggle/kaggle.json` (outside the repository, `chmod 600`), which is where the simulation runner reads them.