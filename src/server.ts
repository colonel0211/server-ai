// src/server.ts - Complete YouTube Automation System
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs-extra';

// Import routes
import automationRoutes from './routes/automation';
import { YouTubeContentEngine } from './services/ContentEngine';
import { VideoProducer } from './services/videoProducer';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const contentEngine = new YouTubeContentEngine();
const videoProducer = new VideoProducer();

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files (for generated videos/thumbnails)
app.use('/videos', express.static(path.join(__dirname, '../output/videos')));
app.use('/thumbnails', express.static(path.join(__dirname, '../output/thumbnails')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint with system status
app.get('/', async (req, res) => {
  try {
    const automationStatus = contentEngine.getStatus();
    
    res.json({
      message: '🚀 YouTube Automation System - Ready!',
      version: '2.0.0',
      features: [
        '🔍 Trending Video Hunter (500k+ views)',
        '🤖 AI Content Generator (GPT-4)',
        '🎬 Automated Video Production',
        '🎵 AI Voiceover (OpenAI TTS)',
        '🖼️ AI Thumbnail Generation',
        '📤 YouTube Auto-Upload',
        '⏰ 24/7 Automation Scheduler',
        '📊 Analytics & Monitoring'
      ],
      status: {
        automation: automationStatus.isRunning ? 'RUNNING' : 'STOPPED',
        services: {
          youtube_api: process.env.YOUTUBE_API_KEY ? '✅ CONFIGURED' : '❌ MISSING',
          openai: process.env.OPENAI_API_KEY ? '✅ CONFIGURED' : '❌ MISSING',
          supabase: process.env.SUPABASE_URL ? '✅ CONFIGURED' : '❌ MISSING',
          unsplash: process.env.UNSPLASH_ACCESS_KEY ? '✅ CONFIGURED' : '⚠️ OPTIONAL'
        }
      },
      endpoints: {
        start_automation: 'POST /automation/start',
        stop_automation: 'POST /automation/stop',
        get_status: 'GET /automation/status',
        trending_analysis: 'GET /automation/trending',
        test_generation: 'POST /automation/test-generate',
        upload_history: 'GET /automation/uploads',
        system_health: 'GET /automation/health'
      },
      quickStart: [
        '1. Ensure all API keys are configured',
        '2. POST to /automation/start to begin',
        '3. Monitor with GET /automation/status',
        '4. Check uploads with GET /automation/uploads'
      ]
    });
  } catch (error) {
    res.status(500).json({
      message: 'System status check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Configuration check endpoint
app.get('/config', (req, res) => {
  const requiredEnvVars = [
    'YOUTUBE_API_KEY',
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
    'YOUTUBE_REFRESH_TOKEN',
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_KEY'
  ];

  const optionalEnvVars = [
    'UNSPLASH_ACCESS_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS'
  ];

  const configStatus = {
    required: {} as any,
    optional: {} as any,
    missing: [] as string[],
    ready: true
  };

  // Check required variables
  requiredEnvVars.forEach(envVar => {
    const isConfigured = !!process.env[envVar];
    configStatus.required[envVar] = isConfigured ? '✅ CONFIGURED' : '❌ MISSING';
    
    if (!isConfigured) {
      configStatus.missing.push(envVar);
      configStatus.ready = false;
    }
  });

  // Check optional variables
  optionalEnvVars.forEach(envVar => {
    configStatus.optional[envVar] = process.env[envVar] ? '✅ CONFIGURED' : '⚠️ NOT SET';
  });

  res.json({
    status: configStatus.ready ? 'READY' : 'INCOMPLETE',
    configuration: configStatus,
    instructions: configStatus.missing.length > 0 ? {
      message: 'Missing required environment variables',
      missing: configStatus.missing,
      setup_guide: {
        youtube: 'Get YouTube API credentials from Google Cloud Console',
        openai: 'Get OpenAI API key from OpenAI platform',
        supabase: 'Create Supabase project and get URL + anon key'
      }
    } : 'All required configurations are set!'
  });
});

// Mount automation routes
app.use('/automation', automationRoutes);

// Manual video creation endpoint (for testing)
app.post('/create-video', async (req, res) => {
  try {
    const { title, script, niche } = req.body;
    
    if (!title || !script || !niche) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, script, niche'
      });
    }

    console.log(`🎬 Manual video creation requested: ${title}`);
    
    const videoConfig = {
      title,
      script,
      hook: script.split('.')[0], // First sentence as hook
      niche,
      duration: 60,
      resolution: '1080p' as const,
      style: 'modern' as const
    };

    const videoPath = await videoProducer.createVideo(videoConfig);
    
    res.json({
      success: true,
      message: 'Video created successfully!',
      data: {
        title,
        videoPath,
        config: videoConfig
      }
    });

  } catch (error) {
    console.error('Error creating video:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create video',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get system metrics
app.get('/metrics', async (req, res) => {
  try {
    const automationStatus = contentEngine.getStatus();
    
    res.json({
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu_usage: process.cpuUsage(),
        platform: process.platform,
        node_version: process.version
      },
      automation: {
        status: automationStatus.isRunning ? 'RUNNING' : 'STOPPED',
        started_at: automationStatus.startedAt,
        uptime: automationStatus.startedAt ? Date.now() - automationStatus.startedAt.getTime() : 0
      },
      services: {
        youtube_configured: !!process.env.YOUTUBE_API_KEY,
        openai_configured: !!process.env.OPENAI_API_KEY,
        supabase_configured: !!process.env.SUPABASE_URL,
        database_connected: true // Could add actual DB health check
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get metrics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 24/7 Automation Cron Jobs
let automationCronJob: cron.ScheduledTask | null = null;

// Schedule automation to run every 4 hours
function startAutomationScheduler() {
  if (automationCronJob) {
    automationCronJob.stop();
  }

  // Run every 4 hours: 0 0,4,8,12,16,20 * * *
  automationCronJob = cron.schedule('0 */4 * * *', async () => {
    try {
      console.log('🤖 Scheduled automation started:', new Date().toISOString());
      
      if (!contentEngine.getStatus().isRunning) {
        await contentEngine.startAutomation();
        console.log('✅ Automation cycle completed successfully');
      } else {
        console.log('⚠️ Automation already running, skipping scheduled run');
      }
    } catch (error) {
      console.error('❌ Scheduled automation failed:', error);
    }
  }, {
    scheduled: false,
    timezone: "UTC"
  });

  automationCronJob.start();
  console.log('⏰ Automation scheduler started - will run every 4 hours');
}

// Start scheduler endpoint
app.post('/scheduler/start', (req, res) => {
  try {
    startAutomationScheduler();
    res.json({
      success: true,
      message: 'Automation scheduler started',
      schedule: 'Every 4 hours (0, 4, 8, 12, 16, 20 UTC)'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to start scheduler',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop scheduler endpoint
app.post('/scheduler/stop', (req, res) => {
  try {
    if (automationCronJob) {
      automationCronJob.stop();
      automationCronJob = null;
    }
    res.json({
      success: true,
      message: 'Automation scheduler stopped'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to stop scheduler',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get scheduler status
app.get('/scheduler/status', (req, res) => {
  res.json({
    running: automationCronJob !== null,
    schedule: automationCronJob ? 'Every 4 hours (0, 4, 8, 12, 16, 20 UTC)' : null,
    next_run: automationCronJob ? 'Check cron job status' : null
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /',
      'GET /health',
      'GET /config',
      'GET /metrics',
      'POST /create-video',
      'POST /scheduler/start',
      'POST /scheduler/stop',
      'GET /scheduler/status',
      'POST /automation/start',
      'POST /automation/stop',
      'GET /automation/status'
    ]
  });
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  
  if (automationCronJob) {
    automationCronJob.stop();
  }
  
  if (contentEngine.getStatus().isRunning) {
    contentEngine.stopAutomation();
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  
  if (automationCronJob) {
    automationCronJob.stop();
  }
  
  if (contentEngine.getStatus().isRunning) {
    contentEngine.stopAutomation();
  }
  
  process.exit(0);
});

// Start server
app.listen(PORT, async () => {
  console.log('\n🚀 YouTube Automation System Starting...\n');
  
  // Ensure output directories exist
  await fs.ensureDir(path.join(__dirname, '../output/videos'));
  await fs.ensureDir(path.join(__dirname, '../output/thumbnails'));
  await fs.ensureDir(path.join(__dirname, '../output/audio'));
  
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 API available at: http://localhost:${PORT}`);
  console.log(`📊 System status: http://localhost:${PORT}/`);
  console.log(`⚙️  Configuration: http://localhost:${PORT}/config`);
  console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
  
  // Auto-start scheduler in production
  if (process.env.NODE_ENV === 'production') {
    console.log('\n🔄 Production mode detected - starting automation scheduler...');
    startAutomationScheduler();
  }
  
  console.log('\n✅ YouTube Automation System Ready!\n');
});

export default app;
