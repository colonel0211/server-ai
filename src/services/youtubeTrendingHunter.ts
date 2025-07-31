import youtubeService from './youtubeService';
import contentGenerator from './contentGenerator';
import { supabase } from '../config/supabase';

export interface TrendingVideo {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  tags: string[];
  categoryId: string;
  duration: string;
  thumbnailUrl: string;
  engagement_rate: number;
  trend_score: number;
}

export interface ContentOpportunity {
  id: string;
  original_video: TrendingVideo;
  suggested_title: string;
  suggested_description: string;
  suggested_tags: string[];
  content_angle: string;
  script_outline: string;
  estimated_views: number;
  competition_level: 'low' | 'medium' | 'high';
  created_at: Date;
  status: 'identified' | 'selected' | 'in_production' | 'published';
}

class YouTubeTrendingHunter {
  private minViews: number = 500000; // 500k+ views requirement
  private huntingActive: boolean = false;
  private categories: string[] = ['28', '27', '24', '22', '25']; // Tech, Education, Entertainment, Lifestyle, News

  constructor() {
    console.log('🎯 YouTube Trending Hunter AI Agent initialized');
  }

  /**
   * Start hunting for trending videos (similar to your Instagram agent)
   */
  async startHunting(options?: {
    minViews?: number;
    categories?: string[];
    regions?: string[];
    huntInterval?: number;
  }): Promise<void> {
    try {
      if (options?.minViews) this.minViews = options.minViews;
      if (options?.categories) this.categories = options.categories;

      this.huntingActive = true;
      console.log(`🔍 Starting YouTube trending hunt with ${this.minViews}+ views requirement`);

      // Hunt for trending content every 2 hours
      const huntInterval = options?.huntInterval || 2 * 60 * 60 * 1000; // 2 hours
      
      setInterval(async () => {
        if (this.huntingActive) {
          await this.huntTrendingVideos();
        }
      }, huntInterval);

      // Run initial hunt
      await this.huntTrendingVideos();

    } catch (error: any) {
      console.error('❌ Failed to start trending hunt:', error.message);
      throw error;
    }
  }

  /**
   * Hunt for trending videos across categories
   */
  private async huntTrendingVideos(): Promise<void> {
    try {
      console.log('🎯 Hunting for trending videos...');
      const allTrendingVideos: TrendingVideo[] = [];

      // Hunt in each category
      for (const categoryId of this.categories) {
        const trendingInCategory = await this.getTrendingInCategory(categoryId);
        allTrendingVideos.push(...trendingInCategory);
      }

      // Filter by view count and calculate trend scores
      const qualifiedVideos = allTrendingVideos
        .filter(video => video.viewCount >= this.minViews)
        .map(video => ({
          ...video,
          trend_score: this.calculateTrendScore(video),
          engagement_rate: this.calculateEngagementRate(video)
        }))
        .sort((a, b) => b.trend_score - a.trend_score)
        .slice(0, 20); // Top 20 trending videos

      console.log(`🎬 Found ${qualifiedVideos.length} trending videos with ${this.minViews}+ views`);

      // Analyze each video for content opportunities
      for (const video of qualifiedVideos) {
        await this.analyzeContentOpportunity(video);
      }

      // Store trending data
      await this.storeTrendingData(qualifiedVideos);

    } catch (error: any) {
      console.error('❌ Trending hunt failed:', error.message);
    }
  }

  /**
   * Get trending videos in specific category
   */
  private async getTrendingInCategory(categoryId: string): Promise<TrendingVideo[]> {
    try {
      const trendingVideos = await youtubeService.getTrendingVideos('US', categoryId);
      const processedVideos: TrendingVideo[] = [];

      for (const video of trendingVideos) {
        // Get detailed video statistics
        const videoDetails = await this.getVideoDetails(video.id);
        if (videoDetails) {
          processedVideos.push(videoDetails);
        }
      }

      return processedVideos;

    } catch (error: any) {
      console.error(`❌ Failed to get trending videos for category ${categoryId}:`, error.message);
      return [];
    }
  }

  /**
   * Get detailed video information
   */
  private async getVideoDetails(videoId: string): Promise<TrendingVideo | null> {
    try {
      const response = await youtubeService.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: videoId
      });

      const video = response.data.items[0];
      if (!video) return null;

      return {
        videoId: video.id,
        title: video.snippet.title,
        description: video.snippet.description || '',
        channelTitle: video.snippet.channelTitle,
        publishedAt: video.snippet.publishedAt,
        viewCount: parseInt(video.statistics.viewCount || '0'),
        likeCount: parseInt(video.statistics.likeCount || '0'),
        commentCount: parseInt(video.statistics.commentCount || '0'),
        tags: video.snippet.tags || [],
        categoryId: video.snippet.categoryId,
        duration: video.contentDetails.duration,
        thumbnailUrl: video.snippet.thumbnails.maxres?.url || video.snippet.thumbnails.high.url,
        engagement_rate: 0, // Will be calculated
        trend_score: 0 // Will be calculated
      };

    } catch (error: any) {
      console.error(`❌ Failed to get video details for ${videoId}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate trend score (similar to your engagement analysis)
   */
  private calculateTrendScore(video: TrendingVideo): number {
    const publishDate = new Date(video.publishedAt).getTime();
    const now = Date.now();
    const ageInHours = (now - publishDate) / (1000 * 60 * 60);

    // Videos trending faster get higher scores
    const velocityScore = video.viewCount / Math.max(ageInHours, 1);
    const engagementScore = (video.likeCount + video.commentCount) / video.viewCount;
    const recencyBonus = Math.max(0, (168 - ageInHours) / 168); // Bonus for videos under 1 week

    return (velocityScore * 0.6) + (engagementScore * 1000 * 0.3) + (recencyBonus * 100 * 0.1);
  }

  /**
   * Calculate engagement rate
   */
  private calculateEngagementRate(video: TrendingVideo): number {
    return ((video.likeCount + video.commentCount) / video.viewCount) * 100;
  }

  /**
   * Analyze content opportunity (like your content angle detection)
   */
  private async analyzeContentOpportunity(video: TrendingVideo): Promise<void> {
    try {
      // Check if we already analyzed this video
      const { data: existing } = await supabase
        .from('content_opportunities')
        .select('id')
        .eq('original_video_id', video.videoId)
        .single();

      if (existing) return; // Already analyzed

      console.log(`🔍 Analyzing content opportunity: ${video.title}`);

      // Generate content angles using AI
      const contentAngles = await this.generateContentAngles(video);
      
      for (const angle of contentAngles) {
        const opportunity: Omit<ContentOpportunity, 'id' | 'created_at'> = {
          original_video: video,
          suggested_title: angle.title,
          suggested_description: angle.description,
          suggested_tags: angle.tags,
          content_angle: angle.angle,
          script_outline: angle.script_outline,
          estimated_views: this.estimateViews(video, angle.competition_level),
          competition_level: angle.competition_level,
          status: 'identified'
        };

        // Store opportunity
        await this.storeContentOpportunity(opportunity);
      }

    } catch (error: any) {
      console.error(`❌ Failed to analyze content opportunity for ${video.videoId}:`, error.message);
    }
  }

  /**
   * Generate content angles using AI (similar to your script generation)
   */
  private async generateContentAngles(video: TrendingVideo): Promise<any[]> {
    try {
      const prompt = `Analyze this trending YouTube video and create 3 unique content angles for new videos:

      Original Video:
      Title: "${video.title}"
      Description: "${video.description.substring(0, 500)}..."
      Views: ${video.viewCount.toLocaleString()}
      Category: ${video.categoryId}
      Tags: ${video.tags.join(', ')}

      For each angle, provide:
      1. New unique title (different but related topic)
      2. Content angle/approach
      3. Brief description
      4. 10 relevant tags
      5. Script outline (5 main points)
      6. Competition level (low/medium/high)
      7. Why this angle will work

      Focus on:
      - Different perspectives on the same topic
      - Updated/current information
      - Beginner-friendly versions
      - Advanced deep-dives
      - Contrarian viewpoints
      - Solution-focused content

      Return as JSON array with objects containing: title, angle, description, tags, script_outline, competition_level, reasoning`;

      const response = await contentGenerator.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a viral YouTube content strategist. Analyze trending videos and create unique, non-competing content angles that can also go viral.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 3000
      });

      const content = response.choices[0].message.content;
      return JSON.parse(content || '[]');

    } catch (error: any) {
      console.error('❌ Failed to generate content angles:', error.message);
      return [];
    }
  }

  /**
   * Estimate potential views based on competition
   */
  private estimateViews(originalVideo: TrendingVideo, competitionLevel: string): number {
    const baseViews = originalVideo.viewCount;
    
    const multipliers = {
      'low': 0.7,      // 70% of original views
      'medium': 0.4,   // 40% of original views  
      'high': 0.2      // 20% of original views
    };

    return Math.floor(baseViews * (multipliers[competitionLevel as keyof typeof multipliers] || 0.3));
  }

  /**
   * Store content opportunity in database
   */
  private async storeContentOpportunity(opportunity: Omit<ContentOpportunity, 'id' | 'created_at'>): Promise<void> {
    try {
      const { error } = await supabase
        .from('content_opportunities')
        .insert([{
          ...opportunity,
          id: `opp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          original_video_id: opportunity.original_video.videoId,
          created_at: new Date()
        }]);

      if (error) throw error;

    } catch (error: any) {
      console.error('❌ Failed to store content opportunity:', error.message);
    }
  }

  /**
   * Store trending data for analysis
   */
  private async storeTrendingData(videos: TrendingVideo[]): Promise<void> {
    try {
      const trendingData = videos.map(video => ({
        video_id: video.videoId,
        title: video.title,
        channel_title: video.channelTitle,
        view_count: video.viewCount,
        engagement_rate: video.engagement_rate,
        trend_score: video.trend_score,
        category_id: video.categoryId,
        published_at: video.publishedAt,
        analyzed_at: new Date()
      }));

      const { error } = await supabase
        .from('trending_videos')
        .upsert(trendingData, { onConflict: 'video_id' });

      if (error) throw error;

      console.log(`📊 Stored ${videos.length} trending videos data`);

    } catch (error: any) {
      console.error('❌ Failed to store trending data:', error.message);
    }
  }

  /**
   * Get best content opportunities (for manual selection or auto-production)
   */
  async getBestOpportunities(limit: number = 10): Promise<ContentOpportunity[]> {
    try {
      const { data, error } = await supabase
        .from('content_opportunities')
        .select('*')
        .eq('status', 'identified')
        .gte('estimated_views', 100000) // Minimum 100k estimated views
        .order('estimated_views', { ascending: false })
        .limit(limit);

      return error ? [] : (data || []);

    } catch (error: any) {
      console.error('❌ Failed to get content opportunities:', error.message);
      return [];
    }
  }

  /**
   * Auto-select best opportunities for production
   */
  async autoSelectForProduction(count: number = 3): Promise<ContentOpportunity[]> {
    try {
      const opportunities = await this.getBestOpportunities(count * 2);
      
      // Filter for best opportunities (low competition, high estimated views)
      const selected = opportunities
        .filter(opp => opp.competition_level === 'low' || opp.estimated_views > 500000)
        .slice(0, count);

      // Mark as selected
      for (const opp of selected) {
        await supabase
          .from('content_opportunities')
          .update({ status: 'selected' })
          .eq('id', opp.id);
      }

      console.log(`🎯 Auto-selected ${selected.length} opportunities for production`);
      return selected;

    } catch (error: any) {
      console.error('❌ Failed to auto-select opportunities:', error.message);
      return [];
    }
  }

  /**
   * Stop hunting
   */
  stopHunting(): void {
    this.huntingActive = false;
    console.log('⏹️ YouTube trending hunt stopped');
  }

  /**
   * Get hunting status
   */
  getStatus() {
    return {
      isHunting: this.huntingActive,
      minViews: this.minViews,
      categories: this.categories,
      lastHunt: new Date() // This should be tracked properly
    };
  }
}

export default new YouTubeTrendingHunter();
