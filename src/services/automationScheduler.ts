import cron from 'node-cron';
// Import your ContentEngine and VideoProducer classes
import { YouTubeContentEngine, TrendingVideo, VideoScript } from './ContentEngine'; // Assuming these interfaces/classes are exported from ContentEngine
import { VideoProducer, VideoProductionResult } from './videoProducer'; // Assuming VideoProducer and a result interface are here
import supabase from '../config/database';
import { logger } from '../utils/logger';

// Make sure these interfaces are consistent with your ContentEngine and VideoProducer
interface ScheduleStatus {
  isRunning: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  totalVideosProd: number;
  errors: string[];
}

// This interface is for the result of a video *production* step, not necessarily content generation
// It should align with what VideoProducer.createVideo returns.
// If VideoProducer returns a different structure, you'll need to adjust this.
interface VideoProcessingResult {
  success: boolean;
  videoId?: string; // ID for the produced video
  filePath?: string; // Path to the generated video file
  error?: string;
}

export class AutomationScheduler {
  private contentEngine: YouTubeContentEngine;
  private videoProducer: VideoProducer;
  private status: ScheduleStatus;
  private tasks: cron.ScheduledTask[] = [];

  constructor() {
    this.contentEngine = new YouTubeContentEngine();
    this.videoProducer = new VideoProducer();
    this.status = {
      isRunning: false,
      lastRun: null,
      nextRun: null,
      totalVideosProd: 0,
      errors: []
    };
  }

  // Initialize all scheduled tasks
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

  // Schedule daily video generation
  private setupDailyVideoGeneration(): void {
    // Run every day at 9 AM UTC
    const dailyTask = cron.schedule('0 9 * * *', async () => {
      await this.generateDailyContent();
    }, {
      scheduled: false,
      timezone: "UTC"
    });

    // Also run every 6 hours for more frequent content
    const frequentTask = cron.schedule('0 */6 * * *', async () => {
      await this.generateDailyContent();
    }, {
      scheduled: false,
      timezone: "UTC"
    });

    this.tasks.push(dailyTask, frequentTask);
    logger.info('📅 Daily video generation scheduled');
  }

  // Schedule trending video analysis
  private setupTrendingAnalysis(): void {
    // Run every 2 hours
    const trendingTask = cron.schedule('0 */2 * * *', async () => {
      await this.analyzeTrendingContent();
    }, {
      scheduled: false,
      timezone: "UTC"
    });

    this.tasks.push(trendingTask);
    logger.info('📈 Trending analysis scheduled');
  }

  // Schedule performance monitoring
  private setupPerformanceMonitoring(): void {
    // Run every hour
    const monitoringTask = cron.schedule('0 * * * *', async () => {
      await this.monitorPerformance();
    }, {
      scheduled: false,
      timezone: "UTC"
    });

    this.tasks.push(monitoringTask);
    logger.info('📊 Performance monitoring scheduled');
  }

  // Schedule cleanup tasks
  private setupCleanupTasks(): void {
    // Run daily at 2 AM UTC
    const cleanupTask = cron.schedule('0 2 * * *', async () => {
      await this.performCleanup();
    }, {
      scheduled: false,
      timezone: "UTC"
    });

    this.tasks.push(cleanupTask);
    logger.info('🧹 Cleanup tasks scheduled');
  }

  // Start all scheduled tasks
  public start(): void {
    try {
      this.tasks.forEach(task => task.start());
      this.status.isRunning = true;
      // This nextRun logic might need refinement based on actual task schedules
      this.status.nextRun = new Date(Date.now() + 60 * 60 * 1000); // Placeholder: next hour
      
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

  // Generate daily content and produce a video
  private async generateDailyContent(): Promise<void> {
    // Prevent multiple instances of this task from running concurrently
    if (this.status.isRunning) {
      logger.info('⚠️ Content generation task already running, skipping...');
      return;
    }

    this.status.isRunning = true;
    this.status.lastRun = new Date();

    try {
      logger.info('🎬 Starting daily content generation and video production...');

      // Step 1: Hunt for trending topics (ContentEngine method does not take args)
      const trendingTopics = await this.contentEngine.huntTrendingVideos(); 

      if (!trendingTopics || trendingTopics.length === 0) {
        throw new Error('No trending topics found');
      }

      // Step 2: Select the first trending topic as the inspiration
      const selectedTopic = trendingTopics[0];
      logger.info(`📝 Selected topic for inspiration: ${selectedTopic.title}`);

      // Step 3: Generate content script using trending topics
      // ContentEngine's analyzeAndGenerateContent takes TrendingVideo[] and returns VideoScript[]
      const generatedScripts = await this.contentEngine.analyzeAndGenerateContent(trendingTopics);

      if (!generatedScripts || generatedScripts.length === 0) {
        throw new Error('Content script generation failed');
      }

      // For this run, let's focus on the first generated script
      const videoScript = generatedScripts[0]; 
      logger.info(`📝 Generated script for: "${videoScript.title}"`);

      // Step 4: Produce video from the generated script
      // Ensure VideoProducer.createVideo returns a structure like VideoProductionResult
      const videoProductionResult: VideoProductionResult = await this.videoProducer.createVideo(
        videoScript // Pass the entire VideoScript object
      );

      // Check if video production was successful and has an ID
      if (videoProductionResult && videoProductionResult.success && videoProductionResult.videoId) {
        logger.info(`✅ Video produced successfully: ID ${videoProductionResult.videoId}`);
        
        this.status.totalVideosProd++; // Increment counter
        
        // Log the video creation to the database
        await this.logVideoCreation(videoProductionResult.videoId, selectedTopic.title);
      } else {
        // Throw error if production failed or didn't yield an ID
        const errorMessage = videoProductionResult?.error || 'Video production failed, no videoId provided.';
        throw new Error(errorMessage);
      }

    } catch (error: any) {
      logger.error('❌ Daily content generation/production failed:', error);
      this.status.errors.push(`Content generation/production error: ${error.message}`);
    } finally {
      this.status.isRunning = false; // Mark task as finished
    }
  }

  // Analyze trending content and store data
  private async analyzeTrendingContent(): Promise<void> {
    try {
      logger.info('📈 Analyzing trending content...');

      // Hunt for trending videos (this method doesn't take args)
      const trendingVideos = await this.contentEngine.huntTrendingVideos();
      
      if (trendingVideos && trendingVideos.length > 0) {
        // Store trending analysis in database
        if (supabase) {
          // Ensure your 'trending_analysis' table has these columns: analyzed_at, video_count, top_categories, analysis_data
          await supabase
            .from('trending_analysis')
            .insert({
              analyzed_at: new Date().toISOString(),
              video_count: trendingVideos.length,
              top_categories: this.extractCategories(trendingVideos), // Your helper method
              analysis_data: trendingVideos // Store the full data
            });
        }

        logger.info(`📊 Analyzed ${trendingVideos.length} trending videos`);
      } else {
        logger.warn('No trending videos found for analysis.');
      }

    } catch (error: any) {
      logger.error('❌ Trending analysis failed:', error);
      this.status.errors.push(`Trending analysis error: ${error.message}`);
    }
  }

  // Monitor performance metrics and store them
  private async monitorPerformance(): Promise<void> {
    try {
      logger.info('📊 Monitoring performance...');

      const stats = {
        totalVideos: this.status.totalVideosProd,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        errorCount: this.status.errors.length,
        lastRun: this.status.lastRun,
        timestamp: new Date().toISOString()
      };

      // Store performance metrics
      if (supabase) {
        // Ensure your 'performance_metrics' table has these columns: totalVideos, uptime, memoryUsage, errorCount, lastRun, timestamp
        await supabase
          .from('performance_metrics')
          .insert(stats);
      }

      logger.info('📈 Performance metrics recorded');

    } catch (error: any) {
      logger.error('❌ Performance monitoring failed:', error);
      this.status.errors.push(`Performance monitoring error: ${error.message}`);
    }
  }

  // Perform cleanup tasks (e.g., deleting old files, database records)
  private async performCleanup(): Promise<void> {
    try {
      logger.info('🧹 Performing cleanup...');

      // Clean up old temporary files (if VideoProducer creates temporary files)
      // You might need to tell VideoProducer to clean up its temp dir
      if (this.videoProducer && typeof this.videoProducer.cleanup === 'function') {
        await this.videoProducer.cleanup();
      } else {
        logger.warn('VideoProducer does not have a cleanup method.');
      }

      // Clear old errors (keep only last 10)
      if (this.status.errors.length > 10) {
        this.status.errors = this.status.errors.slice(-10);
      }

      // Clean up old database records (older than 30 days)
      if (supabase) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Assuming 'timestamp' column in 'performance_metrics'
        await supabase
          .from('performance_metrics')
          .delete()
          .lt('timestamp', thirtyDaysAgo.toISOString());

        // Assuming 'analyzed_at' column in 'trending_analysis'
        await supabase
          .from('trending_analysis')
          .delete()
          .lt('analyzed_at', thirtyDaysAgo.toISOString());
      }

      logger.info('✅ Cleanup completed');

    } catch (error: any) {
      logger.error('❌ Cleanup failed:', error);
      this.status.errors.push(`Cleanup error: ${error.message}`);
    }
  }

  // Helper method to extract categories from trending videos for analysis summary
  private extractCategories(videos: any[]): string[] {
    // Assuming each video object has a 'category' property
    const categories = videos
      .map((video: any) => video.category || 'Uncategorized')
      .reduce((acc: { [key: string]: number }, cat: string) => {
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});

    // Sort categories by count and return top 5
    return Object.keys(categories)
      .sort((a, b) => categories[b] - categories[a])
      .slice(0, 5);
  }

  // Log video creation success to the database
  private async logVideoCreation(videoId: string, topic: string): Promise<void> {
    try {
      if (supabase) {
        // Ensure 'video_logs' table has: video_id, topic, created_at, status
        await supabase
          .from('video_logs')
          .insert({
            video_id: videoId,
            topic: topic,
            created_at: new Date().toISOString(),
            status: 'produced' // Mark as produced, not uploaded yet
          });
      }
    } catch (error: any) {
      logger.error('❌ Failed to log video creation:', error);
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
  public async triggerContentGeneration(): Promise<VideoProcessingResult> {
    try {
      await this.generateDailyContent();
      // This trigger doesn't directly return the videoId, just confirms the process ran.
      // You might want to adjust this to return actual results if needed.
      return { success: true, message: "Content generation and video production initiated." };
    } catch (error: any) {
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
