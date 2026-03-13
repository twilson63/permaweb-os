# Web OS Frontend - Production Dockerfile
# Multi-stage build with nginx for static file serving

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm ci --only=production=false

# Copy source and build
COPY . .
RUN npm run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM nginx:alpine AS production

# Security: Run as non-root
RUN addgroup -S -g 1001 webos && \
    adduser -S -G webos -u 1001 -h /app webos

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY --chown=webos:webos nginx.conf /etc/nginx/nginx.conf

# Set proper permissions
RUN chown -R webos:webos /usr/share/nginx/html && \
    chown -R webos:webos /var/cache/nginx && \
    chown -R webos:webos /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown webos:webos /var/run/nginx.pid

# Switch to non-root user
USER webos

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4173/ || exit 1

CMD ["nginx", "-g", "daemon off;"]