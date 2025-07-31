// src/services/ContentEngine.ts

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import OpenAI from 'openai';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// --- IMPORT NECESSARY TYPES FOR SUPABASE AND OTHER LIBS ---
// Adjust path if necessary
import supabase, { SupabaseClient } from '../config/database'; 
// Assuming logger is available globally or imported similarly
import { logger } from '../utils/logger'; 

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
  category: string; // Category ID, potentially needs mapping to names
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

// --- VIDEO PRODUCTION RESULT INTERFACE ---
// This MUST match the interface exported by VideoProducer.ts
export interface VideoProductionResult {
  success: boolean;
  videoId?: string;
  filePath?: string;
  error?: string;
}

// --- YOUTUBE CONTENT ENGINE CLASS ---
export class YouTubeContentEngine {
  private supabaseClient: SupabaseClient | null = null; // Use the imported type
  private youtube: any;
  private openai: OpenAI;
  // private isRunning = false; // Property not used for current logic

  constructor() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        logger.error("Supabase credentials missing in ContentEngine constructor.");
    } else {
        this.supabaseClient = supabase; // Use the imported client
    }
    
    if (!process.env.YOUTUBE_API_KEY) throw new Error("YouTube API key missing");
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI API key missing");

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
      logger.info('🔍 Hunting for trending videos...');
      
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics'],
        chart: 'mostPopular',
        regionCode: 'US', // Adjust as needed
        maxResults: 50,
        videoCategoryId: '22', // 'People & Blogs'. Adjust if your content is different.
      });

      // Safely access items using optional chaining
      const videosData = response.data?.items;
      if (!videosData) {
          logger.warn("YouTube API response did not contain video items.");
          return [];
      }

      const trendingVideos: TrendingVideo[] = videosData
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
          category: video.snippet.categoryId // This is a category ID
        }));

      logger.info(`📊 Found ${trendingVideos.length} trending videos with 500k+ views.`);
      
      // Store in database for analysis
      await this.storeTrendingVideos(trendingVideos);
      
      return trendingVideos;
    } catch (error: any) {
      logger.error('❌ Error hunting trending videos:', error.message);
      return [];
    }
  }

  // Analyze trending patterns and generate unique content scripts
  async analyzeAndGenerateContent(trendingVideos: TrendingVideo[]): Promise<VideoScript[]> {
    try {
      logger.info('🤖 Analyzing trends and generating unique content...');
      
      const scripts: VideoScript[] = [];
      
      // Process up to 3 trending videos for script generation
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
              "duration": 8,
              "background_type": "image",
              "background_prompt": "AI image generation prompt"
            }
          ]
        }
        `;

        const completion = await this.openai.chat.completions.create({
          model: "gpt-4o", // Using the latest model
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8, 
          max_tokens: 2000
        });

        const responseContent = completion.choices[0]?.message?.content;
        if (!responseContent) {
          logger.error('OpenAI API returned no content for script generation.');
          continue; 
        }

        try {
          const scriptData: VideoScript = JSON.parse(responseContent);
          scripts.push(scriptData);
          logger.info(`✅ Generated script: "${scriptData.title}"`);
          await this.sleep(2000); // 2-second delay between AI calls
        } catch (parseError: any) {
          logger.error('Error parsing AI response JSON:', parseError.message);
          logger.debug('Received response content:', responseContent); // Log content for debugging
        }
      }
      
      return scripts;
    } catch (error: any) {
      logger.error('Error in analyzeAndGenerateContent:', error.message);
      return [];
    }
  }

  // Create actual video from script. MUST RETURN VideoProductionResult
  async createVideo(script: VideoScript): Promise<VideoProductionResult> {
    try {
      logger.info(`🎬 Creating video: "${script.title}"`);
      
      const videoId = uuidv4();
      const tempDir = path.join(process.cwd(), 'temp', videoId);
      await fs.ensureDir(tempDir);

      const audioPath = await this.generateVoiceover(script.script, tempDir);
      if (!audioPath) throw new Error("Failed to generate voiceover.");
      
      const visualPaths: string[] = [];
      for (const segment of script.segments) {
        const visualPath = await this.generateVisual(segment, tempDir);
        if (visualPath) visualPaths.push(visualPath);
        else logger.warn(`Could not generate visual for segment: ${segment.text}`);
      }

      if (visualPaths.length === 0) throw new Error("No visuals could be generated for the video.");

      const thumbnailPath = await this.generateThumbnail(script.thumbnail_text, tempDir);

      const finalVideoPath = await this.assembleVideo(audioPath, visualPaths, tempDir, script);

      logger.info(`✅ Video created successfully. Path: ${finalVideoPath}`);
      return { success: true, videoId: videoId, filePath: finalVideoPath };
      
    } catch (error: any) {
      logger.error('❌ Error in createVideo:', error.message);
      return { success: false, error: error.message };
    }
  }

  private async generateVoiceover(script: string, outputDir: string): Promise<string | null> {
    const audioPath = path.join(outputDir, 'voiceover.mp3');
    
    try {
      const mp3 = await this.openai.audio.speech.create({
        model: "tts-1-hd", 
        voice: "nova", 
        input: script,
        speed: 1.1 
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      await fs.writeFile(audioPath, buffer);
      
      logger.info('🔊 Voiceover generated.');
      return audioPath;
    } catch (error: any) {
      logger.error('Error generating voiceover:', error.message);
      return null;
    }
  }

  private async generateVisual(segment: any, outputDir: string): Promise<string | null> {
    try {
      if (segment.background_type === 'image' && segment.background_prompt) {
        logger.info(`🎨 Generating visual for: "${segment.background_prompt}"`);
        const response = await this.openai.images.generate({
          model: "dall-e-3", 
          prompt: `High-quality, engaging visual for a YouTube video segment: ${segment.background_prompt}. Style: vibrant, modern, suitable for vertical format. Focus on clarity and visual appeal.`,
          size: "1024x1792", // Vertical format (9:16 aspect ratio)
          quality: "hd", 
          n: 1, 
        });

        const imageUrl = response.data[0]?.url;
        if (!imageUrl) {
            logger.error('DALL-E 3 API returned no image URL.');
            return null;
        }

        const imagePath = path.join(outputDir, `visual_${Date.now()}.png`);
        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        await fs.writeFile(imagePath, imageResponse.data);
        
        const processedPath = path.join(outputDir, `processed_visual_${Date.now()}.png`);
        await sharp(imagePath)
          .resize(1080, 1920, { fit: 'cover', position: 'center' }) // Fit to 1080x1920 vertical video
          .png() 
          .toFile(processedPath);
        
        logger.info('🖼️ Visual generated and processed.');
        return processedPath;
      } else if (segment.background_type !== 'image') {
        logger.warn(`Unsupported background type: ${segment.background_type}. Skipping visual generation.`);
        return null;
      } else {
        logger.warn(`Missing background_prompt for image segment. Skipping visual generation.`);
        return null;
      }
    } catch (error: any) {
      logger.error('Error generating visual:', error.message);
      return null;
    }
  }

  private async generateThumbnail(text: string, outputDir: string): Promise<string> {
    const thumbnailPath = path.join(outputDir, 'thumbnail.png');
    
    try {
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
            `<svg width="1280" height="720"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="60" font-family="Arial">${text}</text></svg>`
          ),
          top: 0, 
          left: 0, 
        },
      ])
      .png()
      .toFile(thumbnailPath);

      logger.info('🖼️ Thumbnail generated.');
      return thumbnailPath;
    } catch (error: any) {
      logger.error('Error generating thumbnail:', error.message);
      return path.join(__dirname, 'default_thumbnail.png'); // Fallback to a default thumbnail if needed
    }
  }

  private async assembleVideo(audioPath: string, visualPaths: string[], outputDir: string, script: VideoScript): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const outputPath = path.join(outputDir, 'final_video.mp4');
      
      let command = ffmpeg();
      
      visualPaths.forEach((visualPath, index) => {
        command = command.input(visualPath);
      });
      
      command = command.input(audioPath);
      
      command
        .complexFilter([
          `concat=n=${visualPaths.length}:v=1:a=0[slideshow]`,
          `[slideshow]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[video]`
        ])
        .outputOptions([
          '-map', '[video]', 
          `-map ${visualPaths.length}:a`, // Map audio from the last input
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23', 
          '-c:a', 'aac',
          '-b:a', '128k', 
          '-r', '30', 
          '-shortest' 
        ])
        .output(outputPath)
        .on('progress', (progress) => {
          // Optional: log progress
        })
        .on('end', () => {
          logger.info(`✅ Video assembly finished: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          logger.error(`FFmpeg error during video assembly: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  async uploadToYouTube(videoPath: string, script: VideoScript): Promise<boolean> {
    try {
      logger.info(`📤 Uploading to YouTube: "${script.title}"`);
      
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

      const youtube = google.youtube({ version: 'v3', auth });
      
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: script.title,
            description: script.description,
            tags: script.tags,
            categoryId: '22', // 'People & Blogs'. Adjust as needed.
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en'
          },
          status: {
            privacyStatus: 'public', // Set to 'private' or 'unlisted' for testing
            selfDeclaredMadeForKids: false // Set according to your content's nature
          }
        },
        media: {
          body: fs.createReadStream(videoPath)
        }
      });

      const uploadedVideoId = response.data.id;
      logger.info(`✅ Successfully uploaded to YouTube! Video ID: ${uploadedVideoId}`);
      
      await this.logUpload(uploadedVideoId!, script);
      
      return true;
    } catch (error: any) {
      logger.error('Error uploading to YouTube:', error.message);
      if (error.response && error.response.data) {
          logger.error('YouTube API Error Details:', JSON.stringify(error.response.data, null, 2));
      }
      return false;
    }
  }

  private async storeTrendingVideos(videos: TrendingVideo[]): Promise<void> {
    try {
      if (!this.supabaseClient) {
          logger.error("Supabase client not initialized in ContentEngine. Cannot store trending videos.");
          return;
      }
      const { error } = await this.supabaseClient
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

      if (error) logger.error('Supabase DB error storing trending videos:', error.message);
      else logger.info(`Stored ${videos.length} trending videos in Supabase.`);
    } catch (error: any) {
      logger.error('Error in storeTrendingVideos:', error.message);
    }
  }

  private async logUpload(videoId: string, script: VideoScript): Promise<void> {
    try {
      if (!this.supabaseClient) {
          logger.error("Supabase client not initialized in ContentEngine. Cannot log upload.");
          return;
      }
      await this.supabaseClient
        .from('uploaded_videos')
        .insert({
          youtube_video_id: videoId,
          title: script.title,
          description: script.description,
          tags: script.tags,
          uploaded_at: new Date().toISOString(),
          script_data: script 
        });
      logger.info(`Logged upload for YouTube video ID: ${videoId}`);
    } catch (error: any) {
      logger.error('Error logging upload to Supabase:', error.message);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup(): Promise<void> {
      logger.info("Running cleanup in ContentEngine...");
      // Example: Clean up temporary files if managed by ContentEngine
      // You might iterate through temp directories and remove them.
  }
}
