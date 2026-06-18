# Security notes — Earth Intelligence (Realtime_v2)

## Content-Security-Policy (Issue #11)

Helmet CSP is **enabled** in `server/index.ts`. Cesium requires:

- `'unsafe-inline'` and `'unsafe-eval'` in `script-src` for Web Workers and widget bootstrap
- `blob:` workers and broad `connect-src` for tiles and public geospatial APIs

Tightening to nonce-only CSP would require isolating Cesium in a separate origin or iframe. Until then, this is an **accepted risk** documented here. API responses still send a full `Content-Security-Policy` header.

## Rate limiting (Issue #13)

Login and per-user limits use an in-process `Map`. For multi-instance production, back limits with Redis (see `REDIS_URL`). When behind a reverse proxy, the app sets `trust proxy` so `req.ip` respects `X-Forwarded-For`.

## Puppeteer (Issue #17)

`puppeteer` remains a **production** dependency because `server/index.ts` uses it for CCTV / dynamic HTML scraping at runtime. It is not only a dev tool.

## Environment variables (Issue #7)

| Location | Purpose |
|----------|---------|
| `server/.env` | Server-only secrets (JWT, provider API keys, DB) |
| `.env.local` | Client Vite vars (`VITE_*`) — gitignored |
| `.env.example` / `server/.env.example` | Placeholders only |

Do not put `VITE_*` keys in `server/.env`; use `.env.local` for the Vite dev server.
