// src/server.ts - Complete YouTube Automation System
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import cron from 'node-cron'; // Needed for the scheduler's internal use
import path from 'path';
import fs from 'fs-extra';

// --- IMPORT NECESSARY MODULES AND SERVICES ---
import automationRoutes from './routes/automation'; // Routes for automation control
import { YouTubeContentEngine } from './services/ContentEngine'; // For hunting and content creation
import { VideoProducer, VideoConfig } from './services/videoProducer'; // For video assembly
import { AutomationScheduler } from './services/automationScheduler'; // The main orchestrator
import supabase from './config/database'; // Supabase client singleton
import { logger } from './utils/logger'; // Logger utility

// --- LOAD ENVIRONMENT VARIABLES ---
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- INITIALIZE SERVICES ---
// YouTubeContentEngine for specific tasks like hunting and script generation
const contentEngine = new YouTubeContentEngine(); 
// VideoProducer for the actual video assembly
const videoProducer = new VideoProducer(); 
// AutomationScheduler orchestrates the whole process, using ContentEngine and VideoProducer
const scheduler = new AutomationScheduler(); 

// --- MIDDLEWARE SETUP ---
app.use(helmet()); // Add security headers
app.use(cors());   // Enable Cross-Origin Resource Sharing
app.use(compression()); // Enable Gzip compression for faster responses
app.use(morgan('combined')); // HTTP request logger (e.g., 'dev', 'combined')
app.use(express.json({ limit: '50mb' })); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded request bodies

// --- STATIC FILE SERVING ---
// Serve temporary files (videos, thumbnails, audio) for debugging or direct access if needed
app.use('/temp', express.static(path.join(__dirname, '../temp'))); 

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime_seconds: process.uptime(),
    memory_usage_bytes: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
    supabase_client_initialized: !!supabase // Check if Supabase client was successfully created
  });
});

// --- ROOT ENDPOINT WITH SYSTEM STATUS ---
app.get('/', async (req, res) => {
  try {
    // Get status from the AutomationScheduler instance
    const schedulerStatus = scheduler.getStatus();
    
    res.json({
      message: '🚀 YouTube Automation System - Ready!',
      version: '2.0.0', // Update this as you make changes
      features: [
        '🔍 Trending Video Hunter (500k+ views)',
        '🤖 AI Content Generator (GPT-4)',
        '🎬 Automated Video Production',
        '🎵 AI Voiceover (OpenAI TTS)',
        '🖼️ AI Thumbnail Generation',
        '📤 YouTube Auto-Upload',
        '⏰ Scheduled Automation Tasks',
        '📊 Analytics & Monitoring'
      ],
      status: {
        automation_scheduler: schedulerStatus.isRunning ? 'RUNNING' : 'STOPPED',
        automation_last_run: schedulerStatus.lastRun,
        automation_total_videos_produced: schedulerStatus.totalVideosProd,
        services_configured: {
          youtube_api: !!process.env.YOUTUBE_API_KEY,
          openai: !!process.env.OPENAI_API_KEY,
          supabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_KEY,
        }
      },
      endpoints: {
        // These refer to the routes defined in your automationRoutes file
        automation_start: 'POST /automation/start',
        automation_stop: 'POST /automation/stop',
        automation_status: 'GET /automation/status',
        automation_trending_analysis: 'GET /automation/trending', // Manual trending analysis trigger
        automation_test_generation: 'POST /automation/test-generate', // Manual content generation trigger
        system_health: 'GET /health',
        system_config: 'GET /config',
        system_metrics: 'GET /metrics',
        manual_video_create_test: 'POST /create-video', // Endpoint for direct video creation testing
        scheduler_start: 'POST /scheduler/start',
        scheduler_stop: 'POST /scheduler/stop',
        scheduler_status: 'GET /scheduler/status'
      },
      quickStart: [
        '1. Ensure all API keys and Supabase credentials are configured in your environment.',
        '2. POST to `/scheduler/start` to activate the automation.',
        '3. Monitor status with `GET /scheduler/status` or `GET /automation/status`.',
        '4. Check logs for detailed progress and errors.'
      ]
    });
  } catch (error: any) {
    logger.error('Error fetching system status:', error);
    res.status(500).json({
      message: 'System status check failed',
      error: error.message || 'Unknown error'
    });
  }
});

// --- CONFIGURATION CHECK ENDPOINT ---
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

  const configStatus = {
    required: {} as Record<string, string>, // Explicit type
    missing: [] as string[],
    ready: true
  };

  requiredEnvVars.forEach(envVar => {
    const isConfigured = !!process.env[envVar];
    configStatus.required[envVar] = isConfigured ? '✅ CONFIGURED' : '❌ MISSING';
    if (!isConfigured) {
      configStatus.missing.push(envVar);
      configStatus.ready = false;
    }
  });

  res.json({
    status: configStatus.ready ? 'READY' : 'INCOMPLETE',
    configuration: configStatus,
    instructions: !configStatus.ready ? {
      message: 'Missing required environment variables. Please set them.',
      missing: configStatus.missing,
      setup_guide: {
        youtube: 'Get YouTube API credentials from Google Cloud Console.',
        openai: 'Get OpenAI API key from OpenAI platform.',
        supabase: 'Create a Supabase project and get URL + anon key.'
      }
    } : 'All required configurations are set!'
  });
});

// --- MOUNT ROUTES ---
// Mount the automation-related routes. These should interact with the AutomationScheduler.
app.use('/automation', automationRoutes);

// --- MANUAL VIDEO CREATION ENDPOINT (for testing) ---
app.post('/create-video', async (req, res) => {
  try {
    const { title, script, niche, duration, resolution, style } = req.body;
    
    if (!title || !script || !niche) { // Check for minimal required fields
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, script, niche'
      });
    }

    logger.info(`🎬 Manual video creation requested for: "${title}"`);
    
    // Construct the VideoConfig object for the producer
    const videoConfig: VideoConfig = {
      title: title, // Pass title if needed by producer
      script: script, // Pass the script itself
      niche: niche,
      duration: duration || 60, // Default duration
      resolution: resolution || '1080p', // Default resolution
      style: style || 'modern' // Default style
    };

    // Use the VideoProducer instance to create the video
    const videoProductionResult = await videoProducer.createVideo(videoConfig);
    
    if (videoProductionResult.success) {
      res.json({
        success: true,
        message: 'Video created successfully!',
        data: {
          videoId: videoProductionResult.videoId,
          filePath: videoProductionResult.filePath,
          config: videoConfig
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to create video',
        error: videoProductionResult.error
      });
    }

  } catch (error: any) {
    logger.error('Error processing manual video creation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process manual video creation',
      error: error.message || 'Unknown error'
    });
  }
});

// --- SYSTEM METRICS ENDPOINT ---
app.get('/metrics', async (req, res) => {
  try {
    // Get status from the AutomationScheduler instance
    const schedulerStatus = scheduler.getStatus();
    
    res.json({
      system: {
        uptime_seconds: process.uptime(),
        memory_usage_bytes: process.memoryUsage(),
        platform: process.platform,
        node_version: process.version
      },
      automation_scheduler: {
        status: schedulerStatus.isRunning ? 'RUNNING' : 'STOPPED',
        last_run: schedulerStatus.lastRun,
        total_videos_produced: schedulerStatus.totalVideosProd,
        errors_count: schedulerStatus.errors.length,
        // Get more detailed stats if available from scheduler
      },
      services_configured: {
        youtube_api: !!process.env.YOUTUBE_API_KEY,
        openai_configured: !!process.env.OPENAI_API_KEY,
        supabase_configured: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_KEY,
        database_connected: !!supabase // Check if Supabase client is initialized
      }
    });
  } catch (error: any) {
    logger.error('Failed to get system metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get metrics',
      error: error.message || 'Unknown error'
    });
  }
});

// --- SCHEDULER CONTROL ENDPOINTS ---
// These endpoints directly interact with the AutomationScheduler instance.

// Start the automation scheduler
app.post('/scheduler/start', (req, res) => {
  try {
    if (scheduler.getStatus().isRunning) {
      return res.status(409).json({
        success: false,
        message: 'Automation scheduler is already running.'
      });
    }
    
    // Initialize the scheduler to set up its cron jobs
    scheduler.initialize(); 
    // Start the scheduler
    scheduler.start();
    
    res.json({
      success: true,
      message: 'Automation scheduler started',
      status: scheduler.getStatus()
    });
  } catch (error: any) {
    logger.error('Failed to start automation scheduler:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start scheduler',
      error: error.message || 'Unknown error'
    });
  }
});

// Stop the automation scheduler
app.post('/scheduler/stop', (req, res) => {
  try {
    if (!scheduler.getStatus().isRunning) {
      return res.status(409).json({
        success: false,
        message: 'Automation scheduler is not running.'
      });
    }
    
    scheduler.stop(); // Stop the scheduler
    
    res.json({
      success: true,
      message: 'Automation scheduler stopped',
      status: scheduler.getStatus()
    });
  } catch (error: any) {
    logger.error('Failed to stop automation scheduler:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop scheduler',
      error: error.message || 'Unknown error'
    });
  }
});

// Get the status of the automation scheduler
app.get('/scheduler/status', (req, res) => {
  res.json({
    success: true,
    status: scheduler.getStatus()
  });
});

// --- 404 HANDLER ---
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /', 'GET /health', 'GET /config', 'GET /metrics',
      'POST /create-video', 'POST /scheduler/start', 'POST /scheduler/stop', 'GET /scheduler/status',
      'POST /automation/start', 'POST /automation/stop', 'GET /automation/status',
      'GET /automation/trending', 'POST /automation/test-generate'
    ]
  });
});

// --- GLOBAL ERROR HANDLING MIDDLEWARE ---
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error caught by global handler:', error);
  
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'An internal server error occurred.',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }) // Include stack in development
  });
});

// --- GRACEFUL SHUTDOWN HANDLING ---
const gracefulShutdown = (signal: string) => {
  logger.warn(`\n🛑 ${signal} received. Shutting down gracefully...`);
  
  // Stop the scheduler
  if (scheduler.getStatus().isRunning) {
    scheduler.stop();
    logger.info('Automation scheduler stopped.');
  }
  
  // Stop the contentEngine if it has its own running processes
  // For example, if contentEngine.startAutomation() was a perpetual loop not managed by scheduler.
  // if (contentEngine.getStatus().isRunning) { // Assuming ContentEngine has a getStatus() and stopAutomation()
  //   contentEngine.stopAutomation(); 
  // }

  logger.info('Shutdown complete. Exiting.');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- SERVER BOOTSTRAP ---
const bootstrap = async () => {
  logger.info('\n🚀 Starting YouTube Automation System...\n');
  
  // Ensure necessary output directories exist
  try {
    await fs.ensureDir(path.join(__dirname, '../temp')); // Intermediate files
  } catch (error: any) {
    logger.error("Error ensuring temporary directories exist:", error.message);
  }
  
  // Initialize the AutomationScheduler (sets up cron jobs)
  try {
    scheduler.initialize();
    logger.info('Automation scheduler initialized.');
  } catch (error: any) {
    logger.error('Failed to initialize Automation Scheduler:', error.message);
  }

  // Start the Express server
  app.listen(PORT, () => {
    logger.info(`\n✅ Server running on port ${PORT}`);
    logger.info(`🌐 API available at: http://localhost:${PORT}`);
    logger.info(`📊 System status: http://localhost:${PORT}/`);
    logger.info(`⚙️  Configuration check: http://localhost:${PORT}/config`);
    logger.info(`📈 Metrics: http://localhost:${PORT}/metrics`);
    
    // Auto-start scheduler in production or if configured via env var
    if (process.env.NODE_ENV === 'production' || process.env.AUTO_START_SCHEDULER === 'true') {
      logger.info('\n🔄 Auto-starting automation scheduler...');
      try {
        scheduler.start(); 
        logger.info('Automation scheduler started automatically.');
      } catch (error: any) {
        logger.error('Failed to auto-start automation scheduler:', error.message);
      }
    } else {
      logger.info('\nℹ️ Automation scheduler is not set to auto-start. Use POST /scheduler/start to activate.');
    }
    
    logger.info('\n✅ YouTube Automation System Ready!\n');
  });
};

// Bootstrap the application
bootstrap();

export default app;
