# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
# Installs deps and runs vite build → dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY index.html ./

RUN npm ci

COPY src ./src
COPY public ./public

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — production
# Serves the built SPA with nginx:alpine
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

# Drop the default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our SPA-friendly nginx config (try_files fallback to index.html)
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built static assets
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# nginx:alpine already ships with a non-root `nginx` user; we keep defaults.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
