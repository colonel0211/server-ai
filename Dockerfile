# Simple single-stage build that should work on Koyeb
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    ffmpeg \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    python3 \
    make \
    g++ \
    pkgconfig

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (all dependencies including dev for build)
RUN npm install

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npx tsc

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Create directories
RUN mkdir -p temp uploads assets logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/server.js"]
