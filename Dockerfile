# Stage 1: Build frontend
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json tsconfig.scripts.json vite.config.ts tailwind.config.js postcss.config.js ./
COPY index.html ./
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl dumb-init sqlite-libs python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev && npm install tsx

COPY --from=builder /app/dist ./dist
COPY server/ ./server/
COPY public/ ./public/
COPY .env.example ./

# Data volume for SQLite
VOLUME ["/app/data"]

EXPOSE 3001
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node_modules/.bin/tsx", "server/index.ts"]
