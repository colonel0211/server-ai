// src/services/VideoProducer.ts (Focusing on the createVideo method implementation)

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg'; // Make sure you install this: npm install fluent-ffmpeg @types/fluent-ffmpeg
import sharp from 'sharp';      // Make sure you install this: npm install sharp @types/sharp
import { OpenAI } from 'openai'; // Assuming you'll use OpenAI for TTS and images here too

// Import necessary types
import { VideoScript } from './ContentEngine'; 
import { VideoConfig, VideoProductionResult } from './videoProducer'; // These should be exported from this file

// Import logger
import { logger } from '../utils/logger'; 

// --- VIDEO CREATION LOGIC IMPLEMENTATION ---

// You'll need to initialize OpenAI client here if not using it globally from ContentEngine
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async createVideo(config: VideoConfig): Promise<VideoProductionResult> {
    const videoId = uuidv4();
    const tempDir = path.join(process.cwd(), 'temp_producer', videoId);
    await fs.ensureDir(tempDir);

    try {
        // --- 1. Generate Voiceover ---
        // You can either reuse the logic from ContentEngine or reimplement it here.
        // If you reimplement, ensure it returns the path to the audio file.
        // For now, let's assume ContentEngine has a way to provide audio path.
        // Or better, refactor generateVoiceover into a reusable utility.
        
        // Placeholder for voiceover generation:
        const audioPath = await this.generateVoiceoverFromScript(config.script, tempDir); // Implement this helper
        if (!audioPath) throw new Error("Voiceover generation failed.");
        logger.info("Voiceover generated.");

        // --- 2. Generate Visuals ---
        // You'll need to process each segment in the script.
        const visualPaths: string[] = [];
        for (const segment of config.script.segments) { // Assuming script is passed via config or accessible
            let visualPath: string | null = null;
            if (segment.background_type === 'image' && segment.background_prompt) {
                visualPath = await this.generateImageVisual(segment.background_prompt, tempDir, config.resolution); // Implement this helper
            } else if (segment.background_type === 'video') {
                // Logic for fetching/generating video clip
                visualPath = await this.fetchOrGenerateVideoClip(segment.background_prompt, tempDir); // Implement this helper
            }
            // Handle 'animation' type if needed
            
            if (visualPath) {
                visualPaths.push(visualPath);
            } else {
                logger.warn(`Failed to get visual for segment: ${segment.text}.`);
            }
        }
        if (visualPaths.length === 0) throw new Error("No visuals generated.");
        logger.info(`${visualPaths.length} visuals generated.`);

        // --- 3. Generate Thumbnail ---
        const thumbnailPath = await this.generateThumbnail(config.script.thumbnail_text, tempDir); // Implement this helper
        logger.info("Thumbnail generated.");

        // --- 4. Assemble Video with FFmpeg ---
        // This is where your FFmpeg logic comes in.
        const finalVideoPath = await this.assembleVideoWithFFmpeg(audioPath, visualPaths, thumbnailPath, tempDir, config); // Implement this
        logger.info(`Video assembled: ${finalVideoPath}`);

        return { success: true, videoId: videoId, filePath: finalVideoPath };

    } catch (error: any) {
        logger.error('❌ VideoProducer: Error during video creation:', error.message);
        // Clean up partial files if an error occurred
        await this.cleanupTempDir(tempDir);
        return { success: false, error: error.message };
    }
}

// --- HELPER METHODS TO IMPLEMENT ---

// Implement this to generate voiceover using OpenAI TTS or another service
async generateVoiceoverFromScript(script: string, outputDir: string): Promise<string | null> {
    // Reuse logic from ContentEngine or implement here using OpenAI TTS
    // Example using OpenAI (ensure you have client initialized):
    try {
        const audioPath = path.join(outputDir, 'voiceover.mp3');
        const mp3 = await this.openai.audio.speech.create({ // Assuming openai client is available
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

// Implement this to generate a single image visual using DALL-E or another service
async generateImageVisual(prompt: string, outputDir: string, resolution: string): Promise<string | null> {
    // Reuse logic from ContentEngine or implement here using DALL-E
    // Example using DALL-E 3 and resizing:
    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // Ensure client is initialized
        const size = resolution === '1080p' ? '1080x1792' : '1024x1792'; // Adjust sizes for 9:16 aspect ratio
        
        const response = await openai.images.generate({
            model: "dall-e-3", 
            prompt: `YouTube video visual: ${prompt}. Vibrant, modern style, vertical format.`,
            size: size as any, // Type assertion might be needed if size options don't match exactly
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
        
        // Resize to match video resolution (e.g., 1080x1920)
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

// Implement this if you need to fetch or generate video clips for segments
async fetchOrGenerateVideoClip(prompt: string, outputDir: string): Promise<string | null> {
    logger.warn("fetchOrGenerateVideoClip not implemented. Skipping video clip generation.");
    return null; // Placeholder
}

// Implement this to generate a thumbnail, potentially using AI or text overlay
async generateThumbnail(text: string, outputDir: string): Promise<string> {
    const thumbnailPath = path.join(outputDir, 'thumbnail.png');
    // Use Sharp to create a basic thumbnail with text
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
        return path.join(__dirname, 'default_thumbnail.png'); // Fallback
    }
}

// Implement this using FFmpeg to combine audio, visuals, and thumbnail
async assembleVideoWithFFmpeg(audioPath: string, visualPaths: string[], thumbnailPath: string, outputDir: string, config: VideoConfig): Promise<string> {
    return new Promise(async (resolve, reject) => {
        const outputPath = path.join(outputDir, `final_video_${uuidv4()}.mp4`);
        
        let command = ffmpeg();
        
        // Add all visual inputs
        visualPaths.forEach((visualPath, index) => {
            command = command.input(visualPath);
        });
        
        // Add audio input
        command = command.input(audioPath);
        
        // Construct the complex filtergraph.
        // n=${visualPaths.length}:v=1:a=0 --> concat N inputs, 1 video stream, 0 audio streams.
        // [slideshow] is the output pad of concat.
        // scale=1080:1920:force_original_aspect_ratio=decrease --> scale to fit within 1080x1920.
        // pad=1080:1920:(ow-iw)/2:(oh-ih)/2 --> add black bars if aspect ratio differs.
        // [video] is the final video pad.
        command
            .complexFilter([
                `concat=n=${visualPaths.length}:v=1:a=0[slideshow]`,
                `[slideshow]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[video]`
            ])
            .outputOptions([
                '-map', '[video]', // Map the final video stream
                `-map ${visualPaths.length}:a`, // Map the audio stream from the last input (audio is appended last)
                '-c:v', 'libx264', // Video codec
                '-preset', 'medium', // Encoding preset (balance of speed and quality)
                '-crf', '23', // Constant Rate Factor (lower = better quality, higher = smaller file size)
                '-c:a', 'aac', // Audio codec
                '-b:a', '128k', // Audio bitrate
                '-r', '30', // Video frame rate
                '-shortest' // Finish encoding when the shortest input stream ends (usually audio)
            ])
            .output(outputPath)
            .on('progress', (progress) => {
                // Optional: log progress
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

// Method to clean up temporary files
async cleanupTempDir(dirPath: string): Promise<void> {
    try {
        if (await fs.pathExists(dirPath)) {
            await fs.remove(dirPath);
            logger.info(`Cleaned up temporary directory: ${dirPath}`);
        }
    } catch (error: any) {
        logger.error('Error cleaning up temporary directory:', error.message);
    }
}

// Implement cleanup for the producer's own temp files if managed separately
async cleanup(): Promise<void> {
    logger.info("VideoProducer: Cleaning up its own temporary directories...");
    // Call cleanupTempDir for any base temp directories managed by the producer
    // Example: await this.cleanupTempDir(path.join(process.cwd(), 'temp_producer'));
}
