// src/services/VideoProducer.ts

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
// Import necessary libraries for video creation
import ffmpeg from 'fluent-ffmpeg'; // Ensure installed: npm install fluent-ffmpeg @types/fluent-ffmpeg
import sharp from 'sharp';      // Ensure installed: npm install sharp @types/sharp
import axios from 'axios';      // Ensure installed: npm install axios @types/axios
import { OpenAI } from 'openai'; // Ensure installed: npm install openai

// Import necessary types
import { VideoScript } from './ContentEngine'; 
// Ensure these interfaces are exported from this file
export { VideoConfig, VideoProductionResult } from './videoProducer'; 

// --- INTERFACE FOR VIDEO CONFIG (WHAT createVideo EXPECTS) ---
export interface VideoConfig {
  title?: string; // Added title as it might be needed
  script: VideoScript; // Pass the whole script object
  niche: string;         
  duration: number;      
  resolution: '1080p' | '720p' | '4k'; 
  style: string;         
}

// --- VIDEO PRODUCTION RESULT INTERFACE (MUST BE EXPORTED) ---
export interface VideoProductionResult {
  success: boolean;
  videoId?: string; 
  filePath?: string; 
  error?: string;    
}

// --- VIDEO PRODUCER CLASS ---
export class VideoProducer {
  private openai: OpenAI; // OpenAI client for TTS and images

  constructor() {
    // Initialize OpenAI client
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key is missing.");
    }
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Configure FFmpeg path if needed
    if (process.env.FFMPEG_PATH) {
      ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
    }
  }

  // --- ACTUAL VIDEO CREATION LOGIC ---
  async createVideo(config: VideoConfig): Promise<VideoProductionResult> {
    const videoId = uuidv4();
    const tempDir = path.join(process.cwd(), 'temp_producer', videoId);
    await fs.ensureDir(tempDir);

    try {
        logger.info(`🎬 VideoProducer: Creating video for niche "${config.niche}" with style "${config.style}"...`);
        
        // 1. Generate Voiceover
        const audioPath = await this.generateVoiceoverFromScript(config.script.script, tempDir); 
        if (!audioPath) throw new Error("Voiceover generation failed.");
        logger.info("Voiceover generated.");

        // 2. Generate Visuals for each segment
        const visualPaths: string[] = [];
        for (const segment of config.script.segments) {
            let visualPath: string | null = null;
            if (segment.background_type === 'image' && segment.background_prompt) {
                // Use the resolution from config, default to 1080p if not provided
                visualPath = await this.generateImageVisual(segment.background_prompt, tempDir, config.resolution || '1080p'); 
            } else if (segment.background_type === 'video') {
                // Implement fetching or generating video clips if needed
                visualPath = await this.fetchOrGenerateVideoClip(segment.background_prompt, tempDir); 
            } else {
                 logger.warn(`Unsupported background type '${segment.background_type}' for segment: ${segment.text}`);
            }
            
            if (visualPath) {
                visualPaths.push(visualPath);
            } else {
                logger.warn(`Failed to get visual for segment: ${segment.text}. Skipping.`);
            }
        }
        if (visualPaths.length === 0) throw new Error("No visuals were generated for the video.");
        logger.info(`${visualPaths.length} visuals generated.`);

        // 3. Generate Thumbnail
        const thumbnailPath = await this.generateThumbnail(config.script.thumbnail_text, tempDir);
        logger.info("Thumbnail generated.");

        // 4. Assemble Video with FFmpeg
        const finalVideoPath = await this.assembleVideoWithFFmpeg(audioPath, visualPaths, thumbnailPath, tempDir, config);
        logger.info(`Video assembled: ${finalVideoPath}`);

        return { success: true, videoId: videoId, filePath: finalVideoPath };

    } catch (error: any) {
        logger.error('❌ VideoProducer: Error during video creation:', error.message);
        await this.cleanupTempDir(tempDir); // Clean up temporary files on error
        return { success: false, error: error.message };
    }
  }

  // Helper to generate voiceover
  private async generateVoiceoverFromScript(script: string, outputDir: string): Promise<string | null> {
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
      return audioPath;
    } catch (error: any) {
      logger.error("Failed to generate voiceover:", error.message);
      return null;
    }
  }

  // Helper to generate image visual
  private async generateImageVisual(prompt: string, outputDir: string, resolution: string): Promise<string | null> {
    try {
      const size = resolution === '1080p' ? '1024x1792' : '1024x1792'; // DALL-E 3 size for 9:16 aspect ratio
      
      const response = await this.openai.images.generate({
        model: "dall-e-3", 
        prompt: `YouTube video visual: ${prompt}. Vibrant, modern style, vertical format.`,
        size: size as any, 
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
      
      // Resize to match video resolution (1080x1920 for vertical)
      const finalVisualPath = path.join(outputDir, `processed_visual_${Date.now()}.png`);
      await sharp(imagePath)
        .resize(1080, 1920, { fit: 'cover', position: 'center' }) 
        .png() 
        .toFile(finalVisualPath);
      
      return finalVisualPath;
    } catch (error: any) {
      logger.error('Error generating image visual:', error.message);
      return null;
    }
  }

  // Placeholder for fetching or generating video clips
  private async fetchOrGenerateVideoClip(prompt: string, outputDir: string): Promise<string | null> {
    logger.warn("fetchOrGenerateVideoClip not implemented. Skipping video clip generation.");
    return null; 
  }

  // Helper to generate thumbnail
  private async generateThumbnail(text: string, outputDir: string): Promise<string> {
    const thumbnailPath = path.join(outputDir, 'thumbnail.png');
    try {
      await sharp({
        create: {
          width: 1280, height: 720, channels: 4, background: { r: 255, g: 100, b: 0, alpha: 1 }
        }
      })
      .composite([{
          input: Buffer.from(
            `<svg width="1280" height="720"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="60" font-family="Arial">${text}</text></svg>`
          ), top: 0, left: 0, 
        },
      ])
      .png()
      .toFile(thumbnailPath);
      return thumbnailPath;
    } catch (error: any) {
      logger.error('Error generating thumbnail:', error.message);
      return path.join(__dirname, 'default_thumbnail.png'); // Fallback thumbnail
    }
  }

  // Helper to assemble video using FFmpeg
  private async assembleVideoWithFFmpeg(audioPath: string, visualPaths: string[], thumbnailPath: string, outputDir: string, config: VideoConfig): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const outputPath = path.join(outputDir, `final_video_${uuidv4()}.mp4`);
      
      let command = ffmpeg();
      
      visualPaths.forEach((visualPath, index) => {
        command = command.input(visualPath);
      });
      
      command = command.input(audioPath);
      
      // FFmpeg complex filtergraph
      command
        .complexFilter([
          `concat=n=${visualPaths.length}:v=1:a=0[slideshow]`, // Concatenate visuals
          `[slideshow]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[video]` // Scale and pad to 1080x1920
        ])
        .outputOptions([
          '-map', '[video]', 
          `-map ${visualPaths.length}:a`, 
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
          // logger.debug(`FFmpeg progress: ${progress.frames} frames processed.`);
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

  // Cleanup method for temporary directory
  private async cleanupTempDir(dirPath: string): Promise<void> {
    try {
      if (await fs.pathExists(dirPath)) {
        await fs.remove(dirPath);
        logger.info(`Cleaned up temporary directory: ${dirPath}`);
      }
    } catch (error: any) {
      logger.error('Error cleaning up temporary directory:', error.message);
    }
  }

  // Cleanup for the producer's own temp files
  async cleanup(): Promise<void> {
    logger.info("VideoProducer: Cleaning up its own temporary directories...");
    await this.cleanupTempDir(path.join(process.cwd(), 'temp_producer')); // Clean base temp dir for producer
  }
}
