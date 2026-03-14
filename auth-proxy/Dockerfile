# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (none needed, but create lock file)
RUN npm install --ignore-scripts

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install curl for health checks
RUN apk add --no-cache curl

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -S -g 1001 webos && \
    adduser -S -G webos -u 1001 -h /app webos

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Set ownership
RUN chown -R webos:webos /app

# Switch to non-root user
USER webos

# Expose auth proxy port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start server
CMD ["node", "dist/index.js"]