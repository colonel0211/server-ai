// src/services/automationScheduler.ts - FIXED VERSION
import cron from 'node-cron';
import { YouTubeContentEngine } from './ContentEngine';
import { VideoProducer } from './videoProducer';
import supabase from '../config/database';
import { logger } from '../utils/logger';

interface ScheduleStatus {
  isRunning: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  totalVideosProd: number; // FIXED: Changed from totalVideosProduced
  errors: string[];
}

interface ContentResult {
  success: boolean;
  videoId?: string;
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
      totalVideosProd: 0, // FIXED: Changed from totalVideosProduced
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
    // Run every day at 9 AM
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
    // Run daily at 2 AM
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
      this.status.nextRun = new Date(Date.now() + 60 * 60 * 1000); // Next hour
      
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

  // Generate daily content
  private async generateDailyContent(): Promise<void> {
    if (this.status.isRunning) {
      logger.info('⚠️ Content generation already running, skipping...');
      return;
    }

    this.status.isRunning = true;
    this.status.lastRun = new Date();

    try {
      logger.info('🎬 Starting daily content generation...');

      // Step 1: Find trending topics
      const trendingTopics = await this.contentEngine.huntTrendingVideos(10); // FIXED: Changed from findTrendingVideos

      if (!trendingTopics || trendingTopics.length === 0) {
        throw new Error('No trending topics found');
      }

      // Step 2: Select best topic
      const selectedTopic = trendingTopics[0];
      logger.info(`📝 Selected topic: ${selectedTopic.title}`);

      // Step 3: Generate content based on trending topic
      const contentResult = await this.contentEngine.generateVideoContent({ // FIXED: Changed from generateContent
        topic: selectedTopic.title,
        style: 'educational',
        duration: 60,
        audience: 'general'
      });

      if (!contentResult.success) {
        throw new Error('Content generation failed');
      }

      // Step 4: Produce video
      const videoResult = await this.videoProducer.createVideo(
        contentResult.script || '',
        {
          title: contentResult.title || selectedTopic.title,
          description: contentResult.description || '',
          style: 'modern',
          duration: 60
        }
      );

      if (videoResult.success && videoResult.videoId) { // FIXED: Check for success first
        logger.info(`✅ Video created successfully: ${videoResult.videoId}`);
        
        this.status.totalVideosProd++; // FIXED: Changed from totalVideosProduced
        
        // Log success to database
        await this.logVideoCreation(videoResult.videoId, selectedTopic.title);
      } else {
        throw new Error('Video production failed');
      }

    } catch (error: any) {
      logger.error('❌ Daily content generation failed:', error);
      this.status.errors.push(`Content generation error: ${error.message}`);
    } finally {
      this.status.isRunning = false;
    }
  }

  // Analyze trending content
  private async analyzeTrendingContent(): Promise<void> {
    try {
      logger.info('📈 Analyzing trending content...');

      const trendingVideos = await this.contentEngine.huntTrendingVideos(20);
      
      if (trendingVideos && trendingVideos.length > 0) {
        // Store trending analysis in database
        if (supabase) {
          await supabase
            .from('trending_analysis')
            .insert({
              analyzed_at: new Date().toISOString(),
              video_count: trendingVideos.length,
              top_categories: this.extractCategories(trendingVideos),
              analysis_data: trendingVideos
            });
        }

        logger.info(`📊 Analyzed ${trendingVideos.length} trending videos`);
      }

    } catch (error: any) {
      logger.error('❌ Trending analysis failed:', error);
      this.status.errors.push(`Trending analysis error: ${error.message}`);
    }
  }

  // Monitor performance
  private async monitorPerformance(): Promise<void> {
    try {
      logger.info('📊 Monitoring performance...');

      const stats = {
        totalVideos: this.status.totalVideosProd, // FIXED: Changed from totalVideosProduced
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        errorCount: this.status.errors.length,
        lastRun: this.status.lastRun,
        timestamp: new Date().toISOString()
      };

      // Store performance metrics
      if (supabase) {
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

  // Perform cleanup tasks
  private async performCleanup(): Promise<void> {
    try {
      logger.info('🧹 Performing cleanup...');

      // Clean up old temporary files
      await this.videoProducer.cleanup();

      // Clear old errors (keep only last 10)
      if (this.status.errors.length > 10) {
        this.status.errors = this.status.errors.slice(-10);
      }

      // Clean up old database records (older than 30 days)
      if (supabase) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        await supabase
          .from('performance_metrics')
          .delete()
          .lt('timestamp', thirtyDaysAgo.toISOString());

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

  // Helper method to extract categories from trending videos
  private extractCategories(videos: any[]): string[] {
    const categories = videos
      .map((video: any) => video.category || 'General')
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
      if (supabase) {
        await supabase
          .from('video_logs')
          .insert({
            video_id: videoId,
            topic: topic,
            created_at: new Date().toISOString(),
            status: 'completed'
          });
      }
    } catch (error: any) {
      logger.error('❌ Failed to log video creation:', error);
    }
  }

  // Get current status
  public getStatus(): ScheduleStatus {
    return { ...this.status };
  }

  // Get scheduler statistics
  public getStats() {
    return {
      isRunning: this.status.isRunning,
      totalVideosProduced: this.status.totalVideosProd, // FIXED: Changed from totalVideosProduced
      lastRun: this.status.lastRun,
      nextRun: this.status.nextRun,
      errorCount: this.status.errors.length,
      uptime: process.uptime(),
      activeTasks: this.tasks.length
    };
  }

  // Manual trigger for content generation
  public async triggerContentGeneration(): Promise<ContentResult> {
    try {
      await this.generateDailyContent();
      return { success: true };
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
