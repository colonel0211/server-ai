import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import path from 'path';
import { createCanvas, loadImage, registerFont } from 'canvas';
import axios from 'axios';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface VideoConfig {
  title: string;
  script: string;
  hook: string;
  niche: string;
  duration: number;
  resolution: '720p' | '1080p' | '4K';
  style: 'modern' | 'vintage' | 'minimalist' | 'vibrant';
}

export interface VideoAssets {
  audioPath: string;
  thumbnailPath: string;
  backgroundImages: string[];
  subtitles?: SubtitleEntry[];
}

export interface SubtitleEntry {
  start: number;
  end: number;
  text: string;
}

export class VideoProducer {
  private outputDir: string;
  private tempDir: string;
  private fontsLoaded: boolean = false;

  constructor() {
    this.outputDir = path.join(__dirname, '../../output');
    this.tempDir = path.join(__dirname, '../../temp');
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.ensureDir(path.join(this.outputDir, 'videos'));
    await fs.ensureDir(path.join(this.outputDir, 'audio'));
    await fs.ensureDir(path.join(this.outputDir, 'thumbnails'));
    await fs.ensureDir(path.join(this.outputDir, 'images'));
    await fs.ensureDir(this.tempDir);
  }

  private async loadFonts(): Promise<void> {
    if (this.fontsLoaded) return;

    try {
      // Download and register fonts if they don't exist
      const fontsDir = path.join(__dirname, '../../assets/fonts');
      await fs.ensureDir(fontsDir);

      const fontUrls = {
        'Roboto-Bold.ttf': 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4.woff2',
        'OpenSans-Regular.ttf': 'https://fonts.gstatic.com/s/opensans/v34/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0C4nY1M2xLER.woff2'
      };

      for (const [filename, url] of Object.entries(fontUrls)) {
        const fontPath = path.join(fontsDir, filename);
        
        if (!await fs.pathExists(fontPath)) {
          console.log(`📥 Downloading font: ${filename}`);
          // Note: In production, you'd want to use actual TTF files
          // This is just for demonstration - you'd need proper font files
        }

        try {
          registerFont(fontPath, { family: filename.split('-')[0] });
        } catch (error) {
          console.warn(`⚠️ Could not load font ${filename}:`, error);
        }
      }

      this.fontsLoaded = true;
    } catch (error) {
      console.warn('⚠️ Font loading failed, using system fonts:', error);
      this.fontsLoaded = true;
    }
  }

  async createVideo(config: VideoConfig): Promise<string> {
    console.log(`🎬 Starting video production: "${config.title}"`);
    
    try {
      // Load fonts first
      await this.loadFonts();

      // Generate all assets
      const assets = await this.generateAssets(config);

      // Create the final video
      const videoPath = await this.assembleVideo(config, assets);

      console.log(`✅ Video created successfully: ${videoPath}`);
      return videoPath;

    } catch (error) {
      console.error('❌ Video production failed:', error);
      throw error;
    }
  }

  private async generateAssets(config: VideoConfig): Promise<VideoAssets> {
    console.log('🎨 Generating video assets...');

    const [audioPath, thumbnailPath, backgroundImages] = await Promise.all([
      this.generateVoiceover(config.script, config.title),
      this.generateThumbnail(config.title, config.niche, config.style),
      this.generateBackgroundImages(config.niche, 5)
    ]);

    return {
      audioPath,
      thumbnailPath,
      backgroundImages,
      subtitles: this.generateSubtitles(config.script)
    };
  }

  private async generateVoiceover(script: string, title: string): Promise<string> {
    console.log('🎵 Generating AI voiceover...');

    try {
      const response = await openai.audio.speech.create({
        model: 'tts-1-hd',
        voice: 'nova',
        input: script,
        response_format: 'mp3',
        speed: 1.0
      });

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const audioPath = path.join(this.outputDir, 'audio', `${this.sanitizeFilename(title)}.mp3`);
      
      await fs.writeFile(audioPath, audioBuffer);
      console.log(`✅ Voiceover saved: ${audioPath}`);
      
      return audioPath;

    } catch (error) {
      console.error('❌ Voiceover generation failed:', error);
      throw new Error(`Failed to generate voiceover: ${error}`);
    }
  }

  private async generateThumbnail(title: string, niche: string, style: string): Promise<string> {
    console.log('🖼️ Generating thumbnail...');

    const canvas = createCanvas(1280, 720);
    const ctx = canvas.getContext('2d');

    // Style configurations
    const styles = {
      modern: {
        bgGradient: ['#667eea', '#764ba2'],
        textColor: '#ffffff',
        accentColor: '#ff6b6b'
      },
      vintage: {
        bgGradient: ['#8B4513', '#D2691E'],
        textColor: '#F5F5DC',
        accentColor: '#FFD700'
      },
      minimalist: {
        bgGradient: ['#ffffff', '#f8f9fa'],
        textColor: '#333333',
        accentColor: '#007bff'
      },
      vibrant: {
        bgGradient: ['#ff9a9e', '#fecfef'],
        textColor: '#ffffff',
        accentColor: '#ffd700'
      }
    };

    const currentStyle = styles[style as keyof typeof styles] || styles.modern;

    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, currentStyle.bgGradient[0]);
    gradient.addColorStop(1, currentStyle.bgGradient[1]);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add overlay pattern
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    for (let i = 0; i < canvas.width; i += 40) {
      for (let j = 0; j < canvas.height; j += 40) {
        if ((i + j) % 80 === 0) {
          ctx.fillRect(i, j, 20, 20);
        }
      }
    }

    // Title text
    ctx.fillStyle = currentStyle.textColor;
    ctx.font = 'bold 48px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Word wrap title
    const words = title.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > canvas.width - 100 && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Draw title lines
    const startY = canvas.height / 2 - (lines.length - 1) * 30;
    lines.forEach((line, index) => {
      ctx.fillText(line, canvas.width / 2, startY + index * 60);
    });

    // Niche tag
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = currentStyle.accentColor;
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.fillText(`#${niche.toUpperCase()}`, canvas.width / 2, canvas.height - 60);

    // Save thumbnail
    const thumbnailPath = path.join(this.outputDir, 'thumbnails', `${this.sanitizeFilename(title)}.png`);
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(thumbnailPath, buffer);

    console.log(`✅ Thumbnail saved: ${thumbnailPath}`);
    return thumbnailPath;
  }

  private async generateBackgroundImages(niche: string, count: number): Promise<string[]> {
    console.log(`🖼️ Generating ${count} background images...`);

    const images: string[] = [];
    
    try {
      // Generate images using DALL-E
      for (let i = 0; i < count; i++) {
        const prompt = `A beautiful, high-quality background image related to ${niche}, abstract, modern, suitable for video background, 16:9 aspect ratio, vibrant colors`;
        
        try {
          const response = await openai.images.generate({
            model: 'dall-e-3',
            prompt,
            size: '1792x1024',
            quality: 'standard',
            n: 1
          });

          const imageUrl = response.data[0].url;
          if (imageUrl) {
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const imagePath = path.join(this.outputDir, 'images', `bg_${niche}_${i + 1}.png`);
            
            await fs.writeFile(imagePath, imageResponse.data);
            images.push(imagePath);
            
            console.log(`✅ Background image ${i + 1} saved: ${imagePath}`);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to generate image ${i + 1}, using fallback`);
          // Create a fallback colored background
          const fallbackPath = await this.createFallbackImage(niche, i);
          images.push(fallbackPath);
        }
      }

    } catch (error) {
      console.warn('⚠️ DALL-E generation failed, creating fallback images');
      
      // Create fallback images
      for (let i = 0; i < count; i++) {
        const fallbackPath = await this.createFallbackImage(niche, i);
        images.push(fallbackPath);
      }
    }

    return images;
  }

  private async createFallbackImage(niche: string, index: number): Promise<string> {
    const canvas = createCanvas(1920, 1080);
    const ctx = canvas.getContext('2d');

    // Color palettes for different niches
    const palettes = {
      tech: ['#667eea', '#764ba2', '#f093fb'],
      lifestyle: ['#ffecd2', '#fcb69f', '#ff9a9e'],
      business: ['#a8edea', '#fed6e3', '#667eea'],
      health: ['#d299c2', '#fef9d7', '#89f7fe'],
      default: ['#ff9a9e', '#fecfef', '#fad0c4']
    };

    const colors = palettes[niche as keyof typeof palettes] || palettes.default;
    const color1 = colors[index % colors.length];
    const color2 = colors[(index + 1) % colors.length];

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add geometric shapes
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const size = Math.random() * 100 + 50;
      
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    const imagePath = path.join(this.outputDir, 'images', `fallback_${niche}_${index}.png`);
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(imagePath, buffer);

    return imagePath;
  }

  private generateSubtitles(script: string): SubtitleEntry[] {
    const sentences = script.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgWordsPerSecond = 2.5; // Approximate speaking speed
    
    let currentTime = 0;
    const subtitles: SubtitleEntry[] = [];

    sentences.forEach(sentence => {
      const words = sentence.trim().split(/\s+/);
      const duration = words.length / avgWordsPerSecond;
      
      subtitles.push({
        start: currentTime,
        end: currentTime + duration,
        text: sentence.trim()
      });
      
      currentTime += duration + 0.5; // Small pause between sentences
    });

    return subtitles;
  }

  private async assembleVideo(config: VideoConfig, assets: VideoAssets): Promise<string> {
    console.log('🎞️ Assembling final video...');

    const outputPath = path.join(this.outputDir, 'videos', `${this.sanitizeFilename(config.title)}.mp4`);
    
    return new Promise((resolve, reject) => {
      let ffmpegCommand = ffmpeg();

      // Add background images as input (slideshow)
      assets.backgroundImages.forEach(imagePath => {
        ffmpegCommand = ffmpegCommand.input(imagePath);
      });

      // Add audio input
      ffmpegCommand = ffmpegCommand.input(assets.audioPath);

      // Resolution settings
      const resolutions = {
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 },
        '4K': { width: 3840, height: 2160 }
      };
      
      const { width, height } = resolutions[config.resolution];

      ffmpegCommand
        .complexFilter([
          // Create slideshow from images
          `concat=n=${assets.backgroundImages.length}:v=1:a=0[slideshow]`,
          // Scale to desired resolution
          `[slideshow]scale=${width}:${height}[video]`
        ])
        .outputOptions([
          '-map', '[video]',
          '-map', `${assets.backgroundImages.length}:a`, // Audio from last input
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-b:v', '2M',
          '-b:a', '192k',
          '-preset', 'medium',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart'
        ])
        .format('mp4')
        .on('start', (command) => {
          console.log('🎬 FFmpeg started:', command);
        })
        .on('progress', (progress) => {
          console.log(`🎞️ Processing: ${Math.round(progress.percent || 0)}%`);
        })
        .on('end', () => {
          console.log('✅ Video assembly completed');
          resolve(outputPath);
        })
        .on('error', (error) => {
          console.error('❌ Video assembly failed:', error);
          reject(error);
        })
        .save(outputPath);
    });
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .toLowerCase()
      .substring(0, 100); // Limit length
  }

  async createCustomVideo(options: {
    images: string[];
    audioPath: string;
    title: string;
    subtitles?: SubtitleEntry[];
    effects?: string[];
  }): Promise<string> {
    console.log(`🎬 Creating custom video: ${options.title}`);

    const outputPath = path.join(
      this.outputDir,
      'videos',
      `custom_${this.sanitizeFilename(options.title)}.mp4`
    );

    return new Promise((resolve, reject) => {
      let ffmpegCommand = ffmpeg();

      // Add image inputs
      options.images.forEach(imagePath => {
        ffmpegCommand = ffmpegCommand.input(imagePath);
      });

      // Add audio input
      ffmpegCommand = ffmpegCommand.input(options.audioPath);

      ffmpegCommand
        .complexFilter([
          `concat=n=${options.images.length}:v=1:a=0[slideshow]`,
          '[slideshow]scale=1920:1080[video]'
        ])
        .outputOptions([
          '-map', '[video]',
          '-map', `${options.images.length}:a`,
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-shortest' // Stop when shortest input ends
        ])
        .format('mp4')
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .save(outputPath);
    });
  }

  async addSubtitlesToVideo(videoPath: string, subtitles: SubtitleEntry[]): Promise<string> {
    console.log('📝 Adding subtitles to video...');

    const outputPath = videoPath.replace('.mp4', '_subtitled.mp4');
    
    // Create SRT subtitle file
    const srtPath = path.join(this.tempDir, `subtitles_${Date.now()}.srt`);
    const srtContent = this.generateSRTFile(subtitles);
    await fs.writeFile(srtPath, srtContent);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .input(srtPath)
        .outputOptions([
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-c:s', 'mov_text',
          '-metadata:s:s:0', 'language=eng'
        ])
        .format('mp4')
        .on('end', async () => {
          await fs.remove(srtPath); // Clean up temp file
          resolve(outputPath);
        })
        .on('error', async (error) => {
          await fs.remove(srtPath); // Clean up temp file
          reject(error);
        })
        .save(outputPath);
    });
  }

  private generateSRTFile(subtitles: SubtitleEntry[]): string {
    return subtitles
      .map((subtitle, index) => {
        const startTime = this.formatSRTTime(subtitle.start);
        const endTime = this.formatSRTTime(subtitle.end);
        
        return `${index + 1}\n${startTime} --> ${endTime}\n${subtitle.text}\n`;
      })
      .join('\n');
  }

  private formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds
      .toString()
      .padStart(3, '0')}`;
  }

  async getVideoInfo(videoPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (error, metadata) => {
        if (error) {
          reject(error);
        } else {
          resolve(metadata);
        }
      });
    });
  }

  async optimizeForPlatform(videoPath: string, platform: 'youtube' | 'tiktok' | 'instagram'): Promise<string> {
    console.log(`🎯 Optimizing video for ${platform}...`);

    const platformConfigs = {
      youtube: {
        resolution: '1920x1080',
        bitrate: '5M',
        format: 'mp4'
      },
      tiktok: {
        resolution: '1080x1920',
        bitrate: '3M',
        format: 'mp4'
      },
      instagram: {
        resolution: '1080x1080',
        bitrate: '3M',
        format: 'mp4'
      }
    };

    const config = platformConfigs[platform];
    const outputPath = videoPath.replace('.mp4', `_${platform}.mp4`);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .size(config.resolution)
        .videoBitrate(config.bitrate)
        .format(config.format)
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'medium',
          '-crf', '23'
        ])
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .save(outputPath);
    });
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up temporary files...');
    
    try {
      if (await fs.pathExists(this.tempDir)) {
        await fs.emptyDir(this.tempDir);
      }
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }
  }
}
