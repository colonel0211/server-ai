import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import path from 'path';
import { createCanvas, loadImage, registerFont } from 'canvas';
import axios from 'axios';

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

class VideoProducer {
  private workingDir: string;
  private assetsDir: string;
  private outputDir: string;

  constructor() {
    this.workingDir = path.join(process.cwd(), 'temp', 'video_production');
    this.assetsDir = path.join(this.workingDir, 'assets');
    this.outputDir = path.join(this.workingDir, 'output');
    
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
      const duration = Math.max(2, (words / wordsPerMinute) * 60); // Minimum 2 seconds

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
   * Generate text-to-speech audio
   */
  private async generateAudio(script: string, jobDir: string): Promise<string> {
    try {
      // Using Google Text-to-Speech (you'll need credentials)
      const textToSpeech = require('@google-cloud/text-to-speech');
      const client = new textToSpeech.TextToSpeechClient();

      const request = {
        input: { text: script },
        voice: { 
          languageCode: 'en-US', 
          name: 'en-US-Neural2-D', // Professional male voice
          ssmlGender: 'MALE'
        },
        audioConfig: { 
          audioEncoding: 'MP3',
          speakingRate: 0.9,
          pitch: -2.0
        },
      };

      const [response] = await client.synthesizeSpeech(request);
      const audioPath = path.join(jobDir, 'narration.mp3');
      
      await fs.writeFile(audioPath, response.audioContent, 'binary');
      console.log('🎵 Audio
