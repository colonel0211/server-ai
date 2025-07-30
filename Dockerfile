# Working Dockerfile with correct build order
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

# Copy package files and TypeScript config
COPY package*.json ./
COPY tsconfig.json ./

# Copy source code (needed before npm install due to build scripts)
COPY src/ ./src/

# Install dependencies and build in one step
RUN npm install && npm run build:prod

# Remove dev dependencies to reduce image size
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
