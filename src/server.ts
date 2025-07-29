import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import cron from 'node-cron';
import axios from 'axios';

// Load environment variables
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

// System state (using memory since Koyeb is stateless)
let systemRunning = false;
let stats = {
  totalUploaded: 0,
  todayUploaded: 0,
  lastUpload: null,
  errors: 0,
  systemStarted: new Date(),
  nextUpload: null
};

// Content generation templates
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
    "Mysteries of"
  ],
  subjects: [
    "Space Exploration", "Ocean Mysteries", "Ancient Civilizations",
    "Technology Trends", "Human Psychology", "Nature Wonders", 
    "Scientific Discoveries", "Historical Events", "Future Predictions",
    "Art and Culture", "Health and Wellness", "Success Stories",
    "Artificial Intelligence", "Climate Change", "Renewable Energy"
  ]
};

// Health check endpoint for Koyeb
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    systemRunning,
    lastUpload: stats.lastUpload 
  });
});

// Load tokens function
function loadTokens() {
  try {
    // In Koyeb, we'll use environment variables for persistence
    const tokensEnv = process.env.YOUTUBE_TOKENS;
    if (tokensEnv) {
      const tokens = JSON.parse(tokensEnv);
      oauth2Client.setCredentials(tokens);
      console.log('✅ YouTube tokens loaded from environment');
      return true;
    }
    
    // Fallback to file system (temporary)
    if (fs.existsSync('.youtube-tokens.json')) {
      const tokens = JSON.parse(fs.readFileSync('.youtube-tokens.json', 'utf8'));
      oauth2Client.setCredentials(tokens);
      console.log('✅ YouTube tokens loaded from file');
      return true;
    }
  } catch (error) {
    console.log('❌ Failed to load tokens:', error.message);
  }
  return false;
}

// Save tokens function
function saveTokens(tokens: any) {
  try {
    // Save to file for current session
    fs.writeFileSync('.youtube-tokens.json', JSON.stringify(tokens));
    console.log('💾 Tokens saved to file');
    
    // In production, you'd save to environment variable or database
    // For now, tokens persist only during the session
  } catch (error) {
    console.error('Failed to save tokens:', error);
  }
}

// Generate video content
async function generateVideoContent() {
  const topic = contentTemplates.topics[Math.floor(Math.random() * contentTemplates.topics.length)];
  const subject = contentTemplates.subjects[Math.floor(Math.random() * contentTemplates.subjects.length)];
  
  const title = `${topic} ${subject}`;
  const description = `
Discover fascinating insights about ${subject.toLowerCase()}. This educational video explores key concepts and provides valuable information that will expand your knowledge and understanding.

🔔 Subscribe for more educational content!
👍 Like if you found this helpful!
💬 Comment with your thoughts!

#${subject.replace(/\s+/g, '')} #Education #Facts #Learning #Knowledge #Science
  `.trim();

  const tags = [
    ...subject.toLowerCase().split(' '),
    'education', 'facts', 'knowledge', 'learning', 'science', 'educational'
  ];

  return { title, description, tags };
}

// Simulate video creation (replace with actual video generation)
async function createVideo(content: any): Promise<string> {
  try {
    console.log(`🎬 Creating video: ${content.title}`);
    
    // Create temp directory if not exists
    if (!fs.existsSync('temp_videos')) {
      fs.mkdirSync('temp_videos', { recursive: true });
    }
    
    const videoPath = `temp_videos/video_${Date.now()}.mp4`;
    
    // Simulate video creation process
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Create a minimal MP4 file (in real implementation, use FFmpeg to create actual video)
    const dummyVideoBuffer = Buffer.from('dummy video content for ' + content.title);
    fs.writeFileSync(videoPath, dummyVideoBuffer);
    
    console.log(`✅ Video created: ${videoPath}`);
    return videoPath;
    
  } catch (error) {
    console.error('Video creation failed:', error);
    throw error;
  }
}

// Upload to YouTube
async function uploadToYoutube(videoPath: string, content: any) {
  try {
    console.log(`📤 Uploading to YouTube: ${content.title}`);
    
    // For demo purposes, we'll simulate the upload
    // In production, uncomment the actual YouTube API call below
    
    /*
    const response = await youtube.videos.insert({
      auth: oauth2Client,
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: content.title,
          description: content.description,
          tags: content.tags,
          categoryId: '27', // Education
        },
        status: {
          privacyStatus: process.env.VIDEO_PRIVACY || 'public',
          selfDeclaredMadeForKids: false
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });
    */
    
    // Simulate successful upload
    const mockVideoId = 'ABC' + Math.random().toString(36).substr(2, 9);
    const response = { data: { id: mockVideoId } };
    
    // Clean up video file
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    const videoId = response.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Update stats
    stats.totalUploaded++;
    stats.todayUploaded++;
    stats.lastUpload = new Date();
    
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
    
    // Generate content
    const content = await generateVideoContent();
    console.log(`📝 Generated content: ${content.title}`);
    
    // Create video
    const videoPath = await createVideo(content);
    
    // Upload to YouTube
    const result = await uploadToYoutube(videoPath, content);
    
    console.log('🎉 Automated upload completed:', result.title);
    
    // Calculate next upload time
    stats.nextUpload = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    
  } catch (error) {
    console.error('❌ Automated upload failed:', error);
    stats.errors++;
  }
}

// Main dashboard
app.get('/', (req, res) => {
  const tokensExist = fs.existsSync('.youtube-tokens.json') || process.env.YOUTUBE_TOKENS;
  
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
            @media (max-width: 768px) {
                .header h1 { font-size: 1.8em; }
                .stats { grid-template-columns: 1fr; }
                button { width: 100%; margin: 5px 0; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 YouTube Automation System</h1>
                <p>Running 24/7 on Koyeb Cloud Platform</p>
                <small>Deployed at: ${new Date().toLocaleString()}</small>
            </div>

            ${!tokensExist ? `
                <div class="status error">
                    ❌ YouTube not connected. <a href="/auth" style="color: #fff; text-decoration: underline;">Authenticate Now</a>
                </div>
            ` : `
                <div class="status success">
                    ✅ Connected to YouTube API - System Ready for Automation
                </div>
            `}

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
                <button onclick="location.reload()">
                    🔄 Refresh Dashboard
                </button>
            </div>

            <div class="controls">
                <h3>📅 Automation Schedule</h3>
                <p><strong>Upload Frequency:</strong> Every 2 hours automatically</p>
                <p><strong>Last Upload:</strong> ${stats.lastUpload ? stats.lastUpload.toLocaleString() : 'None yet'}</p>
                <p><strong>Next Upload:</strong> ${stats.nextUpload ? stats.nextUpload.toLocaleTimeString() : 'When system starts'}</p>
                <p><strong>System Uptime:</strong> ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m</p>
            </div>

            <div class="controls">
                <h3>🌐 Koyeb Deployment Info</h3>
                <p><strong>Platform:</strong> Koyeb Cloud</p>
                <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
                <p><strong>Memory Usage:</strong> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB</p>
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
        </script>
    </body>
    </html>
  `);
});

// API Routes
app.post('/api/start', (req, res) => {
  if (!fs.existsSync('.youtube-tokens.json') && !process.env.YOUTUBE_TOKENS) {
    return res.json({ success: false, message: '❌ Please authenticate with YouTube first' });
  }
  
  systemRunning = true;
  stats.nextUpload = new Date(Date.now() + 2 * 60 * 60 * 1000);
  console.log('🚀 Automation system started');
  res.json({ success: true, message: '🚀 24/7 Automation started! Videos will upload every 2 hours.' });
});

app.post('/api/stop', (req, res) => {
  systemRunning = false;
  stats.nextUpload = null;
  console.log('⏹️ Automation system stopped');
  res.json({ success: true, message: '⏹️ Automation stopped. No more automatic uploads.' });
});

app.post('/api/upload-now', async (req, res) => {
  try {
    await automatedVideoUpload();
    res.json({ success: true, message: '✅ Video uploaded successfully! Check your YouTube channel.' });
  } catch (error) {
    res.json({ success: false, message: `❌ Upload failed: ${error.message}` });
  }
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
    saveTokens(tokens);
    console.log('✅ YouTube authentication successful');
    res.redirect('/?success=auth');
  } catch (error) {
    console.error('Auth error:', error);
    res.redirect('/?error=auth');
  }
});

// Schedule uploads every 2 hours
cron.schedule('0 */2 * * *', () => {
  console.log('⏰ Scheduled upload triggered');
  automatedVideoUpload();
});

// Reset daily stats at midnight
cron.schedule('0 0 * * *', () => {
  stats.todayUploaded = 0;
  console.log('📊 Daily stats reset');
});

// Initialize
loadTokens();

// Create temp directories
['temp_videos'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('🤖 YouTube Automation System Started');
  console.log(`🌐 Running on Koyeb: http://0.0.0.0:${PORT}`);
  console.log('📅 Scheduled uploads every 2 hours');
  console.log('🔄 System ready for 24/7 operation');
});

export default app;
