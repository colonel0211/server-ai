import { Router, Request, Response } from 'express';
import { testDatabaseConnection, isSupabaseConfigured, getSupabaseStatus } from '../config/supabase';

const router = Router();

interface ServiceStatus {
  status: string;
  configured: boolean;
  error?: string;
  details?: any;
}

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  services: {
    database: ServiceStatus;
    youtube: ServiceStatus;
    openai: ServiceStatus;
  };
}

// Basic health check
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const supabaseStatus = getSupabaseStatus();
    
    const healthCheck: HealthCheckResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: {
          status: 'unknown',
          configured: supabaseStatus.configured,
          details: supabaseStatus
        },
        youtube: {
          status: 'unknown',
          configured: !!process.env.YOUTUBE_API_KEY
        },
        openai: {
          status: 'unknown',
          configured: !!process.env.OPENAI_API_KEY
        }
      }
    };

    // Check database connection if configured
    if (supabaseStatus.configured) {
      try {
        const dbResult = await testDatabaseConnection();
        healthCheck.services.database.status = dbResult.connected ? 'healthy' : 'unhealthy';
        if (dbResult.error) {
          healthCheck.services.database.error = dbResult.error;
        }
      } catch (error) {
        healthCheck.services.database.status = 'error';
        healthCheck.services.database.error = error instanceof Error ? error.message : 'Database check failed';
      }
    } else {
      healthCheck.services.database.status = 'not_configured';
    }

    // Check YouTube API configuration
    healthCheck.services.youtube.status = healthCheck.services.youtube.configured ? 'configured' : 'not_configured';

    // Check OpenAI configuration
    healthCheck.services.openai.status = healthCheck.services.openai.configured ? 'configured' : 'not_configured';

    // Determine overall status
    const hasUnhealthyServices = Object.values(healthCheck.services).some(
      service => service.status === 'unhealthy' || service.status === 'error'
    );
    
    const hasUnconfiguredServices = Object.values(healthCheck.services).some(
      service => service.status === 'not_configured'
    );
    
    if (hasUnhealthyServices) {
      healthCheck.status = 'unhealthy';
      res.status(503).json(healthCheck);
    } else if (hasUnconfiguredServices) {
      healthCheck.status = 'degraded';
      res.status(200).json(healthCheck); // Still return 200 for degraded but working
    } else {
      res.status(200).json(healthCheck);
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown health check error'
    });
  }
});

// Readiness check for Kubernetes/Koyeb
router.get('/ready', async (req: Request, res: Response): Promise<void> => {
  try {
    // App is ready if it can start (basic server functionality)
    // Don't require all services to be configured for readiness
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      message: 'Server is ready to accept requests'
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown readiness error'
    });
  }
});

// Liveness check
router.get('/live', (req: Request, res: Response): void => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid
  });
});

// Configuration status endpoint
router.get('/config', (req: Request, res: Response): void => {
  const supabaseStatus = getSupabaseStatus();
  
  res.status(200).json({
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      supabase: supabaseStatus,
      youtube: {
        configured: !!process.env.YOUTUBE_API_KEY,
        hasApiKey: !!process.env.YOUTUBE_API_KEY,
        hasClientId: !!process.env.YOUTUBE_CLIENT_ID,
        hasClientSecret: !!process.env.YOUTUBE_CLIENT_SECRET
      },
      openai: {
        configured: !!process.env.OPENAI_API_KEY,
        hasApiKey: !!process.env.OPENAI_API_KEY
      }
    }
  });
});

export default router;
