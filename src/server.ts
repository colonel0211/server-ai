// src/server.ts - Complete server with real YouTube upload
import express from 'express';
import { google } from 'googleapis';
import fs from 'fs-extra';
import path from 'path';
import cors from 'cors';
import cron from 'node-cron';
import { VideoGenerator } from './videoGenerator';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// YouTube API setup
const youtube = google.youtube('v3');
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

// Video generator
const videoGenerator = new VideoGenerator();

// System state
let systemRunning = false;
let stats = {
  totalUploaded: 0,
  todayUploaded: 0,
  lastUpload: null as Date | null,
  errors: 0,
  systemStarted: new Date(),
  nextUpload: null as Date | null,
  lastError: null as string | null
};

// Content templates for automation
const contentTemplates = {
  topics: [
    "10 Amazing Facts About",
    "How to Master",
    "The Secret Behind", 
    "Why You Should Know About",
    "Incredible Stories of",
    "The Ultimate Guide to",
    "Shocking Truth About",
    "Life-Changing Tips for",
    "The Science of",
    "Mysteries of",
    "Future of",
    "History of",
    "Complete Guide to"
  ],
  subjects: [
    "Space Exploration", "Ocean Mysteries", "Ancient Civilizations",
    "Technology Trends", "Human Psychology", "Nature Wonders", 
    "Scientific Discoveries", "Historical Events", "Future Predictions",
    "Art and Culture", "Health and Wellness", "Success Stories",
    "Artificial Intelligence", "Climate Change", "Renewable Energy",
    "Quantum Physics", "Blockchain Technology", "Sustainable Living",
    "Digital Marketing", "Personal Development", "Financial Freedom"
  ]
};

// Token management
async function loadTokens(): Promise<boolean> {
  try {
    const tokenPath = '.youtube-tokens.json';
    if (await fs.pathExists(tokenPath)) {
      const tokens = await fs.readJson(tokenPath);
      oauth2Client.setCredentials(tokens);
      console.log('✅ YouTube tokens loaded');
      return true;
    }
  } catch (error) {
    console.log('❌ Failed to load tokens:', error);
  }
  return false;
}

async function saveTokens(tokens: any) {
  try {
    await fs.writeJson('.youtube-tokens.json', tokens);
    console.log('💾 Tokens saved');
  } catch (error) {
    console.error('Failed to save tokens:', error);
  }
}

// Content generation
async function generateVideoContent() {
  const topic = contentTemplates.topics[Math.floor(Math.random() * contentTemplates.topics.length)];
  const subject = contentTemplates.subjects[Math.floor(Math.random() * contentTemplates.subjects.length)];
  
  const title = `${topic} ${subject}`;
  const description = `
Discover fascinating insights about ${subject.toLowerCase()}. This educational video explores key concepts and provides valuable information that will expand your knowledge and understanding.

🔔 Subscribe for more educational content!
👍 Like if you found this helpful!
💬 Comment with your thoughts below!

Key topics covered:
• Essential information about ${subject.toLowerCase()}
• Important facts and discoveries
• Practical insights and applications
• Future implications and trends

#${subject.replace(/\s+/g, '')} #Education #Facts #Learning #Knowledge #Science #Educational #Documentary #Information

Generated: ${new Date().toISOString()}
  `.trim();

  const tags = [
    ...subject.toLowerCase().split(' '),
    'education', 'facts', 'knowledge', 'learning', 'science', 
    'educational', 'documentary', 'information', 'discovery'
  ].slice(0, 10); // YouTube allows max 10 tags

  return { title, description, tags };
}

// YouTube upload function
async function uploadToYoutube(videoPath: string, content: any) {
  try {
    console.log(`📤 Uploading to YouTube: ${content.title}`);
    
    if (!await fs.pathExists(videoPath)) {
      throw new Error('Video file not found');
    }

    const response = await youtube.videos.insert({
      auth: oauth2Client,
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: content.title,
          description: content.description,
          tags: content.tags,
          categoryId: '27', // Education category
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en'
        },
        status: {
          privacyStatus: process.env.VIDEO_PRIVACY || 'public',
          selfDeclaredMadeForKids: false,
          publicStatsViewable: true
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });

    // Clean up video file
    await videoGenerator.cleanup(videoPath);

    const videoId = response.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Update stats
    stats.totalUploaded++;
    stats.todayUploaded++;
    stats.lastUpload = new Date();
    stats.lastError = null;
    
    console.log(`✅ Video uploaded successfully: ${videoUrl}`);
    
    return {
      success: true,
      videoId,
      videoUrl,
      title: content.title
    };
    
  } catch (error) {
    console.error('Upload failed:', error);
    stats.errors++;
    stats.lastError = error.message;
    throw error;
  }
}

// Main automation function
async function automatedVideoUpload() {
  if (!systemRunning) {
    console.log('⏸️ System not running, skipping upload');
    return;
  }
  
  try {
    console.log('🤖 Starting automated video creation...');
    
    // Check authentication
    if (!oauth2Client.credentials.access_token) {
      throw new Error('YouTube authentication required');
    }
    
    // Generate content
    const content = await generateVideoContent();
    console.log(`📝 Generated content: ${content.title}`);
    
    // Create video
    const videoPath = await videoGenerator.createVideo(content);
    
    // Upload to YouTube
    const result = await uploadToYoutube(videoPath, content);
    
    console.log('🎉 Automated upload completed:', result.title);
    
    // Calculate next upload time (2 hours)
    stats.nextUpload = new Date(Date.now() + 2 * 60 * 60 * 1000);
    
    return result;
    
  } catch (error) {
    console.error('❌ Automated upload failed:', error);
    stats.errors++;
    stats.lastError = error.message;
    throw error;
  }
}

// Health check for Koyeb
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    systemRunning,
    lastUpload: stats.lastUpload,
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// Main dashboard
app.get('/', async (req, res) => {
  const tokensExist = await fs.pathExists('.youtube-tokens.json');
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🤖 24/7 YouTube Automation</title>
        <meta http-equiv="refresh" content="30">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: white; 
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { 
                background: linear-gradient(135deg, #ff0000 0%, #cc0000 100%);
                padding: 30px; 
                border-radius: 15px; 
                margin-bottom: 30px;
                text-align: center;
                box-shadow: 0 10px 30px rgba(255,0,0,0.3);
            }
            .header h1 { font-size: 2.5em; margin-bottom: 10px; }
            .stats { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
                gap: 20px; 
                margin-bottom: 30px; 
            }
            .stat-card { 
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                padding: 25px; 
                border-radius: 15px; 
                text-align: center;
                border: 1px solid rgba(255,255,255,0.2);
                transition: transform 0.3s ease;
            }
            .stat-card:hover { transform: translateY(-5px); }
            .stat-number { 
                font-size: 2.5em; 
                font-weight: bold; 
                color: #ff0000; 
                margin-bottom: 10px;
            }
            .controls { 
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                padding: 25px; 
                border-radius: 15px; 
                margin-bottom: 20px;
                border: 1px solid rgba(255,255,255,0.2);
            }
            button { 
                background: linear-gradient(135deg, #ff0000 0%, #cc0000 100%);
                color: white; 
                padding: 12px 24px; 
                border: none; 
                border-radius: 8px; 
                cursor: pointer; 
                margin: 5px;
                font-weight: bold;
                transition: all 0.3s ease;
            }
            button:hover:not(:disabled) { 
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(255,0,0,0.4);
            }
            button:disabled { 
                background: #666; 
                cursor: not-allowed;
                transform: none;
            }
            .status { 
                padding: 15px; 
                margin: 15px 0; 
                border-radius: 10px;
                font-weight: bold;
            }
            .success { background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid #22c55e; }
            .error { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444; }
            .pulse { animation: pulse 2s infinite; }
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
            .error-log {
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid #ef4444;
                border-radius: 8px;
                padding: 10px;
                margin: 10px 0;
                font-family: monospace;
                font-size: 0.9em;
                max-height: 200px;
                overflow-y: auto;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 YouTube Automation System</h1>
                <p>Running 24/7 on Koyeb Cloud Platform</p>
                <small>System Started: ${stats.systemStarted.toLocaleString()}</small>
            </div>

            ${!tokensExist ? `
                <div class="status error">
                    ❌ YouTube not connected. <a href="/auth" style="color: #fff; text-decoration: underline;">Authenticate Now</a>
                </div>
            ` : `
                <div class="status success">
                    ✅ Connected to YouTube API - Ready for Automation
                </div>
            `}

            ${stats.lastError ? `
                <div class="status error">
                    🚨 Last Error: ${stats.lastError}
                </div>
            ` : ''}

            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number">${stats.totalUploaded}</div>
                    <div>Total Videos Uploaded</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.todayUploaded}</div>
                    <div>Uploaded Today</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.errors}</div>
                    <div>Upload Errors</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number ${systemRunning ? 'pulse' : ''}">${systemRunning ? '🟢 ACTIVE' : '🔴 STOPPED'}</div>
                    <div>System Status</div>
                </div>
            </div>

            <div class="controls">
                <h3>🎛️ System Controls</h3>
                <button onclick="startSystem()" ${!tokensExist || systemRunning ? 'disabled' : ''}>
                    🚀 Start 24/7 Automation
                </button>
                <button onclick="stopSystem()" ${!systemRunning ? 'disabled' : ''}>
                    ⏹️ Stop Automation
                </button>
                <button onclick="uploadNow()" ${!tokensExist ? 'disabled' : ''}>
                    📤 Upload Video Now
                </button>
                <button onclick="clearErrors()">
                    🧹 Clear Error Log
                </button>
                <button onclick="location.reload()">
                    🔄 Refresh Dashboard
                </button>
            </div>

            <div class="controls">
                <h3>📅 Schedule & Status</h3>
                <p><strong>Upload Frequency:</strong> Every 2 hours (12 videos/day)</p>
                <p><strong>Expected Monthly:</strong> ~360 videos</p>
                <p><strong>Last Upload:</strong> ${stats.lastUpload ? stats.lastUpload.toLocaleString() : 'None yet'}</p>
                <p><strong>Next Upload:</strong> ${stats.nextUpload ? stats.nextUpload.toLocaleString() : 'When system starts'}</p>
                <p><strong>System Uptime:</strong> ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m</p>
            </div>

            <div class="controls">
                <h3>🌐 Deployment Info</h3>
                <p><strong>Platform:</strong> Koyeb Cloud</p>
                <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
                <p><strong>Memory Usage:</strong> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB</p>
                <p><strong>Node Version:</strong> ${process.version}</p>
                <p><strong>App URL:</strong> <a href="${process.env.YOUTUBE_REDIRECT_URI?.replace('/auth/callback', '')}" style="color: #ff6b6b;">${process.env.YOUTUBE_REDIRECT_URI?.replace('/auth/callback', '') || 'localhost:3000'}</a></p>
            </div>
        </div>

        <script>
            async function makeRequest(url, method = 'POST') {
                try {
                    const response = await fetch(url, { method });
                    const result = await response.json();
                    alert(result.message);
                    setTimeout(() => location.reload(), 1000);
                } catch (error) {
                    alert('Request failed: ' + error.message);
                }
            }

            function startSystem() { makeRequest('/api/start'); }
            function stopSystem() { makeRequest('/api/stop'); }
            function uploadNow() { 
                if (confirm('Upload a video right now?')) {
                    makeRequest('/api/upload-now'); 
                }
            }
            function clearErrors() { makeRequest('/api/clear-errors'); }
        </script>
    </body>
    </html>
  `);
});

// API Routes
app.post('/api/start', async (req, res) => {
  try {
    const tokensExist = await fs.pathExists('.youtube-tokens.json');
    if (!tokensExist) {
      return res.json({ success: false, message: '❌ Please authenticate with YouTube first' });
    }
    
    systemRunning = true;
    stats.nextUpload = new Date(Date.now() + 2 * 60 * 60 * 1000);
    console.log('🚀 Automation system started');
    res.json({ success: true, message: '🚀 24/7 Automation started! Videos will upload every 2 hours.' });
  } catch (error) {
    res.json({ success: false, message: `❌ Failed to start: ${error.message}` });
  }
});

app.post('/api/stop', (req, res) => {
  systemRunning = false;
  stats.nextUpload = null;
  console.log('⏹️ Automation system stopped');
  res.json({ success: true, message: '⏹️ Automation stopped. No more automatic uploads.' });
});

app.post('/api/upload-now', async (req, res) => {
  try {
    const result = await automatedVideoUpload();
    res.json({ 
      success: true, 
      message: `✅ Video "${result.title}" uploaded! View: ${result.videoUrl}` 
    });
  } catch (error) {
    res.json({ success: false, message: `❌ Upload failed: ${error.message}` });
  }
});

app.post('/api/clear-errors', (req, res) => {
  stats.errors = 0;
  stats.lastError = null;
  res.json({ success: true, message: '🧹 Error log cleared' });
});

// OAuth routes
app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code as string);
    oauth2Client.setCredentials(tokens);
    await saveTokens(tokens);
    console.log('✅ YouTube authentication successful');
    res.redirect('/?success=auth');
  } catch (error) {
    console.error('Auth error:', error);
    res.redirect('/?error=auth');
  }
});

// Cron schedules
cron.schedule('0 */2 * * *', () => {
  console.log('⏰ Scheduled upload triggered');
  if (systemRunning) {
    automatedVideoUpload().catch(console.error);
  }
});

cron.schedule('0 0 * * *', () => {
  stats.todayUploaded = 0;
  console.log('📅 Daily stats reset - New day started');
});

// Error recovery cron - retry failed uploads
cron.schedule('*/30 * * * *', async () => {
  if (systemRunning && stats.lastError && stats.errors > 0) {
    console.log('🔄 Attempting error recovery...');
    try {
      await automatedVideoUpload();
      console.log('✅ Error recovery successful');
    } catch (error) {
      console.log('❌ Error recovery failed, will retry in 30 minutes');
    }
  }
});

// Server startup
async function startServer() {
  try {
    // Load existing tokens
    await loadTokens();
    
    // Ensure temp directories exist
    await videoGenerator.ensureDirectories();
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                 🤖 YouTube Automation Bot                  ║
║                      SYSTEM STARTED                       ║
╠════════════════════════════════════════════════════════════╣
║  🌐 Server: http://localhost:${PORT}                      ║
║  🎬 Status: Ready for 24/7 automation                     ║
║  ⚡ Platform: Koyeb Cloud Infrastructure                   ║
║  📅 Upload Schedule: Every 2 hours                        ║
║  🎯 Expected: 360+ videos/month                           ║
╚════════════════════════════════════════════════════════════╝
      `);
      
      // Auto-start if tokens exist and system was previously running
      if (process.env.AUTO_START === 'true') {
        setTimeout(async () => {
          const tokensExist = await fs.pathExists('.youtube-tokens.json');
          if (tokensExist) {
            systemRunning = true;
            stats.nextUpload = new Date(Date.now() + 2 * 60 * 60 * 1000);
            console.log('🚀 Auto-started automation system');
          }
        }, 5000);
      }
    });
    
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  systemRunning = false;
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  systemRunning = false;
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  stats.errors++;
  stats.lastError = error.message;
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  stats.errors++;
  stats.lastError = String(reason);
});

// Additional API endpoints for better monitoring
app.get('/api/stats', (req, res) => {
  res.json({
    ...stats,
    systemRunning,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    environment: process.env.NODE_ENV
  });
});

app.get('/api/logs', (req, res) => {
  // Simple in-memory log viewer (in production, use proper logging)
  const logs = [
    `System started: ${stats.systemStarted.toISOString()}`,
    `Total uploads: ${stats.totalUploaded}`,
    `Today uploads: ${stats.todayUploaded}`,
    `Errors: ${stats.errors}`,
    `Status: ${systemRunning ? 'RUNNING' : 'STOPPED'}`,
    `Last upload: ${stats.lastUpload?.toISOString() || 'None'}`,
    `Next upload: ${stats.nextUpload?.toISOString() || 'Not scheduled'}`,
    `Last error: ${stats.lastError || 'None'}`
  ];
  
  res.json({ logs });
});

// Webhook endpoint for external triggers
app.post('/api/webhook', async (req, res) => {
  const { action, secret } = req.body;
  
  // Simple security check
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    switch (action) {
      case 'upload':
        const result = await automatedVideoUpload();
        res.json({ success: true, result });
        break;
      case 'start':
        systemRunning = true;
        res.json({ success: true, message: 'System started' });
        break;
      case 'stop':
        systemRunning = false;
        res.json({ success: true, message: 'System stopped' });
        break;
      default:
        res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
startServer();
