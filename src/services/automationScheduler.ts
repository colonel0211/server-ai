// src/services/automationScheduler.ts

import cron from 'node-cron';

// --- IMPORT NECESSARY TYPES AND UTILITIES ---
// Adjust paths as per your project structure
import { YouTubeContentEngine, TrendingVideo, VideoScript, VideoProductionResult } from './ContentEngine'; // Ensure VideoProductionResult is exported from ContentEngine
import { VideoProducer, VideoConfig } from './videoProducer'; // Import VideoConfig and VideoProductionResult
import supabase, { SupabaseClient } from '../config/database'; // Ensure Supabase client is imported
import { logger } from '../utils/logger'; // Ensure logger is imported

// --- SCHEDULER STATUS INTERFACE ---
interface ScheduleStatus {
  isRunning: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  totalVideosProd: number; // Count of successfully produced videos
  errors: string[];       // List of recent errors
}

export class AutomationScheduler {
  private contentEngine: YouTubeContentEngine;
  private videoProducer: VideoProducer;
  private scheduler: AutomationScheduler; // Reference to self for methods
  private status: ScheduleStatus;
  private tasks: cron.ScheduledTask[] = []; // Holds all scheduled cron jobs

  constructor() {
    this.contentEngine = new YouTubeContentEngine();
    this.videoProducer = new VideoProducer();
    this.scheduler = this; // Self-reference
    this.status = {
      isRunning: false,
      lastRun: null,
      nextRun: null,
      totalVideosProd: 0,
      errors: []
    };
  }

  // Initialize schedules but do not start them
  public initialize(): void {
    try {
      this.setupDailyVideoGeneration();
      this.setupTrendingAnalysis();
      this.setupPerformanceMonitoring();
      this.setupCleanupTasks();
      
      logger.info('✅ Automation Scheduler initialized successfully');
    } catch (error: any) {
      logger.error('❌ Failed to initialize Automation Scheduler:', error);
      this.status.errors.push(`Initialization error: ${error.message}`);
    }
  }

  private setupDailyVideoGeneration(): void {
    // Run every day at 9 AM UTC
    const dailyTask = cron.schedule('0 9 * * *', async () => {
      await this.generateDailyContent();
    }, { scheduled: false, timezone: "UTC" });

    // Run every 6 hours
    const frequentTask = cron.schedule('0 */6 * * *', async () => {
      await this.generateDailyContent();
    }, { scheduled: false, timezone: "UTC" });

    this.tasks.push(dailyTask, frequentTask);
    logger.info('📅 Daily video generation scheduled (9 AM UTC and every 6 hours)');
  }

  private setupTrendingAnalysis(): void {
    // Run every 2 hours
    const trendingTask = cron.schedule('0 */2 * * *', async () => {
      await this.analyzeTrendingContent();
    }, { scheduled: false, timezone: "UTC" });

    this.tasks.push(trendingTask);
    logger.info('📈 Trending analysis scheduled (every 2 hours)');
  }

  private setupPerformanceMonitoring(): void {
    // Run every hour
    const monitoringTask = cron.schedule('0 * * * *', async () => {
      await this.monitorPerformance();
    }, { scheduled: false, timezone: "UTC" });

    this.tasks.push(monitoringTask);
    logger.info('📊 Performance monitoring scheduled (every hour)');
  }

  private setupCleanupTasks(): void {
    // Run daily at 2 AM UTC
    const cleanupTask = cron.schedule('0 2 * * *', async () => {
      await this.performCleanup();
    }, { scheduled: false, timezone: "UTC" });

    this.tasks.push(cleanupTask);
    logger.info('🧹 Cleanup tasks scheduled (daily at 2 AM UTC)');
  }

  // Start all scheduled tasks
  public start(): void {
    try {
      this.tasks.forEach(task => task.start());
      this.status.isRunning = true;
      // Attempt to set nextRun based on the first task's schedule (simplified)
      // A more robust approach would track all tasks' next dates.
      this.status.nextRun = new Date(Date.now() + 60 * 60 * 1000); 
      logger.info('🚀 Automation Scheduler started');
    } catch (error: any) {
      logger.error('❌ Failed to start scheduler:', error);
      this.status.errors.push(`Start error: ${error.message}`);
    }
  }

  // Stop all scheduled tasks
  public stop(): void {
    try {
      this.tasks.forEach(task => task.stop());
      this.status.isRunning = false;
      this.status.nextRun = null;
      logger.info('⏹️ Automation Scheduler stopped');
    } catch (error: any) {
      logger.error('❌ Failed to stop scheduler:', error);
      this.status.errors.push(`Stop error: ${error.message}`);
    }
  }

  // Main task: Hunt, generate script, produce video
  private async generateDailyContent(): Promise<void> {
    if (this.status.isRunning) {
      logger.info('⚠️ Content generation task already running, skipping this run.');
      return;
    }

    this.status.isRunning = true;
    this.status.lastRun = new Date();

    try {
      logger.info('🎬 Starting daily content generation and video production...');

      // Step 1: Hunt for trending topics
      const trendingTopics = await this.contentEngine.huntTrendingVideos(); 

      if (!trendingTopics || trendingTopics.length === 0) {
        throw new Error('No trending topics found from ContentEngine.');
      }

      // Step 2: Select the first trending topic as inspiration
      const selectedTopic = trendingTopics[0];
      logger.info(`📝 Selected topic for inspiration: "${selectedTopic.title}"`);

      // Step 3: Generate content script(s)
      const generatedScripts = await this.contentEngine.analyzeAndGenerateContent(trendingTopics);

      if (!generatedScripts || generatedScripts.length === 0) {
        throw new Error('Content script generation failed from ContentEngine.');
      }

      const videoScript = generatedScripts[0]; 
      logger.info(`📝 Generated script title: "${videoScript.title}"`);

      // Step 4: Produce the video
      const videoConfig: VideoConfig = {
        // Map VideoScript properties to VideoConfig, providing defaults
        niche: videoScript.tags?.includes('tech') ? 'tech' : 
               videoScript.tags?.includes('travel') ? 'travel' : 
               'general', 
        duration: videoScript.segments.reduce((sum, segment) => sum + segment.duration, 0) || 60, 
        resolution: '1080p', // Default resolution
        style: videoScript.segments.length > 0 ? videoScript.segments[0].background_type : 'vlog', 
      };

      const videoProductionResult: VideoProductionResult = await this.videoProducer.createVideo(videoConfig);

      if (videoProductionResult && videoProductionResult.success && videoProductionResult.videoId) {
        logger.info(`✅ Video produced successfully by producer: ID ${videoProductionResult.videoId}`);
        this.status.totalVideosProd++;
        await this.logVideoCreation(videoProductionResult.videoId, selectedTopic.title);
      } else {
        const errorMessage = videoProductionResult?.error || 'Video production failed, no videoId provided.';
        throw new Error(errorMessage);
      }

    } catch (error: any) {
      logger.error('❌ Daily content generation/production process failed:', error);
      this.status.errors.push(`Content generation/production error: ${error.message}`);
    } finally {
      this.status.isRunning = false; 
    }
  }

  // Analyze trending content and store data
  private async analyzeTrendingContent(): Promise<void> {
    try {
      logger.info('📈 Analyzing trending content...');
      const trendingVideos = await this.contentEngine.huntTrendingVideos();
      
      if (trendingVideos && trendingVideos.length > 0) {
        if (this.supabaseClient) {
          await this.supabaseClient
            .from('trending_analysis')
            .insert({
              analyzed_at: new Date().toISOString(),
              video_count: trendingVideos.length,
              top_categories: this.extractCategories(trendingVideos),
              analysis_data: trendingVideos 
            });
        } else {
          logger.error("Supabase client not available for trending analysis.");
        }
        logger.info(`📊 Analyzed ${trendingVideos.length} trending videos and stored data.`);
      } else {
        logger.warn('No trending videos found to analyze.');
      }
    } catch (error: any) {
      logger.error('❌ Trending analysis failed:', error);
      this.status.errors.push(`Trending analysis error: ${error.message}`);
    }
  }

  // Monitor performance metrics
  private async monitorPerformance(): Promise<void> {
    try {
      logger.info('📊 Monitoring performance metrics...');
      const stats = {
        totalVideos: this.status.totalVideosProd,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        errorCount: this.status.errors.length,
        lastRun: this.status.lastRun,
        timestamp: new Date().toISOString()
      };

      if (this.supabaseClient) {
        await this.supabaseClient.from('performance_metrics').insert(stats);
      } else {
        logger.error("Supabase client not available for performance monitoring.");
      }
      logger.info('📈 Performance metrics recorded.');
    } catch (error: any) {
      logger.error('❌ Performance monitoring failed:', error);
      this.status.errors.push(`Performance monitoring error: ${error.message}`);
    }
  }

  // Perform cleanup tasks
  private async performCleanup(): Promise<void> {
    try {
      logger.info('🧹 Performing cleanup tasks...');

      // Call cleanup on VideoProducer
      if (this.videoProducer && typeof this.videoProducer.cleanup === 'function') {
        await this.videoProducer.cleanup();
      } else {
        logger.warn('VideoProducer does not have a cleanup method.');
      }

      // Trim errors array
      if (this.status.errors.length > 10) {
        this.status.errors = this.status.errors.slice(-10);
      }

      // Cleanup old database records
      if (this.supabaseClient) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        await this.supabaseClient.from('performance_metrics').delete().lt('timestamp', thirtyDaysAgo.toISOString());
        await this.supabaseClient.from('trending_analysis').delete().lt('analyzed_at', thirtyDaysAgo.toISOString());
      } else {
        logger.error("Supabase client not available for cleanup.");
      }
      logger.info('✅ Cleanup tasks completed.');
    } catch (error: any) {
      logger.error('❌ Cleanup failed:', error);
      this.status.errors.push(`Cleanup error: ${error.message}`);
    }
  }

  // Helper to extract top 5 categories
  private extractCategories(videos: TrendingVideo[]): string[] {
    const categories = videos
      .map((video: TrendingVideo) => video.category || 'Uncategorized')
      .reduce((acc: { [key: string]: number }, cat: string) => {
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});

    return Object.keys(categories)
      .sort((a, b) => categories[b] - categories[a])
      .slice(0, 5);
  }

  // Log video creation to database
  private async logVideoCreation(videoId: string, topic: string): Promise<void> {
    try {
      if (!this.supabaseClient) {
          logger.error("Supabase client not available for logging video creation.");
          return;
      }
      await this.supabaseClient
        .from('video_logs')
        .insert({
          video_id: videoId,
          topic: topic,
          created_at: new Date().toISOString(),
          status: 'produced'
        });
    } catch (error: any) {
      logger.error(`Failed to log video creation for video ID ${videoId}:`, error);
    }
  }

  // Get current status of the scheduler
  public getStatus(): ScheduleStatus {
    return { ...this.status };
  }

  // Get scheduler statistics
  public getStats() {
    return {
      isRunning: this.status.isRunning,
      totalVideosProduced: this.status.totalVideosProd,
      lastRun: this.status.lastRun,
      nextRun: this.status.nextRun,
      errorCount: this.status.errors.length,
      uptime: process.uptime(),
      activeTasks: this.tasks.length
    };
  }

  // Manual trigger for content generation and video production
  // Returns VideoProductionResult for immediate feedback if possible
  public async triggerContentGeneration(): Promise<VideoProductionResult> { 
    try {
      await this.generateDailyContent();
      // Indicate success for the trigger itself. The actual videoId might not be available immediately here.
      return { success: true }; // Return a simple success object.
    } catch (error: any) {
      // Return error in the expected format
      return { success: false, error: error.message };
    }
  }

  // Manual trigger for trending analysis
  public async triggerTrendingAnalysis(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.analyzeTrendingContent();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
