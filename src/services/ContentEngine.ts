import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import OpenAI from 'openai';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// --- EXPORTED INTERFACES ---
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

// --- VIDEO PRODUCTION RESULT INTERFACE (REQUIRED FOR AUTOMATION SCHEDULER) ---
// This MUST match the interface expected by AutomationScheduler
export interface VideoProductionResult {
  success: boolean;
  videoId?: string; // A unique ID for the produced video
  filePath?: string; // Path to the generated video file
  error?: string;    // Error message if success is false
}

// --- YOUTUBE CONTENT ENGINE CLASS ---
export class YouTubeContentEngine {
  private supabase: any;
  private youtube: any;
  private openai: OpenAI;
  private isRunning = false; // Not currently used for start/stop logic directly

  constructor() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error("Supabase credentials missing");
    if (!process.env.YOUTUBE_API_KEY) throw new Error("YouTube API key missing");
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI API key missing");

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
  // NOTE: This method does NOT take arguments as per your previous logs.
  async huntTrendingVideos(): Promise<TrendingVideo[]> {
    try {
      console.log('🔍 Hunting for trending videos...');
      
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics'],
        chart: 'mostPopular',
        regionCode: 'US', // You can change this to your target region
        maxResults: 50,
        videoCategoryId: '22', // People & Blogs category ID. Adjust if needed.
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
          category: video.snippet.categoryId // This is a category ID, not a name. Might need mapping.
        }));

      console.log(`📊 Found ${trendingVideos.length} trending videos with 500k+ views`);
      
      // Store in database for analysis
      await this.storeTrendingVideos(trendingVideos);
      
      return trendingVideos;
    } catch (error: any) {
      console.error('❌ Error hunting trending videos:', error.message);
      return [];
    }
  }

  // Analyze trending patterns and generate unique content scripts
  async analyzeAndGenerateContent(trendingVideos: TrendingVideo[]): Promise<VideoScript[]> {
    try {
      console.log('🤖 Analyzing trends and generating unique content...');
      
      const scripts: VideoScript[] = [];
      
      // Limit to processing the first 3 trending videos for script generation
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
        
        Return JSON format ONLY. Do not include any extra text before or after the JSON.
        The JSON structure should be:
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
              "duration": 8, // Duration in seconds
              "background_type": "image", // or "video" or "animation"
              "background_prompt": "AI image generation prompt for this segment's background"
            }
          ]
        }
        `;

        const completion = await this.openai.chat.completions.create({
          model: "gpt-4", // Or "gpt-4o" for newer capabilities
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8, // Higher temperature for more creativity
          max_tokens: 2000 // Adjust as needed
        });

        try {
          // Ensure the response content is treated as a string before parsing
          const responseContent = completion.choices[0]?.message?.content;
          if (!responseContent) {
            console.error('❌ OpenAI API returned no content for script generation.');
            continue; // Skip to the next video if no content
          }

          const scriptData: VideoScript = JSON.parse(responseContent);
          scripts.push(scriptData);
          console.log(`✅ Generated script: "${scriptData.title}"`);
          
          // Small delay to avoid hitting OpenAI rate limits
          await this.sleep(2000); // 2 seconds
        } catch (parseError: any) {
          console.error('❌ Error parsing AI response JSON:', parseError.message);
          console.log('Received response content:', completion.choices[0]?.message?.content); // Log the actual response
        }
      }
      
      return scripts;
    } catch (error: any) {
      console.error('❌ Error in analyzeAndGenerateContent:', error.message);
      return [];
    }
  }

  // Create actual video from script. THIS MUST RETURN VideoProductionResult
  async createVideo(script: VideoScript): Promise<VideoProductionResult> {
    try {
      console.log(`🎬 Creating video: "${script.title}"`);
      
      const videoId = uuidv4();
      // Use a temporary directory that's unique per video creation
      const tempDir = path.join(process.cwd(), 'temp', videoId);
      await fs.ensureDir(tempDir);

      // Generate voiceover using OpenAI TTS
      const audioPath = await this.generateVoiceover(script.script, tempDir);
      if (!audioPath) throw new Error("Failed to generate voiceover.");
      
      // Generate visual content for each segment
      const visualPaths: string[] = [];
      for (const segment of script.segments) {
        const visualPath = await this.generateVisual(segment, tempDir);
        if (visualPath) {
          visualPaths.push(visualPath);
        } else {
          console.warn(`⚠️ Could not generate visual for segment: ${segment.text}`);
        }
      }

      if (visualPaths.length === 0) {
        throw new Error("No visuals could be generated for the video.");
      }

      // Create thumbnail (currently static, can be enhanced)
      const thumbnailPath = await this.generateThumbnail(script.thumbnail_text, tempDir);

      // Assemble final video using FFmpeg
      const finalVideoPath = await this.assembleVideo(audioPath, visualPaths, tempDir, script);

      console.log(`✅ Video created successfully. Path: ${finalVideoPath}`);
      // Return the expected structure
      return { success: true, videoId: videoId, filePath: finalVideoPath };
      
    } catch (error: any) {
      console.error('❌ Error in createVideo:', error.message);
      // Return the expected error structure
      return { success: false, error: error.message };
    }
  }

  // Generate AI voiceover
  private async generateVoiceover(script: string, outputDir: string): Promise<string | null> {
    const audioPath = path.join(outputDir, 'voiceover.mp3');
    
    try {
      const mp3 = await this.openai.audio.speech.create({
        model: "tts-1-hd", // Use a high-quality model
        voice: "nova", // A good, clear voice for engagement. Experiment with others!
        input: script,
        speed: 1.1 // Slightly faster for YouTube retention.
      });

      // OpenAI returns an array buffer, convert it to a buffer
      const buffer = Buffer.from(await mp3.arrayBuffer());
      await fs.writeFile(audioPath, buffer);
      
      console.log('🔊 Voiceover generated:', audioPath);
      return audioPath;
    } catch (error: any) {
      console.error('❌ Error generating voiceover:', error.message);
      return null;
    }
  }

  // Generate visual content (image) using AI
  private async generateVisual(segment: any, outputDir: string): Promise<string | null> {
    try {
      if (segment.background_type === 'image' && segment.background_prompt) {
        console.log(`🎨 Generating visual for: "${segment.background_prompt}"`);
        const response = await this.openai.images.generate({
          model: "dall-e-3", // DALL-E 3 for higher quality
          prompt: `High-quality, engaging visual for a YouTube video segment: ${segment.background_prompt}. Style: vibrant, modern, suitable for vertical format. Focus on clarity and visual appeal.`,
          size: "1024x1792", // Vertical format (aspect ratio 9:16) suitable for Shorts/Reels
          quality: "hd", // High quality
          n: 1, // Generate one image
        });

        const imageUrl = response.data[0]?.url;
        if (!imageUrl) {
            console.error('❌ DALL-E 3 API returned no image URL.');
            return null;
        }

        const imagePath = path.join(outputDir, `visual_${Date.now()}.png`);
        
        // Download and save image
        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        await fs.writeFile(imagePath, imageResponse.data);
        
        // Resize and crop image to fit the video aspect ratio (1080x1920)
        const processedPath = path.join(outputDir, `processed_visual_${Date.now()}.png`);
        await sharp(imagePath)
          .resize(1080, 1920, { fit: 'cover', position: 'center' }) // Cover crops to fit, center positions it
          .png() // Save as PNG
          .toFile(processedPath);
        
        console.log('🖼️ Visual generated and processed:', processedPath);
        return processedPath;
      } else if (segment.background_type !== 'image') {
        console.warn(`⚠️ Unsupported background type: ${segment.background_type}. Skipping visual generation for this segment.`);
        return null;
      } else {
        console.warn(`⚠️ Missing background_prompt for image segment. Skipping visual generation.`);
        return null;
      }
    } catch (error: any) {
      console.error('❌ Error generating visual:', error.message);
      return null;
    }
  }

  // Generate eye-catching thumbnail (currently static, can be enhanced)
  private async generateThumbnail(text: string, outputDir: string): Promise<string> {
    const thumbnailPath = path.join(outputDir, 'thumbnail.png');
    
    try {
      // Basic thumbnail generation: a colored background with text overlay
      // You can enhance this using AI image generation for thumbnails too!
      await sharp({
        create: {
          width: 1280, // Standard thumbnail width
          height: 720, // Standard thumbnail height
          channels: 4,
          background: { r: 255, g: 100, b: 0, alpha: 1 } // Bright orange background
        }
      })
      .composite([
        {
          input: Buffer.from(
            `<svg><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="60">${text}</text></svg>`
          ),
          top: 0, // Adjust Y position as needed
          left: 0, // Adjust X position as needed
        },
      ])
      .png()
      .toFile(thumbnailPath);

      console.log('🖼️ Thumbnail generated:', thumbnailPath);
      return thumbnailPath;
    } catch (error: any) {
      console.error('❌ Error generating thumbnail:', error.message);
      // Return a default path or null if generation fails
      return path.join(__dirname, 'default_thumbnail.png'); // You might need a default thumbnail image
    }
  }

  // Assemble final video with FFmpeg
  private async assembleVideo(audioPath: string, visualPaths: string[], outputDir: string, script: VideoScript): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const outputPath = path.join(outputDir, 'final_video.mp4');
      
      let command = ffmpeg();
      
      // Add all visual inputs. Ensure they are in the correct order.
      visualPaths.forEach((visualPath, index) => {
        command = command.input(visualPath);
      });
      
      // Add audio input
      command = command.input(audioPath);
      
      // FFmpeg complex filtergraph for creating a slideshow and scaling
      // n=${visualPaths.length}:v=1:a=0 --> concat n inputs, 1 video stream, 0 audio streams
      // [slideshow] --> the output pad name of the concat filter
      // scale=1080:1920:force_original_aspect_ratio=decrease --> scales the video to fit within 1080x1920
      // pad=1080:1920:(ow-iw)/2:(oh-ih)/2 --> adds black bars if the aspect ratio doesn't match
      // [video] --> the final video output pad name
      command
        .complexFilter([
          `concat=n=${visualPaths.length}:v=1:a=0[slideshow]`,
          `[slideshow]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[video]`
        ])
        .outputOptions([
          '-map', '[video]', // Map the final video stream
          '-map', `${visualPaths.length}:a`, // Map the audio stream from the last input (audio is appended last)
          '-c:v', 'libx264', // Video codec
          '-preset', 'medium', // Encoding preset (faster for 'medium', better quality for 'slow'/'veryslow')
          '-crf', '23', // Constant Rate Factor (lower = better quality, higher = smaller file size). 18-28 is common.
          '-c:a', 'aac', // Audio codec
          '-b:a', '128k', // Audio bitrate
          '-r', '30', // Video frame rate
          '-shortest' // Finish encoding when the shortest input stream ends (usually audio)
        ])
        .output(outputPath)
        .on('progress', (progress) => {
          // Optional: Log progress
          // console.log(`Processing: ${progress.frames} frames processed.`);
        })
        .on('end', () => {
          console.log(`✅ Video assembly finished: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          console.error('❌ FFmpeg error during video assembly:', err.message);
          reject(err);
        })
        .run();
    });
  }

  // Upload to YouTube
  async uploadToYouTube(videoPath: string, script: VideoScript): Promise<boolean> {
    try {
      console.log(`📤 Uploading to YouTube: "${script.title}"`);
      
      if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REDIRECT_URI || !process.env.YOUTUBE_REFRESH_TOKEN) {
        throw new Error("Missing YouTube OAuth credentials in environment variables.");
      }

      const auth = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI
      );
      
      auth.setCredentials({
        refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
      });

      // Refresh token if expired (important for long-running processes)
      // This might require an async method to get a new access token if it's expired.
      // For simplicity, we assume the refresh token is valid.

      const youtube = google.youtube({ version: 'v3', auth });
      
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: script.title,
            description: script.description,
            tags: script.tags,
            categoryId: '22', // 'People & Blogs' category ID. Adjust if your content is different.
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en'
          },
          status: {
            privacyStatus: 'public', // Set to 'private' or 'unlisted' for testing
            selfDeclaredMadeForKids: false // Set to true if your content is for kids
          }
        },
        media: {
          // Use createReadStream for efficient file uploading
          body: fs.createReadStream(videoPath)
        }
      });

      const uploadedVideoId = response.data.id;
      console.log(`✅ Successfully uploaded to YouTube! Video ID: ${uploadedVideoId}`);
      
      // Log to database upon successful upload
      await this.logUpload(uploadedVideoId!, script);
      
      return true;
    } catch (error: any) {
      console.error('❌ Error uploading to YouTube:', error.message);
      // Log the detailed error if available
      if (error.response && error.response.data) {
          console.error('YouTube API Error Details:', JSON.stringify(error.response.data, null, 2));
      }
      return false;
    }
  }

  // Store trending videos in database for analysis
  private async storeTrendingVideos(videos: TrendingVideo[]): Promise<void> {
    try {
      if (!this.supabase) {
          console.error("Supabase client not initialized.");
          return;
      }
      // Use upsert to update existing records or insert new ones
      const { error } = await this.supabase
        .from('trending_videos')
        .upsert(videos.map(video => ({
          video_id: video.id, // Use video_id as the primary key for upsert
          title: video.title,
          views: video.views,
          channel_title: video.channelTitle,
          published_at: video.publishedAt,
          analyzed_at: new Date().toISOString(),
          data: video // Store the full video object for detailed analysis if needed
        })));

      if (error) console.error('Supabase DB error when storing trending videos:', error.message);
      else console.log(`Stored ${videos.length} trending videos in Supabase.`);
    } catch (error: any) {
      console.error('Error in storeTrendingVideos:', error.message);
    }
  }

  // Log successful uploads to the database
  private async logUpload(videoId: string, script: VideoScript): Promise<void> {
    try {
      if (!this.supabase) {
          console.error("Supabase client not initialized.");
          return;
      }
      await this.supabase
        .from('uploaded_videos')
        .insert({
          youtube_video_id: videoId,
          title: script.title,
          description: script.description,
          tags: script.tags,
          uploaded_at: new Date().toISOString(),
          script_data: script // Store the script used for this video
        });
      console.log(`Logged upload for YouTube video ID: ${videoId}`);
    } catch (error: any) {
      console.error('Error logging upload to Supabase:', error.message);
    }
  }

  // Helper method for delays (used to avoid rate limits)
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Placeholder for cleanup if needed (e.g., deleting temp files from failed runs)
  // The AutomationScheduler will call this.
  async cleanup(): Promise<void> {
      console.log("Running cleanup in ContentEngine (if applicable)...");
      // Add any specific cleanup logic for ContentEngine here if needed.
      // For example, deleting temp files if they are managed here.
  }
}
