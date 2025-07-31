import cron from 'node-cron';
import { YouTubeContentEngine } from './ContentEngine';
import { VideoProducer } from './videoProducer';
import { supabase } from '../config/database';
import fs from 'fs-extra';
import path from 'path';

export interface ScheduleConfig {
  interval: string; // Cron expression
  enabled: boolean;
  niches: string[];
  maxVideosPerDay: number;
  qualityThreshold: number;
}

export interface ScheduleStatus {
  isRunning: boolean;
  nextRun: Date | null;
  lastRun: Date | null;
  totalVideosProd

  successfulRuns: number;
  failedRuns: number;
}

export class AutomationScheduler {
  private contentEngine: YouTubeContentEngine;
  private videoProducer: VideoProducer;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private config: ScheduleConfig;
  private status: ScheduleStatus;
  private videosCreatedToday: number = 0;
  private lastResetDate: string = '';

  constructor() {
    this.contentEngine = new YouTubeContentEngine();
    this.videoProducer = new VideoProducer();
    
    // Default configuration
    this.config = {
      interval: '0 */4 * * *', // Every 4 hours
      enabled: false,
      niches: ['technology', 'lifestyle', 'business', 'health', 'entertainment'],
      maxVideosPerDay: 6,
      qualityThreshold: 500000 // 500k views minimum
    };

    this.status = {
      isRunning: false,
      nextRun: null,
      lastRun: null,
      totalVideosProduced: 0,
      successfulRuns: 0,
      failedRuns: 0
    };

    this.initializeFromDatabase();
  }

  private async initializeFromDatabase(): Promise<void> {
    try {
      const { data: configData } = await supabase
        .from('automation_config')
        .select('*')
        .single();

      if (configData) {
        this.config = { ...this.config, ...configData };
      }

      const { data: statusData } = await supabase
        .from('automation_status')
        .select('*')
        .single();

      if (statusData) {
        this.status = {
          ...this.status,
          ...statusData,
          nextRun: statusData.next_run ? new Date(statusData.next_run) : null,
          lastRun: statusData.last_run ? new Date(statusData.last_run) : null
        };
      }

      // Reset daily counter if it's a new day
      const today = new Date().toDateString();
      if (this.lastResetDate !== today) {
        this.videosCreatedToday = 0;
        this.lastResetDate = today;
        await this.updateStatus();
      }

    } catch (error) {
      console.error('Error initializing scheduler from database:', error);
    }
  }

  async startScheduler(config?: Partial<ScheduleConfig>): Promise<void> {
    try {
      if (this.cronJob) {
        this.cronJob.stop();
      }

      if (config) {
        this.config = { ...this.config, ...config };
        await this.saveConfigToDatabase();
      }

      if (!this.config.enabled) {
        throw new Error('Scheduler is disabled in configuration');
      }

      console.log(`🚀 Starting automation scheduler with interval: ${this.config.interval}`);

      this.cronJob = cron.schedule(this.config.interval, async () => {
        await this.executeAutomationCycle();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.cronJob.start();
      this.isRunning = true;
      
      this.status.isRunning = true;
      this.status.nextRun = this.getNextRunTime();
      
      await this.updateStatus();
      
      console.log('✅ Automation scheduler started successfully');
      
    } catch (error) {
      console.error('❌ Failed to start scheduler:', error);
      throw error;
    }
  }

  async stopScheduler(): Promise<void> {
    try {
      if (this.cronJob) {
        this.cronJob.stop();
        this.cronJob = null;
      }

      this.isRunning = false;
      this.status.isRunning = false;
      this.status.nextRun = null;
      
      await this.updateStatus();
      
      console.log('🛑 Automation scheduler stopped');
      
    } catch (error) {
      console.error('❌ Failed to stop scheduler:', error);
      throw error;
    }
  }

  private async executeAutomationCycle(): Promise<void> {
    if (this.videosCreatedToday >= this.config.maxVideosPerDay) {
      console.log(`📊 Daily video limit reached (${this.config.maxVideosPerDay}). Skipping this cycle.`);
      return;
    }

    console.log('🤖 Starting automated video creation cycle...');
    
    const cycleStartTime = new Date();
    
    try {
      // Update status
      this.status.lastRun = cycleStartTime;
      await this.updateStatus();

      // Select a random niche
      const selectedNiche = this.config.niches[Math.floor(Math.random() * this.config.niches.length)];
      console.log(`🎯 Selected niche: ${selectedNiche}`);

      // Find trending videos in the niche
      const trendingVideos = await this.contentEngine.findTrendingVideos(selectedNiche, {
        minViews: this.config.qualityThreshold,
        maxResults: 10,
        publishedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      });

      if (trendingVideos.length === 0) {
        console.log(`⚠️ No trending videos found for ${selectedNiche}. Skipping cycle.`);
        return;
      }

      // Select the best video to recreate
      const targetVideo = trendingVideos[0];
      console.log(`📹 Target video: ${targetVideo.title} (${targetVideo.viewCount} views)`);

      // Generate new content based on the trending video
      const generatedContent = await this.contentEngine.generateContent({
        originalTitle: targetVideo.title,
        niche: selectedNiche,
        targetLength: 60, // 60 seconds
        style: 'engaging'
      });

      // Create the video
      const videoConfig = {
        title: generatedContent.title,
        script: generatedContent.script,
        hook: generatedContent.hook,
        niche: selectedNiche,
        duration: 60,
        resolution: '1080p' as const,
        style: 'modern' as const
      };

      const videoPath = await this.videoProducer.createVideo(videoConfig);

      // Upload to YouTube
      const uploadResult = await this.contentEngine.uploadToYouTube({
        videoPath,
        title: generatedContent.title,
        description: generatedContent.description,
        tags: generatedContent.tags,
        thumbnailPath: path.join(path.dirname(videoPath), '../thumbnails', `${path.parse(videoPath).name}.png`)
      });

      // Log success
      await this.logVideoCreation({
        title: generatedContent.title,
        niche: selectedNiche,
        videoId: uploadResult.videoId,
        videoPath,
        createdAt: new Date(),
        sourceVideoId: targetVideo.videoId,
        sourceViews: targetVideo.viewCount
      });

      this.videosCreatedToday++;
      this.status.totalVideosProduced++;
      this.status.successfulRuns++;

      console.log(`✅ Video created and uploaded successfully: ${uploadResult.videoId}`);
      console.log(`📊 Videos created today: ${this.videosCreatedToday}/${this.config.maxVideosPerDay}`);

    } catch (error) {
      console.error('❌ Automation cycle failed:', error);
      this.status.failedRuns++;
      
      // Log the error
      await this.logError({
        error: error instanceof Error ? error.message : 'Unknown error',
        cycle: cycleStartTime,
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      // Update status
      this.status.nextRun = this.getNextRunTime();
      await this.updateStatus();
    }
  }

  private async logVideoCreation(videoData: {
    title: string;
    niche: string;
    videoId: string;
    videoPath: string;
    createdAt: Date;
    sourceVideoId: string;
    sourceViews: number;
  }): Promise<void> {
    try {
      await supabase.from('created_videos').insert({
        title: videoData.title,
        niche: videoData.niche,
        video_id: videoData.videoId,
        video_path: videoData.videoPath,
        created_at: videoData.createdAt.toISOString(),
        source_video_id: videoData.sourceVideoId,
        source_views: videoData.sourceViews,
        automation_run: true
      });
    } catch (error) {
      console.error('Error logging video creation:', error);
    }
  }

  private async logError(errorData: {
    error: string;
    cycle: Date;
    stack?: string;
  }): Promise<void> {
    try {
      await supabase.from('automation_errors').insert({
        error_message: errorData.error,
        error_stack: errorData.stack,
        occurred_at: errorData.cycle.toISOString(),
        cycle_id: errorData.cycle.getTime().toString()
      });
    } catch (error) {
      console.error('Error logging automation error:', error);
    }
  }

  private getNextRunTime(): Date | null {
    if (!this.cronJob || !this.isRunning) return null;
    
    try {
      // Parse the cron expression to calculate next run
      // This is a simplified calculation - in production you'd use a proper cron parser
      const now = new Date();
      const nextHour = new Date(now.getTime() + 4 * 60 * 60 * 1000); // Next 4 hours (simplified)
      return nextHour;
    } catch (error) {
      console.error('Error calculating next run time:', error);
      return null;
    }
  }

  private async updateStatus(): Promise<void> {
    try {
      const statusData = {
        is_running: this.status.isRunning,
        next_run: this.status.nextRun?.toISOString(),
        last_run: this.status.lastRun?.toISOString(),
        total_videos_produced: this.status.totalVideosProduced,
        successful_runs: this.status.successfulRuns,
        failed_runs: this.status.failedRuns,
        videos_created_today: this.videosCreatedToday,
        last_reset_date: this.lastResetDate,
        updated_at: new Date().toISOString()
      };

      await supabase
        .from('automation_status')
        .upsert(statusData, { onConflict: 'id' });

    } catch (error) {
      console.error('Error updating status:', error);
    }
  }

  private async saveConfigToDatabase(): Promise<void> {
    try {
      await supabase
        .from('automation_config')
        .upsert({
          interval: this.config.interval,
          enabled: this.config.enabled,
          niches: this.config.niches,
          max_videos_per_day: this.config.maxVideosPerDay,
          quality_threshold: this.config.qualityThreshold,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (error) {
      console.error('Error saving config:', error);
    }
  }

  // Public methods for API endpoints
  async updateConfig(newConfig: Partial<ScheduleConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    await this.saveConfigToDatabase();
    
    // Restart scheduler with new config if it's running
    if (this.isRunning) {
      await this.stopScheduler();
      await this.startScheduler();
    }
  }

  getStatus(): ScheduleStatus & { videosCreatedToday: number; config: ScheduleConfig } {
    return {
      ...this.status,
      videosCreatedToday: this.videosCreatedToday,
      config: this.config
    };
  }

  async getRecentVideos(limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('created_videos')
        .select('*')
        .eq('automation_run', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching recent videos:', error);
      return [];
    }
  }

  async getErrorLogs(limit: number = 20): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('automation_errors')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching error logs:', error);
      return [];
    }
  }

  async getDailyStats(days: number = 7): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('created_videos')
        .select('created_at, niche')
        .eq('automation_run', true)
        .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group by day
      const stats: { [key: string]: { date: string; count: number; niches: { [niche: string]: number } } } = {};
      
      (data || []).forEach(video => {
        const date = new Date(video.created_at).toDateString();
        if (!stats[date]) {
          stats[date] = { date, count: 0, niches: {} };
        }
        stats[date].count++;
        stats[date].niches[video.niche] = (stats[date].niches[video.niche] || 0) + 1;
      });

      return Object.values(stats);
    } catch (error) {
      console.error('Error fetching daily stats:', error);
      return [];
    }
  }

  async forceRunNow(): Promise<void> {
    if (this.isRunning) {
      console.log('🔄 Forcing automation cycle...');
      await this.executeAutomationCycle();
    } else {
      throw new Error('Scheduler is not running. Start the scheduler first.');
    }
  }

  async resetDailyCounter(): Promise<void> {
    this.videosCreatedToday = 0;
    this.lastResetDate = new Date().toDateString();
    await this.updateStatus();
    console.log('🔄 Daily video counter reset');
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    await this.stopScheduler();
    
    // Clean up old temporary files
    try {
      const tempDir = path.join(__dirname, '../../temp');
      const outputDir = path.join(__dirname, '../../output');
      
      // Remove files older than 7 days
      const cleanupCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      
      await this.cleanDirectory(tempDir, cleanupCutoff);
      await this.cleanDirectory(path.join(outputDir, 'videos'), cleanupCutoff);
      await this.cleanDirectory(path.join(outputDir, 'audio'), cleanupCutoff);
      await this.cleanDirectory(path.join(outputDir, 'images'), cleanupCutoff);
      
      console.log('🧹 Cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  private async cleanDirectory(dirPath: string, cutoffTime: number): Promise<void> {
    try {
      if (!await fs.pathExists(dirPath)) return;
      
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          console.log(`🗑️ Removed old file: ${filePath}`);
        }
      }
    } catch (error) {
      console.error(`Error cleaning directory ${dirPath}:`, error);
    }
  }
}

export default AutomationScheduler;
