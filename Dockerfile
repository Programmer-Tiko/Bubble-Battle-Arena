# One image for both Node services (auth and app); docker-compose.yml picks which one runs.

# ---- Build stage: install everything and compile TypeScript + the Vite frontend ----
FROM node:22-alpine AS build
WORKDIR /app

# Copy only the package files first, so `npm ci` is cached until dependencies change
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/bot/package.json packages/bot/
COPY frontend/package.json frontend/
COPY services/game/package.json services/game/
COPY services/auth/package.json services/auth/
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app

# Key folders owned by the unprivileged "node" user; Docker volumes mounted here inherit this owner
RUN mkdir -p /keys/private /keys/public && chown -R node:node /keys
USER node