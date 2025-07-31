import express from 'express';
import { YouTubeContentEngine } from '../services/ContentEngine';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();
const contentEngine = new YouTubeContentEngine();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

// Start 24/7 automation
router.post('/start', async (req, res) => {
  try {
    const status = contentEngine.getStatus();
    
    if (status.isRunning) {
      return res.status(400).json({
        success: false,
        message: 'Automation is already running',
        status
      });
    }

    // Start automation in background
    contentEngine.startAutomation().catch(console.error);
    
    res.json({
      success: true,
      message: '🚀 24/7 YouTube automation started!',
      status: contentEngine.getStatus(),
      features: [
        '🔍 Hunts trending videos with 500k+ views',
        '🤖 Generates unique AI content scripts',
        '🎬 Creates videos with AI voiceover and visuals',
        '📤 Uploads to YouTube automatically',
        '⏰ Runs continuously 24/7',
        '📊 Smart scheduling to avoid spam detection'
      ]
    });
    
  } catch (error) {
    console.error('Error starting automation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start automation',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop automation
router.post('/stop', async (req, res) => {
  try {
    contentEngine.stopAutomation();
    
    res.json({
      success: true,
      message: '🛑 Automation stopped successfully',
      status: contentEngine.getStatus()
    });
    
  } catch (error) {
    console.error('Error stopping automation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop automation',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get automation status
router.get('/status', async (req, res) => {
  try {
    const status = contentEngine.getStatus();
    
    // Get recent uploads from database
    const { data: recentUploads } = await supabase
      .from('uploaded_videos')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(10);

    // Get trending videos analysis
    const { data: trendingAnalysis } = await supabase
      .from('trending_videos')
      .select('*')
      .order('analyzed_at', { ascending: false })
      .limit(5);

    res.json({
      success: true,
      automation: status,
      stats: {
        totalUploads: recentUploads?.length || 0,
        recentUploads: recentUploads || [],
        lastTrendingAnalysis: trendingAnalysis?.[0] || null,
        systemHealth: status.isRunning ? 'ACTIVE' : 'STOPPED'
      },
      nextActions: status.isRunning ? [
        'Hunting for trending videos...',
        'Analyzing content patterns...',
        'Generating unique scripts...',
        'Creating videos with AI...',
        'Uploading to YouTube...'
      ] : [
        'System is stopped',
        'Click /automation/start to begin'
      ]
    });
    
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get trending videos analysis
router.get('/trending', async (req, res) => {
  try {
    console.log('🔍 Fetching current trending videos...');
    
    const trendingVideos = await contentEngine.huntTrendingVideos();
    
    res.json({
      success: true,
      message: `Found ${trendingVideos.length} trending videos with 500k+ views`,
      data: trendingVideos.slice(0, 20), // Return top 20
      analysis: {
        totalFound: trendingVideos.length,
        averageViews: trendingVideos.reduce((sum, v) => sum + v.views, 0) / trendingVideos.length,
        topCategories: [...new Set(trendingVideos.map(v => v.category))],
        trending_keywords: trendingVideos
          .flatMap(v => v.tags)
          .reduce((acc: any, tag) => {
            acc[tag] = (acc[tag] || 0) + 1;
            return acc;
          }, {})
      }
    });
    
  } catch (error) {
    console.error('Error fetching trending videos:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending videos',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test content generation (without upload)
router.post('/test-generate', async (req, res) => {
  try {
    console.log('🧪 Testing content generation...');
    
    // Get sample trending videos
    const trendingVideos = await contentEngine.huntTrendingVideos();
    
    if (trendingVideos.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No trending videos found to analyze'
      });
    }

    // Generate content scripts
    const scripts = await contentEngine.analyzeAndGenerateContent(trendingVideos.slice(0, 2));
    
    res.json({
      success: true,
      message: `✅ Generated ${scripts.length} unique video scripts`,
      data: {
        trending_source: trendingVideos.slice(0, 2).map(v => ({
          title: v.title,
          views: v.views.toLocaleString(),
          channel: v.channelTitle
        })),
        generated_scripts: scripts.map(script => ({
          title: script.title,
          description: script.description.substring(0, 200) + '...',
          tags: script.tags,
          segments: script.segments.length,
          estimated_duration: script.segments.reduce((sum, s) => sum + s.duration, 0) + 's'
        }))
      },
      note: 'This is a test generation. Use /automation/start for full automation.'
    });
    
  } catch (error) {
    console.error('Error testing generation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test content generation',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get upload history
router.get('/uploads', async (req, res) => {
  try {
    const { data: uploads, error } = await supabase
      .from('uploaded_videos')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({
      success: true,
      message: `Found ${uploads?.length || 0} uploaded videos`,
      data: uploads || [],
      stats: {
        totalUploads: uploads?.length || 0,
        lastUpload: uploads?.[0]?.uploaded_at || null,
        topTags: {} // Could calculate most used tags
      }
    });
    
  } catch (error) {
    console.error('Error fetching uploads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch upload history',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Emergency stop all operations
router.post('/emergency-stop', async (req, res) => {
  try {
    contentEngine.stopAutomation();
    
    res.json({
      success: true,
      message: '🚨 EMERGENCY STOP: All automation stopped immediately',
      status: contentEngine.getStatus(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in emergency stop:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to emergency stop',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Health check for automation system
router.get('/health', async (req, res) => {
  try {
    const status = contentEngine.getStatus();
    
    // Check database connection
    const { error: dbError } = await supabase
      .from('uploaded_videos')
      .select('count')
      .limit(1);

    // Check environment variables
    const requiredEnvVars = [
      'YOUTUBE_API_KEY',
      'YOUTUBE_CLIENT_ID', 
      'YOUTUBE_CLIENT_SECRET',
      'OPENAI_API_KEY',
      'SUPABASE_URL',
      'SUPABASE_KEY'
    ];
    
    const missingEnvVars = requiredEnvVars.filter(env => !process.env[env]);
    
    const health = {
      automation: status.isRunning ? 'RUNNING' : 'STOPPED',
      database: dbError ? 'ERROR' : 'CONNECTED',
      environment: missingEnvVars.length === 0 ? 'CONFIGURED' : 'MISSING_VARS',
      services: {
        youtube_api: process.env.YOUTUBE_API_KEY ? 'CONFIGURED' : 'MISSING',
        openai: process.env.OPENAI_API_KEY ? 'CONFIGURED' : 'MISSING',
        supabase: process.env.SUPABASE_URL ? 'CONFIGURED' : 'MISSING'
      }
    };
    
    const allHealthy = Object.values(health).every(v => 
      v === 'RUNNING' || v === 'STOPPED' || v === 'CONNECTED' || v === 'CONFIGURED'
    );
    
    res.status(allHealthy ? 200 : 500).json({
      success: allHealthy,
      message: allHealthy ? '✅ All systems healthy' : '⚠️ System issues detected',
      health,
      missingEnvVars,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error checking health:', error);
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
