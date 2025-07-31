// src/services/videoProducer.ts
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import path from 'path';
import { createCanvas, loadImage, registerFont } from 'canvas';
import axios from 'axios';
import OpenAI from 'openai';

export interface VideoConfig {
  title: string;
  script: string;
  hook: string;
  niche: string;
  duration?: number;
  resolution?: '1080p' | '720p' | '4K';
  style?: 'minimal' | 'modern' | 'cinematic';
}

export interface VideoAssets {
  backgroundImages: string[];
  audioPath?: string;
  thumbnailPath: string;
  subtitlesPath?: string;
}

export class VideoProducer {
  private workingDir: string;
  private assetsDir: string;
  private outputDir: string;
  private openai: OpenAI;

  constructor() {
    this.workingDir = path.join(process.cwd(), 'temp', 'video_production');
    this.assetsDir = path.join(this.workingDir, 'assets');
    this.outputDir = path.join(this.workingDir, 'output');
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.ensureDirectories();
    console.log('🎬 Video Producer initialized');
  }

  /**
   * Create complete video from config
   */
  async createVideo(config: VideoConfig): Promise<string> {
    try {
      console.log(`🎬 Starting video production: ${config.title}`);
      
      const jobId = `video_${Date.now()}`;
      const jobDir = path.join(this.workingDir, jobId);
      await fs.ensureDir(jobDir);

      // Step 1: Generate script segments
      const scriptSegments = this.parseScript(config.script);
      
      // Step 2: Generate visual assets
      const assets = await this.generateAssets(config, jobDir);
      
      // Step 3: Create text-to-speech audio
      const audioPath = await this.generateAudio(config.script, jobDir);
      
      // Step 4: Create video scenes
      const scenePaths = await this.createScenes(scriptSegments, assets, jobDir);
      
      // Step 5: Combine everything into final video
      const finalVideoPath = await this.combineScenes(scenePaths, audioPath, jobDir, config);
      
      // Step 6: Generate thumbnail
      const thumbnailPath = await this.generateThumbnail(config, jobDir);
      
      console.log(`✅ Video production completed: ${finalVideoPath}`);
      return finalVideoPath;

    } catch (error: any) {
      console.error('❌ Video production failed:', error.message);
      throw error;
    }
  }

  /**
   * Parse script into timed segments
   */
  private parseScript(script: string): Array<{text: string, duration: number, startTime: number}> {
    const sentences = script.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const segments: Array<{text: string, duration: number, startTime: number}> = [];
    let currentTime = 0;

    sentences.forEach(sentence => {
      const text = sentence.trim();
      if (text.length === 0) return;

      // Estimate duration based on text length (average reading speed)
      const wordsPerMinute = 150;
      const words = text.split(' ').length;
      const duration = Math.max(3, (words / wordsPerMinute) * 60); // Minimum 3 seconds

      segments.push({
        text,
        duration,
        startTime: currentTime
      });

      currentTime += duration;
    });

    return segments;
  }

  /**
   * Generate visual assets (images, backgrounds)
   */
  private async generateAssets(config: VideoConfig, jobDir: string): Promise<VideoAssets> {
    try {
      const assetsPath = path.join(jobDir, 'assets');
      await fs.ensureDir(assetsPath);

      // Get stock images related to the topic
      const backgroundImages = await this.getStockImages(config.niche, config.title, 5);
      
      // Download and save images
      const savedImages: string[] = [];
      for (let i = 0; i < backgroundImages.length; i++) {
        const imagePath = path.join(assetsPath, `bg_${i}.jpg`);
        await this.downloadImage(backgroundImages[i], imagePath);
        savedImages.push(imagePath);
      }

      // Generate thumbnail
      const thumbnailPath = await this.createThumbnail(config, assetsPath);

      return {
        backgroundImages: savedImages,
        thumbnailPath
      };

    } catch (error: any) {
      console.error('❌ Failed to generate assets:', error.message);
      throw error;
    }
  }

  /**
   * Get stock images from Unsplash
   */
  private async getStockImages(niche: string, title: string, count: number): Promise<string[]> {
    try {
      // Extract keywords from title for better image search
      const keywords = this.extractKeywords(title);
      const searchQuery = `${niche} ${keywords.join(' ')}`.toLowerCase();

      // Using Unsplash API (you'll need to add UNSPLASH_ACCESS_KEY to env)
      const accessKey = process.env.UNSPLASH_ACCESS_KEY;
      if (!accessKey) {
        console.warn('⚠️ Unsplash API key missing, using placeholder images');
        return this.getPlaceholderImages(count);
      }

      const response = await axios.get(`https://api.unsplash.com/search/photos`, {
        params: {
          query: searchQuery,
          per_page: count,
          orientation: 'landscape'
        },
        headers: {
          'Authorization': `Client-ID ${accessKey}`
        }
      });

      return response.data.results.map((photo: any) => photo.urls.full);

    } catch (error) {
      console.warn('⚠️ Failed to fetch stock images, using placeholders');
      return this.getPlaceholderImages(count);
    }
  }

  /**
   * Get placeholder images when API unavailable
   */
  private getPlaceholderImages(count: number): string[] {
    const placeholders = [
      'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=1920&h=1080',
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&h=1080',
      'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1920&h=1080',
      'https://images.unsplash.com/photo-1504384764586-bb4cdc1707b0?w=1920&h=1080',
      'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=1920&h=1080'
    ];

    return placeholders.slice(0, count);
  }

  /**
   * Extract keywords from title
   */
  private extractKeywords(title: string): string[] {
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'how', 'what', 'why', 'when', 'where'];
    return title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 2 && !stopWords.includes(word))
      .slice(0, 3);
  }

  /**
   * Download image from URL
   */
  private async downloadImage(url: string, filepath: string): Promise<void> {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  /**
   * Generate text-to-speech audio using OpenAI
   */
  private async generateAudio(script: string, jobDir: string): Promise<string> {
    try {
      console.log('🎵 Generating audio narration...');
      
      const mp3 = await this.openai.audio.speech.create({
        model: "tts-1-hd",
        voice: "onyx", // Deep, engaging male voice
        input: script,
        speed: 0.95 // Slightly slower for better comprehension
      });

      const audioPath = path.join(jobDir, 'narration.mp3');
      const buffer = Buffer.from(await mp3.arrayBuffer());
      await fs.writeFile(audioPath, buffer);
      
      console.log('✅ Audio generated successfully');
      return audioPath;

    } catch (error: any) {
      console.error('❌ Failed to generate audio:', error.message);
      throw error;
    }
  }

  /**
   * Create individual video scenes
   */
  private async createScenes(
    segments: Array<{text: string, duration: number, startTime: number}>,
    assets: VideoAssets,
    jobDir: string
  ): Promise<string[]> {
    try {
      console.log('🎬 Creating video scenes...');
      
      const scenePaths: string[] = [];
      const sceneDir = path.join(jobDir, 'scenes');
      await fs.ensureDir(sceneDir);

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const backgroundImage = assets.backgroundImages[i % assets.backgroundImages.length];
        
        // Create text overlay image
        const textOverlayPath = await this.createTextOverlay(segment.text, sceneDir, i);
        
        // Create scene video with background + text
        const scenePath = await this.createScene(
          backgroundImage,
          textOverlayPath,
          segment.duration,
          sceneDir,
          i
        );
        
        scenePaths.push(scenePath);
      }

      console.log(`✅ Created ${scenePaths.length} scenes`);
      return scenePaths;

    } catch (error: any) {
      console.error('❌ Failed to create scenes:', error.message);
      throw error;
    }
  }

  /**
   * Create text overlay image
   */
  private async createTextOverlay(text: string, outputDir: string, index: number): Promise<string> {
    const canvas = createCanvas(1920, 1080);
    const ctx = canvas.getContext('2d');

    // Semi-transparent background for text
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 800, 1920, 280);

    // Text styling
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap text
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > 1800 && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Draw text lines
    const lineHeight = 60;
    const startY = 940 - ((lines.length - 1) * lineHeight / 2);
    
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, 960, startY + (lineIndex * lineHeight));
    });

    // Save overlay
    const overlayPath = path.join(outputDir, `text_overlay_${index}.png`);
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(overlayPath, buffer);

    return overlayPath;
  }

  /**
   * Create individual scene video
   */
  private async createScene(
    backgroundPath: string,
    textOverlayPath: string,
    duration: number,
    outputDir: string,
    index: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(outputDir, `scene_${index}.mp4`);

      ffmpeg()
        .input(backgroundPath)
        .inputOptions(['-loop 1'])
        .input(textOverlayPath)
        .inputOptions(['-loop 1'])
        .complexFilter([
          '[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[bg]',
          '[1:v]scale=1920:1080[overlay]',
          '[bg][overlay]overlay=0:0[out]'
        ])
        .outputOptions([
          '-map [out]',
          '-t', duration.toString(),
          '-r', '30',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-pix_fmt', 'yuv420p'
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }

  /**
   * Combine all scenes with audio
   */
  private async combineScenes(
    scenePaths: string[],
    audioPath: string,
    jobDir: string,
    config: VideoConfig
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(jobDir, `${config.title.replace(/[^a-zA-Z0-9]/g, '_')}_final.mp4`);
      
      // Create concat file
      const concatFilePath = path.join(jobDir, 'concat.txt');
      const concatContent = scenePaths.map(path => `file '${path}'`).join('\n');
      fs.writeFileSync(concatFilePath, concatContent);

      ffmpeg()
        .input(concatFilePath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .input(audioPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest',
          '-preset', 'medium',
          '-crf', '23'
        ])
        .output(outputPath)
        .on('end', () => {
          console.log('✅ Final video assembled');
          resolve(outputPath);
        })
        .on('error', reject)
        .run();
    });
  }

  /**
   * Generate eye-catching thumbnail
   */
  private async generateThumbnail(config: VideoConfig, jobDir: string): Promise<string> {
    try {
      console.log('🖼️ Generating thumbnail...');
      
      // Use OpenAI DALL-E to create thumbnail
      const response = await this.openai.images.generate({
        model: "dall-e-3",
        prompt: `Create a vibrant, eye-catching YouTube thumbnail for "${config.title}". 
                Style: Bold text, bright colors, high contrast, clickable design. 
                Niche: ${config.niche}. Make it look professional and engaging.`,
        size: "1792x1024", // YouTube thumbnail ratio
        quality: "hd",
        n: 1,
      });

      const thumbnailUrl = response.data[0].url!;
      const thumbnailPath = path.join(jobDir, 'thumbnail.png');
      
      // Download thumbnail
      await this.downloadImage(thumbnailUrl, thumbnailPath);
      
      console.log('✅ Thumbnail generated');
      return thumbnailPath;

    } catch (error: any) {
      console.error('❌ Failed to generate thumbnail:', error.message);
      
      // Fallback: Create simple text thumbnail
      return this.createFallbackThumbnail(config, jobDir);
    }
  }

  /**
   * Create fallback thumbnail with Canvas
   */
  private async createFallbackThumbnail(config: VideoConfig, jobDir: string): Promise<string> {
    const canvas = createCanvas(1280, 720);
    const ctx = canvas.getContext('2d');

    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
    gradient.addColorStop(0, '#FF6B6B');
    gradient.addColorStop(1, '#4ECDC4');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1280, 720);

    // Title text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;

    // Word wrap title
    const words = config.title.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > 1100 && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Draw title
    const lineHeight = 80;
    const startY = 360 - ((lines.length - 1) * lineHeight / 2);
    
    lines.forEach((line, index) => {
      const y = startY + (index * lineHeight);
      ctx.strokeText(line, 640, y);
      ctx.fillText(line, 640, y);
    });

    // Save thumbnail
    const thumbnailPath = path.join(jobDir, 'thumbnail_fallback.png');
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(thumbnailPath, buffer);

    return thumbnailPath;
  }

  /**
   * Create thumbnail with Canvas
   */
  private async createThumbnail(config: VideoConfig, assetsDir: string): Promise<string> {
    const canvas = createCanvas(1280, 720);
    const ctx = canvas.getContext('2d');

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1280, 720);

    // Title styling
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 56px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Split title into multiple lines if needed
    const maxWidth = 1100;
    const words = config.title.split(' ');
    const lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + ' ' + word).width;
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);

    // Draw title lines
    const lineHeight = 70;
    const startY = 360 - ((lines.length - 1) * lineHeight / 2);
    
    lines.forEach((line, index) => {
      ctx.fillText(line, 640, startY + (index * lineHeight));
    });

    // Save thumbnail
    const thumbnailPath = path.join(assetsDir, 'thumbnail.png');
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(thumbnailPath, buffer);

    return thumbnailPath;
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    await fs.ensureDir(this.workingDir);
    await fs.ensureDir(this.assetsDir);
    await fs.ensureDir(this.outputDir);
  }

  /**
   * Clean up temporary files
   */
  async cleanup(jobDir: string): Promise<void> {
    try {
      if (await fs.pathExists(jobDir)) {
        await fs.remove(jobDir);
        console.log('🧹 Cleaned up temporary files');
      }
    } catch (error) {
      console.warn('⚠️ Failed to cleanup temporary files:', error);
    }
  }

  /**
   * Get video information
   */
  async getVideoInfo(videoPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
  }
}
