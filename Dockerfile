# Use Node 20 Alpine for smaller image size
FROM node:20-alpine

# Install system dependencies required for canvas, ffmpeg, and other native modules
RUN apk add --no-cache \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    fontconfig \
    ttf-dejavu \
    ffmpeg \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo \
    pango \
    jpeg \
    giflib \
    librsvg-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy source code
COPY src/ ./src/

# Install dependencies and build in one step (using regular build instead of build:prod)
RUN npm install && npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S youtube-automation -u 1001 -G nodejs

# Create output directories and set ownership
RUN mkdir -p output/videos output/audio output/thumbnails output/images temp && \
    chown -R youtube-automation:nodejs output temp

# Switch to non-root user
USER youtube-automation

# Expose port
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the application
CMD ["npm", "start"]
