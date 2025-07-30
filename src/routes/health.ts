// src/routes/health.ts - Minimal health check routes
import { Router, Request, Response } from 'express';
import { SupabaseService } from '../config/supabase';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: 'connected' | 'disconnected';
    youtube: 'configured' | 'not_configured';
    openai: 'configured' | 'not_configured';
    ffmpeg: 'available' | 'unavailable';
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
}

// Health check endpoint
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const healthStatus: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: 'disconnected',
        youtube: 'not_configured',
        openai: 'not_configured',
        ffmpeg: 'unavailable'
      },
      memory: {
        used: 0,
        total: 0,
        percentage: 0
      }
    };

    // Check database connection
    try {
      const isConnected = await SupabaseService.testConnection();
      healthStatus.services.database = isConnected ? 'connected' : 'disconnected';
    } catch (error) {
      healthStatus.services.database = 'disconnected';
    }

    // Check YouTube API configuration
    healthStatus.services.youtube = process.env.YOUTUBE_API_KEY ? 'configured' : 'not_configured';

    // Check OpenAI configuration
    healthStatus.services.openai = process.env.OPENAI_API_KEY ? 'configured' : 'not_configured';

    // Check FFmpeg availability
    try {
      const { exec } = require('child_process');
      await new Promise<void>((resolve, reject) => {
        exec('ffmpeg -version', (error: any) => {
          if (error) reject(error);
          else resolve();
        });
      });
      healthStatus.services.ffmpeg = 'available';
    } catch (error) {
      healthStatus.services.ffmpeg = 'unavailable';
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    healthStatus.memory = {
      used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
    };

    // Determine overall health
    const isHealthy = 
      healthStatus.services.database === 'connected' &&
      healthStatus.services.youtube === 'configured' &&
      healthStatus.services.ffmpeg === 'available' &&
      healthStatus.memory.percentage < 90;

    healthStatus.status = isHealthy ? 'healthy' : 'unhealthy';

    // Return appropriate status code
    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json(healthStatus);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Readiness probe
router.get('/ready', async (req: Request, res: Response): Promise<void> => {
  try {
    const isDbReady = await SupabaseService.testConnection();
    
    if (!isDbReady) {
      res.status(503).json({
        ready: false,
        message: 'Database not ready'
      });
      return;
    }

    if (!process.env.YOUTUBE_API_KEY) {
      res.status(503).json({
        ready: false,
        message: 'YouTube API not configured'
      });
      return;
    }

    res.json({
      ready: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(503).json({
      ready: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Liveness probe
router.get('/live', (req: Request, res: Response): void => {
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;
