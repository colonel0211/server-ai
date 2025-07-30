# Dockerfile for Koyeb deployment
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for video processing
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Create necessary directories
RUN mkdir -p temp_videos public

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]
