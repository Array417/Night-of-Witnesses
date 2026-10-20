# Multi-stage Dockerfile for Night of Witnesses (目擊者之夜)
# Stage 1: Build client and server bundles
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts playwright.config.ts index.html ./
COPY src/ ./src/
COPY public/ ./public/

RUN npm run build

# Docker-only development and test image; Debian supports Playwright dependencies.
FROM node:24-bookworm-slim AS development-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM development-dependencies AS development
COPY tsconfig.json tsconfig.server.json vite.config.ts playwright.config.ts index.html ./
COPY src/ ./src/
COPY public/ ./public/
COPY tests/ ./tests/
COPY scripts/ ./scripts/
COPY DESIGN.md ./
RUN npm run build && chown node:node /app
USER node
CMD ["npm", "run", "start"]

FROM development-dependencies AS browser-dependencies
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

FROM browser-dependencies AS browser-test
COPY --from=development /app/src ./src
COPY --from=development /app/tests ./tests
COPY --from=development /app/dist ./dist
COPY --from=development /app/public ./public
COPY --from=development /app/scripts ./scripts
COPY --from=development /app/DESIGN.md /app/playwright.config.ts /app/tsconfig.json /app/tsconfig.server.json ./
RUN chown node:node /app
USER node
CMD ["npm", "run", "test:e2e"]

# Production runtime image
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV ORIGIN=http://localhost:3000

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY scripts/add-bots.mjs ./scripts/add-bots.mjs

# Run as built-in non-root user 'node'
USER node

EXPOSE 3000

# Health check against local healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/src/server/main.js"]
