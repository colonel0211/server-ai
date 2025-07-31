import cron from 'node-cron';
import contentGenerator from './contentGenerator';
import youtubeService from './youtubeService';
import videoProducer from './videoProducer';
import { supabase } from '../config/supabase';

export interface AutomationConfig {
  enabled: boolean;
  schedule: string; // Cron expression
  videosPerDay: number;
  niche: string;
  uploadSchedule: string[];
  qualityCheck: boolean;
}

export interface VideoJob {
  id: string;
  status: 'pending' | 'generating' | 'producing' | 'uploading' | 'completed' | 'failed';
  title: string;
  scheduled_time: Date;
  created_at: Date;
  completed_at?: Date;
  video_url?: string;
  error_message?: string;
}

class AutomationScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;
  private config: AutomationConfig = {
    enabled: false,
    schedule: '0 */6 * * *', // Every 6 hours
    videosPerDay: 4,
    niche: 'technology',
    uploadSchedule: ['09:00', '13:00', '17:00', '21:00'],
    qualityCheck: true
  };

  constructor() {
    this.loadConfig();
    console.log('🤖 Automation Scheduler initialized');
  }

  /**
   * Start the automation system
   */
  async start(config?: Partial<AutomationConfig>): Promise<void> {
    try {
      if (config) {
        this.config = { ...this.config, ...config };
      }

      if (!youtubeService.isConfigured() || !youtubeService.isAuthenticated()) {
        throw new Error('YouTube service not properly configured or authenticated');
      }

      if (!contentGenerator.isConfigured()) {
        throw new Error('Content generator not configured (missing OpenAI API key)');
      }

      // Stop any existing jobs
      this.stop();

      // Schedule main content generation job
      const mainJob = cron.schedule(this.config.schedule, async () => {
        await this.generateDailyContent();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.jobs.set('main', mainJob);

      // Schedule upload jobs based on upload schedule
      this.config.uploadSchedule.forEach((time, index) => {
        const [hour, minute] = time.split(':');
        const cronExpression = `${minute} ${hour} * * *`; // Daily at specified time

        const uploadJob = cron.schedule(cronExpression, async () => {
          await this.processUploadQueue();
        }, {
          scheduled: false,
          timezone: 'UTC'
        });

        this.jobs.set(`upload-${index}`, uploadJob);
      });

      // Start all jobs
      this.jobs.forEach(job => job.start());
      this.isRunning = true;

      console.log('🚀 Automation started with config:', this.config);
      
      // Generate initial content if queue is empty
      const queueSize = await this.getQueueSize();
      if (queueSize === 0) {
        console.log('📝 Generating initial content batch...');
        await this.generateDailyContent();
      }

    } catch (error: any) {
      console.error('❌ Failed to start automation:', error.message);
      throw error;
    }
  }

  /**
   * Stop the automation system
   */
  stop(): void {
    this.jobs.forEach((job, key) => {
      job.destroy();
      this.jobs.delete(key);
    });
    
    this.isRunning = false;
    console.log('⏹️ Automation stopped');
  }

  /**
   * Generate daily content batch
   */
  private async generateDailyContent(): Promise<void> {
    try {
      console.log('🎬 Starting daily content generation...');

      // Generate video ideas
      const ideas = await contentGenerator.generateVideoIdeas(
        this.config.niche, 
        this.config.videosPerDay
      );

      console.log(`💡 Generated ${ideas.length} video ideas`);

      // Create jobs for each idea
      for (const idea of ideas) {
        await this.createVideoJob(idea);
      }

      console.log('✅ Daily content generation completed');

    } catch (error: any) {
      console.error('❌ Daily content generation failed:', error.message);
      await this.logError('content_generation', error.message);
    }
  }

  /**
   * Create a video production job
   */
  private async createVideoJob(idea: any): Promise<string> {
    try {
      // Generate full script
      const script = await contentGenerator.generateScript(idea.title);
      
      // Generate SEO optimized metadata
      const description = await contentGenerator.generateDescription(idea.title, script.full_script);
      const tags = await contentGenerator.generateTags(idea.title, description);

      const jobData = {
        id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'pending',
        title: idea.title,
        description,
        tags,
        script: script.full_script,
        hook: script.hook,
        niche: this.config.niche,
        scheduled_time: this.getNextUploadSlot(),
        created_at: new Date()
      };

      // Save to database
      const { error } = await supabase
        .from('video_jobs')
        .insert([jobData]);

      if (error) throw error;

      console.log(`📋 Created video job: ${jobData.title}`);
      return jobData.id;

    } catch (error: any) {
      console.error('❌ Failed to create video job:', error.message);
      throw error;
    }
  }

  /**
   * Process the upload queue
   */
  private async processUploadQueue(): Promise<void> {
    try {
      console.log('🚀 Processing upload queue...');

      // Get pending jobs ready for upload
      const { data: jobs, error } = await supabase
        .from('video_jobs')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_time', new Date().toISOString())
        .order('scheduled_time', { ascending: true })
        .limit(1);

      if (error) throw error;

      if (!jobs || jobs.length === 0) {
        console.log('📭 No videos ready for upload');
        return;
      }

      const job = jobs[0];
      await this.processVideoJob(job);

    } catch (error: any) {
      console.error('❌ Upload queue processing failed:', error.message);
      await this.logError('upload_queue', error.message);
    }
  }

  /**
   * Process a single video job
   */
  private async processVideoJob(job: VideoJob): Promise<void> {
    try {
      console.log(`🎬 Processing video job: ${job.title}`);

      // Update status to generating
      await this.updateJobStatus(job.id, 'generating');

      // Generate video
      const videoPath = await videoProducer.createVideo({
        title: job.title,
        script: (job as any).script,
        hook: (job as any).hook,
        niche: (job as any).niche
      });

      // Update status to uploading
      await this.updateJobStatus(job.id, 'uploading');

      // Upload to YouTube
      const uploadResult = await youtubeService.uploadVideo(videoPath, {
        title: job.title,
        description: (job as any).description,
        tags: (job as any).tags,
        categoryId: this.getCategoryId((job as any).niche),
        privacyStatus: 'public'
      });

      if (uploadResult.success) {
        await this.updateJobStatus(job.id, 'completed', {
          video_url: uploadResult.videoUrl,
          completed_at: new Date()
        });

        console.log(`✅ Video uploaded successfully: ${uploadResult.videoUrl}`);
        
        // Clean up video file
        await videoProducer.cleanup(videoPath);

      } else {
        await this.updateJobStatus(job.id, 'failed', {
          error_message: error.message
      });
    }
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(jobId: string, status: string, additionalData?: any): Promise<void> {
    const updateData = {
      status,
      updated_at: new Date(),
      ...additionalData
    };

    const { error } = await supabase
      .from('video_jobs')
      .update(updateData)
      .eq('id', jobId);

    if (error) {
      console.error('❌ Failed to update job status:', error.message);
    }
  }

  /**
   * Get next available upload slot
   */
  private getNextUploadSlot(): Date {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Find next available time slot
    for (const timeSlot of this.config.uploadSchedule) {
      const [hour, minute] = timeSlot.split(':').map(Number);
      const slotTime = new Date(today);
      slotTime.setHours(hour, minute, 0, 0);
      
      if (slotTime > now) {
        return slotTime;
      }
    }
    
    // If no slot today, use first slot tomorrow
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const [hour, minute] = this.config.uploadSchedule[0].split(':').map(Number);
    tomorrow.setHours(hour, minute, 0, 0);
    
    return tomorrow;
  }

  /**
   * Get category ID for niche
   */
  private getCategoryId(niche: string): string {
    const categories: { [key: string]: string } = {
      'technology': '28',
      'education': '27',
      'entertainment': '24',
      'gaming': '20',
      'music': '10',
      'news': '25',
      'sports': '17',
      'comedy': '23',
      'lifestyle': '22'
    };
    
    return categories[niche.toLowerCase()] || '28'; // Default to Science & Technology
  }

  /**
   * Get current queue size
   */
  private async getQueueSize(): Promise<number> {
    const { count, error } = await supabase
      .from('video_jobs')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'generating', 'producing']);

    return error ? 0 : (count || 0);
  }

  /**
   * Log errors for monitoring
   */
  private async logError(type: string, message: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('automation_logs')
        .insert([{
          type: 'error',
          category: type,
          message,
          timestamp: new Date()
        }]);

      if (error) console.error('Failed to log error:', error.message);
    } catch (err) {
      console.error('Failed to log error:', err);
    }
  }

  /**
   * Load configuration from database
   */
  private async loadConfig(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('automation_config')
        .select('*')
        .single();

      if (data && !error) {
        this.config = { ...this.config, ...data };
      }
    } catch (error) {
      console.log('Using default automation config');
    }
  }

  /**
   * Update configuration
   */
  async updateConfig(newConfig: Partial<AutomationConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    
    // Save to database
    const { error } = await supabase
      .from('automation_config')
      .upsert([this.config]);

    if (error) {
      console.error('Failed to save config:', error.message);
    }

    // Restart automation with new config
    if (this.isRunning) {
      await this.start();
    }
  }

  /**
   * Get automation status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      activeJobs: this.jobs.size,
      nextRun: this.getNextUploadSlot()
    };
  }

  /**
   * Get recent jobs
   */
  async getRecentJobs(limit: number = 10): Promise<VideoJob[]> {
    const { data, error } = await supabase
      .from('video_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    return error ? [] : (data || []);
  }

  /**
   * Manual trigger for immediate content generation
   */
  async triggerContentGeneration(count: number = 1): Promise<void> {
    console.log(`🎯 Manual trigger: generating ${count} videos`);
    
    const ideas = await contentGenerator.generateVideoIdeas(this.config.niche, count);
    
    for (const idea of ideas) {
      await this.createVideoJob(idea);
    }
  }
}

export default new AutomationScheduler();: uploadResult.error
        });
        console.error(`❌ Video upload failed: ${uploadResult.error}`);
      }

    } catch (error: any) {
      console.error(`❌ Video job processing failed: ${error.message}`);
      await this.updateJobStatus(job.id, 'failed', {
        error_message
