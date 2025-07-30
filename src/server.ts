import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import healthRoutes from './routes/health';

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check routes (these must work without any external dependencies)
app.use('/', healthRoutes);

// Basic API routes
app.get('/', (req, res) => {
  res.json({
    message: 'YouTube Automation API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      ready: '/ready',
      live: '/live',
      config: '/config'
    }
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'YouTube Automation API',
    version: '1.0.0',
    description: 'Automated YouTube video generation and publishing system',
    endpoints: [
      'GET / - API info',
      'GET /health - Health check',
      'GET /ready - Readiness probe',
      'GET /live - Liveness probe',
      'GET /config - Configuration status'
    ],
    environment: process.env.NODE_ENV || 'development'
  });
});

// Catch-all for unknown routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);
  
  res.status(error.status || 500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`⚡ Ready for requests!`);
});

export default app;
