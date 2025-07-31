import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import OpenAI from 'openai';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export interface TrendingVideo {
  id: string;
  title: string;
  description: string;
  views: number;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  tags: string[];
  category: string;
}

export interface VideoScript {
  title: string;
  description: string;
  script: string;
  tags: string[];
  thumbnail_text: string;
  hook: string;
  segments: Array<{
    text: string;
    duration: number;
    background_type: 'image' | 'video' | 'animation';
    background_prompt?: string;
  }>;
}

export class YouTubeContentEngine {
  private supabase: any;
  private youtube: any;
  private openai: OpenAI;
  private isRunning = false;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!
    );
    
    this.youtube = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY
    });

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  // Hunt for trending videos with 500k+ views
  async huntTrendingVideos(): Promise<TrendingVideo[]> {
    try {
      console.log('🔍 Hunting for trending videos...');
      
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics'],
        chart: 'mostPopular',
        regionCode: 'US',
        maxResults: 50,
        videoCategoryId: '22', // People & Blogs category
      });

      const trendingVideos: TrendingVideo[] = response.data.items
        .filter((video: any) => parseInt(video.statistics.viewCount) >= 500000)
        .map((video: any) => ({
          id: video.id,
          title: video.snippet.title,
          description: video.snippet.description,
          views: parseInt(video.statistics.viewCount),
          channelTitle: video.snippet.channelTitle,
          publishedAt: video.snippet.publishedAt,
          thumbnailUrl: video.snippet.thumbnails.maxres?.url || video.snippet.thumbnails.high.url,
          tags: video.snippet.tags || [],
          category: video.snippet.categoryId
        }));

      console.log(`📊 Found ${trendingVideos.length} trending videos with 500k+ views`);
      
      // Store in database for analysis
      await this.storeTrendingVideos(trendingVideos);
      
      return trendingVideos;
    } catch (error) {
      console.error('❌ Error hunting trending videos:', error);
      return [];
    }
  }

  // Analyze trending patterns and generate unique content
  async analyzeAndGenerateContent(trendingVideos: TrendingVideo[]): Promise<VideoScript[]> {
    try {
      console.log('🤖 Analyzing trends and generating unique content...');
      
      const scripts: VideoScript[] = [];
      
      for (let i = 0; i < Math.min(3, trendingVideos.length); i++) {
        const video = trendingVideos[i];
        
        const prompt = `
        Analyze this trending YouTube video and create a COMPLETELY UNIQUE video script inspired by its success:
        
        Title: ${video.title}
        Views: ${video.views.toLocaleString()}
        Description: ${video.description.substring(0, 500)}
        Tags: ${video.tags.join(', ')}
        
        Create a unique video script that:
        1. Uses similar trending topics but with a fresh angle
        2. Has an attention-grabbing hook in first 3 seconds
        3. Is 60-90 seconds long for maximum engagement
        4. Includes 8-12 segments with specific visuals
        5. Has trending hashtags and SEO-optimized title
        6. Is completely original content, not copying
        
        Return JSON format:
        {
          "title": "Viral title with trending keywords",
          "description": "SEO optimized description with hashtags",
          "script": "Full narration script",
          "tags": ["trending", "keywords"],
          "thumbnail_text": "Eye-catching thumbnail text",
          "hook": "First 3-second hook line",
          "segments": [
            {
              "text": "Narration for this segment",
              "duration": 8,
              "background_type": "image",
              "background_prompt": "AI image generation prompt"
            }
          ]
        }
        `;

        const completion = await this.openai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
          max_tokens: 2000
        });

        try {
          const scriptData = JSON.parse(completion.choices[0].message.content!);
          scripts.push(scriptData);
          console.log(`✅ Generated script: "${scriptData.title}"`);
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (parseError) {
          console.error('❌ Error parsing AI response:', parseError);
        }
      }
      
      return scripts;
    } catch (error) {
      console.error('❌ Error generating content:', error);
      return [];
    }
  }

  // Create actual video from script
  async createVideo(script: VideoScript): Promise<string | null> {
    try {
      console.log(`🎬 Creating video: "${script.title}"`);
      
      const videoId = uuidv4();
      const tempDir = path.join(process.cwd(), 'temp', videoId);
      await fs.ensureDir(tempDir);

      // Generate voiceover using OpenAI TTS
      const audioPath = await this.generateVoiceover(script.script, tempDir);
      
      // Generate visual content for each segment
      const visualPaths: string[] = [];
      for (const segment of script.segments) {
        const visualPath = await this.generateVisual(segment, tempDir);
        if (visualPath) visualPaths.push(visualPath);
      }

      // Create thumbnail
      const thumbnailPath = await this.generateThumbnail(script.thumbnail_text, tempDir);

      // Combine everything into final video
      const finalVideoPath = await this.assembleVideo(audioPath, visualPaths, tempDir, script);

      console.log(`✅ Video created successfully: ${finalVideoPath}`);
      return finalVideoPath;
      
    } catch (error) {
      console.error('❌ Error creating video:', error);
      return null;
    }
  }

  // Generate AI voiceover
  private async generateVoiceover(script: string, outputDir: string): Promise<string> {
    const audioPath = path.join(outputDir, 'voiceover.mp3');
    
    const mp3 = await this.openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "nova", // Female voice - good for engagement
      input: script,
      speed: 1.1 // Slightly faster for YouTube retention
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.writeFile(audioPath, buffer);
    
    return audioPath;
  }

  // Generate visual content using AI
  private async generateVisual(segment: any, outputDir: string): Promise<string | null> {
    try {
      if (segment.background_type === 'image') {
        const response = await this.openai.images.generate({
          model: "dall-e-3",
          prompt: `High-quality, engaging visual: ${segment.background_prompt}. Bright colors, modern style, perfect for social media content.`,
          size: "1024x1792", // Vertical format for mobile
          quality: "hd",
          n: 1,
        });

        const imageUrl = response.data[0].url!;
        const imagePath = path.join(outputDir, `visual_${Date.now()}.png`);
        
        // Download and save image
        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        await fs.writeFile(imagePath, imageResponse.data);
        
        // Resize for video format (1080x1920 for vertical video)
        const processedPath = path.join(outputDir, `processed_${Date.now()}.png`);
        await sharp(imagePath)
          .resize(1080, 1920, { fit: 'cover', position: 'center' })
          .png()
          .toFile(processedPath);
        
        return processedPath;
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error generating visual:', error);
      return null;
    }
  }

  // Generate eye-catching thumbnail
  private async generateThumbnail(text: string, outputDir: string): Promise<string> {
    const thumbnailPath = path.join(outputDir, 'thumbnail.png');
    
    // Create thumbnail with text overlay
    const thumbnail = sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 4,
        background: { r: 255, g: 0, b: 100, alpha: 1 } // Bright background
      }
    })
    .png()
    .toFile(thumbnailPath);

    return thumbnailPath;
  }

  // Assemble final video with FFmpeg
  private async assembleVideo(audioPath: string, visualPaths: string[], outputDir: string, script: VideoScript): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(outputDir, 'final_video.mp4');
      
      let command = ffmpeg();
      
      // Add all visual inputs
      visualPaths.forEach(visualPath => {
        command = command.input(visualPath);
      });
      
      // Add audio
      command = command.input(audioPath);
      
      // Video processing for YouTube optimization
      command
        .complexFilter([
          // Create slideshow from images
          `concat=n=${visualPaths.length}:v=1:a=0[slideshow]`,
          // Scale to 1080p
          '[slideshow]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[video]'
        ])
        .outputOptions([
          '-map', '[video]',
          '-map', `${visualPaths.length}:a`, // Audio from last input
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-r', '30', // 30 FPS
          '-shortest'
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }

  // Upload to YouTube
  async uploadToYouTube(videoPath: string, script: VideoScript): Promise<boolean> {
    try {
      console.log(`📤 Uploading to YouTube: "${script.title}"`);
      
      const auth = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI
      );
      
      auth.setCredentials({
        refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
      });

      const youtube = google.youtube({ version: 'v3', auth });
      
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: script.title,
            description: script.description,
            tags: script.tags,
            categoryId: '22', // People & Blogs
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en'
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false
          }
        },
        media: {
          body: fs.createReadStream(videoPath)
        }
      });

      console.log(`✅ Successfully uploaded! Video ID: ${response.data.id}`);
      
      // Log to database
      await this.logUpload(response.data.id!, script);
      
      return true;
    } catch (error) {
      console.error('❌ Error uploading to YouTube:', error);
      return false;
    }
  }

  // Store trending videos in database
  private async storeTrendingVideos(videos: TrendingVideo[]): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('trending_videos')
        .upsert(videos.map(video => ({
          video_id: video.id,
          title: video.title,
          views: video.views,
          channel_title: video.channelTitle,
          published_at: video.publishedAt,
          analyzed_at: new Date().toISOString(),
          data: video
        })));

      if (error) console.error('Database error:', error);
    } catch (error) {
      console.error('Error storing trending videos:', error);
    }
  }

  // Log successful uploads
  private async logUpload(videoId: string, script: VideoScript): Promise<void> {
    try {
      await this.supabase
        .from('uploaded_videos')
        .insert({
          youtube_video_id: videoId,
          title: script.title,
          description: script.description,
          tags: script.tags,
          uploaded_at: new Date().toISOString(),
          script_data: script
        });
    } catch (error) {
      console.error('Error logging upload:', error);
    }
  }

  // Main automation loop - runs 24/7
  async startAutomation(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Automation already running!');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting 24/7 YouTube automation...');

    while (this.isRunning) {
      try {
        console.log(`\n🔄 Starting new automation cycle at ${new Date().toISOString()}`);
        
        // Step 1: Hunt trending videos
        const trendingVideos = await this.huntTrendingVideos();
        
        if (trendingVideos.length === 0) {
          console.log('⏳ No trending videos found, waiting 30 minutes...');
          await this.sleep(30 * 60 * 1000); // 30 minutes
          continue;
        }

        // Step 2: Generate unique content scripts
        const scripts = await this.analyzeAndGenerateContent(trendingVideos);
        
        // Step 3: Create and upload videos
        for (const script of scripts) {
          if (!this.isRunning) break;
          
          console.log(`\n🎯 Processing: "${script.title}"`);
          
          // Create video
          const videoPath = await this.createVideo(script);
          if (!videoPath) continue;
          
          // Upload to YouTube
          const uploaded = await this.uploadToYouTube(videoPath, script);
          
          if (uploaded) {
            console.log(`✅ Successfully automated upload: "${script.title}"`);
            
            // Clean up temporary files
            await fs.remove(path.dirname(videoPath));
            
            // Wait 2 hours between uploads to avoid spam detection
            console.log('⏳ Waiting 2 hours before next upload...');
            await this.sleep(2 * 60 * 60 * 1000); // 2 hours
          } else {
            console.log('❌ Upload failed, retrying in 1 hour...');
            await this.sleep(60 * 60 * 1000); // 1 hour
          }
        }
        
        // Wait 6 hours before hunting for new trending videos
        console.log('⏳ Cycle complete. Waiting 6 hours for next trend analysis...');
        await this.sleep(6 * 60 * 60 * 1000); // 6 hours
        
      } catch (error) {
        console.error('❌ Error in automation cycle:', error);
        console.log('⏳ Waiting 1 hour before retry...');
        await this.sleep(60 * 60 * 1000); // 1 hour
      }
    }
  }

  // Stop automation
  stopAutomation(): void {
    console.log('🛑 Stopping automation...');
    this.isRunning = false;
  }

  // Helper method for delays
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get automation status
  getStatus(): { isRunning: boolean; startedAt?: Date } {
    return {
      isRunning: this.isRunning,
      startedAt: this.isRunning ? new Date() : undefined
    };
  }
}
