import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';

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
  disk: {
    temp: string;
    uploads: string;
  };
}

// Health check endpoint
router.get('/health', async (req: Request, res: Response) => {
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
      },
      disk: {
        temp: 'unknown',
        uploads: 'unknown'
      }
    };

    // Check database connection
    try {
      const { error } = await supabase.from('users').select('count').limit(1);
      healthStatus.services.database = error ? 'disconnected' : 'connected';
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
      await new Promise((resolve, reject) => {
        exec('ffmpeg -version', (error: any) => {
          if (error) reject(error);
          else resolve(true);
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

    // Disk space check
    try {
      const fs = require('fs-extra');
      const path = require('path');
      
      const tempDir = path.join(process.cwd(), 'temp');
      const uploadsDir = path.join(process.cwd(), 'uploads');
      
      await fs.ensureDir(tempDir);
      await fs.ensureDir(uploadsDir);
      
      healthStatus.disk = {
        temp: 'accessible',
        uploads: 'accessible'
      };
    } catch (error) {
      healthStatus.disk = {
        temp: 'error',
        uploads: 'error'
      };
    }

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

// Readiness probe (for Kubernetes-style deployments)
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check if all critical services are ready
    const { error } = await supabase.from('users').select('count').limit(1);
    
    if (error) {
      return res.status(503).json({
        ready: false,
        message: 'Database not ready'
      });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return res.status(503).json({
        ready: false,
        message: 'YouTube API not configured'
      });
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

// Liveness probe (for Kubernetes-style deployments)
router.get('/live', (req: Request, res: Response) => {
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// System info endpoint
router.get('/info', (req: Request, res: Response) => {
  const info = {
    name: 'YouTube Automation API',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    node_version: process.version,
    platform: process.platform,
    architecture: process.arch,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    features: {
      video_generation: true,
      youtube_upload: !!process.env.YOUTUBE_API_KEY,
      ai_content: !!process.env.OPENAI_API_KEY,
      scheduled_uploads: true,
      analytics: true
    }
  };

  res.json(info);
});

export default router;
