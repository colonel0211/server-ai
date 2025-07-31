// src/server.ts - Complete YouTube Automation System
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import cron from 'node-cron'; // Still needed for the scheduler itself
import path from 'path';
import fs from 'fs-extra';

// Import routes
import automationRoutes from './routes/automation'; // Assuming this route handler uses the scheduler

// Import your core services
import { YouTubeContentEngine } from './services/ContentEngine';
// import { VideoProducer } from './services/videoProducer'; // VideoProducer might be instantiated by AutomationScheduler
import { AutomationScheduler } from './services/automationScheduler'; // Import the AutomationScheduler

// Import the Supabase client to check its initialization status
import supabase, { SupabaseClient } from './config/database'; 

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- INITIALIZE SERVICES ---
// The YouTubeContentEngine is for specific tasks like hunting and content generation.
const contentEngine = new YouTubeContentEngine(); 
// The AutomationScheduler orchestrates the entire process, including scheduling and managing other services.
const scheduler = new AutomationScheduler();

// --- MIDDLEWARE ---
app.use(helmet()); // Basic security headers
app.use(cors());   // Enable Cross-Origin Resource Sharing
app.use(compression()); // Gzip compression for responses
app.use(morgan('combined')); // HTTP request logging
app.use(express.json({ limit: '50mb' })); // Body parser for JSON payloads
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Body parser for URL-encoded payloads

// --- STATIC FILE SERVING ---
// Serve generated videos and thumbnails from respective directories
app.use('/videos', express.static(path.join(__dirname, '../temp'))); // Assuming videos are stored in temp for now
app.use('/thumbnails', express.static(path.join(__dirname, '../temp'))); // Assuming thumbnails are stored in temp

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
  // Basic health check - doesn't check all dependencies
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
    // We can also check if Supabase client is initialized
    supabase_client_initialized: !!supabase
  });
});

// --- ROOT ENDPOINT WITH SYSTEM STATUS ---
app.get('/', async (req, res) => {
  try {
    // Get status from the AutomationScheduler instance
    const schedulerStatus = scheduler.getStatus();
    
    res.json({
      message: '🚀 YouTube Automation System - Ready!',
      version: '2.0.0', // Update version as needed
      features: [
        '🔍 Trending Video Hunter (500k+ views)',
        '🤖 AI Content Generator (GPT-4)',
        '🎬 Automated Video Production',
        '🎵 AI Voiceover (OpenAI TTS)',
        '🖼️ AI Thumbnail Generation',
        '📤 YouTube Auto-Upload',
        '⏰ 24/7 Automation Scheduler', // This refers to the cron jobs within AutomationScheduler
        '📊 Analytics & Monitoring'
      ],
      status: {
        // Use the scheduler's status
        automation_scheduler: schedulerStatus.isRunning ? 'RUNNING' : 'STOPPED',
        automation_last_run: schedulerStatus.lastRun,
        automation_total_videos_produced: schedulerStatus.totalVideosProd,
        services: {
          youtube_api: process.env.YOUTUBE_API_KEY ? '✅ CONFIGURED' : '❌ MISSING',
          openai: process.env.OPENAI_API_KEY ? '✅ CONFIGURED' : '❌ MISSING',
          supabase: process.env.SUPABASE_URL && process.env.SUPABASE_KEY ? '✅ CONFIGURED' : '❌ MISSING',
          // unsplash: process.env.UNSPLASH_ACCESS_KEY ? '✅ CONFIGURED' : '⚠️ OPTIONAL' // If you use Unsplash
        }
      },
      endpoints: {
        // These are the endpoints exposed by your automationRoutes
        automation_start: 'POST /automation/start',
        automation_stop: 'POST /automation/stop',
        automation_status: 'GET /automation/status',
        automation_trending_analysis: 'GET /automation/trending', // Endpoint for manual analysis
        automation_test_generation: 'POST /automation/test-generate', // Endpoint for manual generation
        automation_uploads: 'GET /automation/uploads', // Assuming this fetches upload history
        system_health: 'GET /health',
        system_config: 'GET /config',
        system_metrics: 'GET /metrics',
        manual_video_create: 'POST /create-video' // Example test endpoint
      },
      quickStart: [
        '1. Ensure all API keys and Supabase credentials are configured in your environment.',
        '2. POST to `/automation/start` to begin the automated workflow.',
        '3. Monitor status with `GET /automation/status`.',
        '4. Check logs for detailed progress and errors.'
      ]
    });
  } catch (error) {
    logger.error('Error fetching system status:', error); // Use your logger
    res.status(500).json({
      message: 'System status check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
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

  // const optionalEnvVars = ['UNSPLASH_ACCESS_KEY']; // If you use other services

  const configStatus = {
    required: {} as any,
    // optional: {} as any,
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

  // Check optional variables (if any)
  // optionalEnvVars.forEach(envVar => {
  //   configStatus.optional[envVar] = process.env[envVar] ? '✅ CONFIGURED' : '⚠️ NOT SET';
  // });

  res.json({
    status: configStatus.ready ? 'READY' : 'INCOMPLETE',
    configuration: configStatus,
    instructions: !configStatus.ready ? {
      message: 'Missing required environment variables. Please set them.',
      missing: configStatus.missing,
      setup_guide: {
        youtube: 'Get YouTube API credentials from Google Cloud Console',
        openai: 'Get OpenAI API key from OpenAI platform',
        supabase: 'Create Supabase project and get URL + anon key'
      }
    } : 'All required configurations are set!'
  });
});

// --- MOUNT ROUTES ---
// Mount the automation routes. These routes will likely control the AutomationScheduler.
app.use('/automation', automationRoutes);

// --- MANUAL VIDEO CREATION ENDPOINT (for testing) ---
// This is a separate endpoint for testing video production directly.
app.post('/create-video', async (req, res) => {
  try {
    const { title, script, niche, duration, style, resolution } = req.body;
    
    if (!title || !script || !niche) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, script, niche'
      });
    }

    logger.info(`🎬 Manual video creation requested: ${title}`);
    
    // Construct the VideoConfig object required by VideoProducer
    const videoConfig: VideoConfig = {
      title: title, // You might need to pass title separately or include it in script
      script: script, // Pass the script directly
      niche: niche,
      duration: duration || 60, // Default to 60 if not provided
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
        // cpu_usage is not directly available in Node.js without external modules
        platform: process.platform,
        node_version: process.version
      },
      automation_scheduler: {
        status: schedulerStatus.isRunning ? 'RUNNING' : 'STOPPED',
        last_run: schedulerStatus.lastRun,
        total_videos_produced: schedulerStatus.totalVideosProd,
        errors_count: schedulerStatus.errors.length,
        // Could add more from scheduler.getStats()
      },
      services_configured: {
        youtube_api: !!process.env.YOUTUBE_API_KEY,
        openai_configured: !!process.env.OPENAI_API_KEY,
        supabase_configured: !!process.env.SUPABASE_URL,
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
    // Check if scheduler is already running to avoid multiple starts
    if (scheduler.getStatus().isRunning) {
      return res.status(409).json({
        success: false,
        message: 'Automation scheduler is already running.'
      });
    }
    
    // Initialize the scheduler if it hasn't been (or if it was stopped)
    // This might be redundant if initialize() is called on server start,
    // but good to have for robustness if start is called after a stop.
    scheduler.initialize(); 
    
    // Start the scheduler
    scheduler.start();
    
    res.json({
      success: true,
      message: 'Automation scheduler started',
      // You might want to return the scheduler's next run time or status
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
    // Check if scheduler is actually running before trying to stop
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
      'GET /',
      'GET /health',
      'GET /config',
      'GET /metrics',
      'POST /create-video', // Manual video creation test endpoint
      'POST /scheduler/start',
      'POST /scheduler/stop',
      'GET /scheduler/status',
      'POST /automation/start', // These likely trigger scheduler or engine actions
      'POST /automation/stop',
      'GET /automation/status',
      'GET /automation/trending',
      'POST /automation/test-generate'
    ]
  });
});

// --- GLOBAL ERROR HANDLING MIDDLEWARE ---
// Catch-all for any unhandled errors
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error caught by global handler:', error);
  
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'An internal server error occurred.',
    // Include stack trace only in development for debugging
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// --- GRACEFUL SHUTDOWN HANDLING ---
// Listen for termination signals and shut down cleanly
const gracefulShutdown = (signal: string) => {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
  
  // Stop the scheduler if it's running
  if (scheduler.getStatus().isRunning) {
    scheduler.stop();
    console.log('Automation scheduler stopped.');
  }
  
  // You might also want to stop the contentEngine if it has long-running processes not managed by the scheduler
  // For example, if contentEngine had its own startAutomation() that was a perpetual loop.
  // if (contentEngine.getStatus().isRunning) {
  //   contentEngine.stopAutomation(); // Assuming ContentEngine has this method
  // }

  console.log('Shutdown complete. Exiting.');
  process.exit(0); // Exit the process
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- SERVER STARTUP ---
const bootstrap = async () => {
  console.log('\n🚀 Starting YouTube Automation System...\n');
  
  // Ensure necessary output directories exist
  try {
    await fs.ensureDir(path.join(__dirname, '../temp')); // Use 'temp' for intermediate files
    // If you have a permanent 'output' dir, ensure that too
    // await fs.ensureDir(path.join(__dirname, '../output/videos'));
    // await fs.ensureDir(path.join(__dirname, '../output/thumbnails'));
    // await fs.ensureDir(path.join(__dirname, '../output/audio'));
  } catch (error) {
    logger.error("Error ensuring output directories exist:", error);
    // Decide if this is a critical error preventing startup
    // process.exit(1);
  }
  
  // Initialize the AutomationScheduler. This sets up the cron jobs.
  try {
    scheduler.initialize();
    console.log('Automation scheduler initialized.');
  } catch (error: any) {
    logger.error('Failed to initialize Automation Scheduler:', error.message);
    // Decide if this is critical. If scheduler is core, you might exit.
  }

  // Start the server
  app.listen(PORT, () => {
    console.log(`\n📡 Server running on port ${PORT}`);
    console.log(`🌐 API available at: http://localhost:${PORT}`);
    console.log(`📊 System status: http://localhost:${PORT}/`);
    console.log(`⚙️  Configuration check: http://localhost:${PORT}/config`);
    console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
    
    // Optionally auto-start the scheduler in production or if configured
    if (process.env.NODE_ENV === 'production' || process.env.AUTO_START_SCHEDULER === 'true') {
      console.log('\n🔄 Auto-starting automation scheduler...');
      try {
        scheduler.start(); // Start the scheduler if auto-start is enabled
        console.log('Automation scheduler started automatically.');
      } catch (error: any) {
        logger.error('Failed to auto-start automation scheduler:', error.message);
      }
    } else {
      console.log('\nℹ️ Automation scheduler is not set to auto-start. Use POST /scheduler/start to activate.');
    }
    
    console.log('\n✅ YouTube Automation System Ready!\n');
  });
};

// Bootstrap the application
bootstrap();

export default app; // Export app for potential testing or other uses
