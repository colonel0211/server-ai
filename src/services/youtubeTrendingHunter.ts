import { google } from 'googleapis';
import { ContentGenerator } from './contentGenerator';
import supabase from '../config/database';
import { logger } from '../utils/logger';

export class YouTubeService {
  public youtube: any; // FIXED: Changed from private to public
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('⚠️ YouTube API key not found. Trending analysis will be limited.');
    }
    
    this.youtube = google.youtube({
      version: 'v3',
      auth: this.apiKey
    });
  }

  async getTrendingVideos(maxResults: number = 50): Promise<any[]> {
    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        chart: 'mostPopular',
        regionCode: 'US',
        maxResults: maxResults,
        videoCategoryId: '0' // All categories
      });

      return response.data.items || [];
    } catch (error: any) {
      logger.error('❌ Failed to fetch trending videos:', error);
      return [];
    }
  }

  async getVideoDetails(videoId: string): Promise<any> {
    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: [videoId]
      });

      return response.data.items?.[0] || null;
    } catch (error: any) {
      logger.error(`❌ Failed to fetch video details for ${videoId}:`, error);
      return null;
    }
  }

  async searchVideos(query: string, maxResults: number = 25): Promise<any[]> {
    try {
      const response = await this.youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        maxResults: maxResults,
        order: 'relevance',
        publishedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // Last 7 days
      });

      return response.data.items || [];
    } catch (error: any) {
      logger.error(`❌ Failed to search videos for "${query}":`, error);
      return [];
    }
  }
}

export class YouTubeTrendingHunter {
  private youtubeService: YouTubeService;
  private contentGenerator: ContentGenerator;

  constructor() {
    this.youtubeService = new YouTubeService();
    this.contentGenerator = new ContentGenerator();
  }

  // Hunt for trending videos and analyze them
  async huntTrendingVideos(limit: number = 50): Promise<any[]> {
    try {
      logger.info('🔍 Hunting for trending videos...');

      // Get trending videos from YouTube API
      const trendingVideos = await this.youtubeService.getTrendingVideos(limit);

      if (!trendingVideos || trendingVideos.length === 0) {
        logger.warn('⚠️ No trending videos found');
        return [];
      }

      // Process and analyze each video
      const analyzedVideos = await Promise.all(
        trendingVideos.map(async (video) => {
          return await this.analyzeVideo(video);
        })
      );

      // Filter out failed analyses and sort by engagement score
      const validVideos = analyzedVideos
        .filter(video => video !== null)
        .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0));

      // Store trending data in database
      if (supabase && validVideos.length > 0) {
        await supabase
          .from('trending_videos')
          .insert({
            analyzed_at: new Date().toISOString(),
            video_count: validVideos.length,
            videos_data: validVideos.slice(0, 20) // Store top 20
          });
      }

      logger.info(`✅ Successfully analyzed ${validVideos.length} trending videos`);
      return validVideos;

    } catch (error: any) {
      logger.error('❌ Failed to hunt trending videos:', error);
      return [];
    }
  }

  // Analyze a single video for content potential
  private async analyzeVideo(video: any): Promise<any> {
    try {
      const snippet = video.snippet || {};
      const statistics = video.statistics || {};
      const contentDetails = video.contentDetails || {};

      // Extract basic information
      const videoData = {
        id: video.id,
        title: snippet.title || 'Untitled',
        description: snippet.description || '',
        channelTitle: snippet.channelTitle || 'Unknown Channel',
        publishedAt: snippet.publishedAt,
        duration: contentDetails.duration,
        viewCount: parseInt(statistics.viewCount || '0'),
        likeCount: parseInt(statistics.likeCount || '0'),
        commentCount: parseInt(statistics.commentCount || '0'),
        category: snippet.categoryId,
        tags: snippet.tags || [],
        thumbnails: snippet.thumbnails
      };

      // Calculate engagement metrics
      const engagementScore = this.calculateEngagementScore(videoData);
      const contentScore = await this.analyzeContentPotential(videoData);

      // Get AI analysis of the content using public method
      const aiAnalysis = await this.contentGenerator.analyzeVideoContent(videoData); // FIXED: Access public method

      return {
        ...videoData,
        engagementScore,
        contentScore,
        aiAnalysis,
        trendingPotential: this.calculateTrendingPotential(videoData, engagementScore, contentScore),
        analyzedAt: new Date().toISOString()
      };

    } catch (error: any) {
      logger.error(`❌ Failed to analyze video ${video.id}:`, error);
      return null;
    }
  }

  // Calculate engagement score based on video metrics
  private calculateEngagementScore(video: any): number {
    try {
      const views = video.viewCount || 0;
      const likes = video.likeCount || 0;
      const comments = video.commentCount || 0;

      if (views === 0) return 0;

      // Calculate engagement rate
      const likeRate = likes / views;
      const commentRate = comments / views;
      
      // Weight the engagement score
      const engagementScore = (likeRate * 100) + (commentRate * 200);
      
      // Normalize to 0-100 scale
      return Math.min(Math.round(engagementScore * 1000), 100);

    } catch (error: any) {
      logger.error('❌ Failed to calculate engagement score:', error);
      return 0;
    }
  }

  // Analyze content potential for replication
  private async analyzeContentPotential(video: any): Promise<number> {
    try {
      let score = 50; // Base score

      // Title analysis
      if (video.title) {
        const title = video.title.toLowerCase();
        
        // Positive indicators
        if (title.includes('how to') || title.includes('tutorial')) score += 15;
        if (title.includes('tips') || title.includes('tricks')) score += 10;
        if (title.includes('beginner') || title.includes('guide')) score += 10;
        if (title.includes('explained') || title.includes('review')) score += 8;
        
        // Negative indicators
        if (title.includes('live') || title.includes('stream')) score -= 20;
        if (title.includes('part 2') || title.includes('episode')) score -= 10;
      }

      // View count analysis
      if (video.viewCount > 1000000) score += 20; // 1M+ views
      else if (video.viewCount > 100000) score += 15; // 100K+ views
      else if (video.viewCount > 10000) score += 10; // 10K+ views

      // Recency bonus
      const publishedAt = new Date(video.publishedAt);
      const daysSincePublished = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSincePublished <= 7) score += 15; // Published within a week
      else if (daysSincePublished <= 30) score += 10; // Published within a month

      // Tag analysis
      if (video.tags && video.tags.length > 0) {
        const educationalTags = ['tutorial', 'howto', 'guide', 'tips', 'learn', 'education'];
        const hasEducationalTags = video.tags.some((tag: string) => 
          educationalTags.some(eduTag => tag.toLowerCase().includes(eduTag))
        );
        if (hasEducationalTags) score += 10;
      }

      return Math.min(Math.max(score, 0), 100); // Clamp between 0-100

    } catch (error: any) {
      logger.error('❌ Failed to analyze content potential:', error);
      return 50; // Default score
    }
  }

  // Calculate overall trending potential
  private calculateTrendingPotential(video: any, engagementScore: number, contentScore: number): number {
    try {
      // Weighted average of different factors
      const weights = {
        engagement: 0.4,
        content: 0.3,
        recency: 0.2,
        popularity: 0.1
      };

      // Recency score
      const publishedAt = new Date(video.publishedAt);
      const daysSincePublished = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 100 - (daysSincePublished * 2)); // Decrease 2 points per day

      // Popularity score based on view count
      const popularityScore = Math.min(100, Math.log10(video.viewCount + 1) * 10);

      // Calculate weighted trending potential
      const trendingPotential = 
        (engagementScore * weights.engagement) +
        (contentScore * weights.content) +
        (recencyScore * weights.recency) +
        (popularityScore * weights.popularity);

      return Math.round(Math.min(Math.max(trendingPotential, 0), 100));

    } catch (error: any) {
      logger.error('❌ Failed to calculate trending potential:', error);
      return 50; // Default score
    }
  }

  // Find videos by specific topics or keywords
  async findVideosByTopic(topic: string, maxResults: number = 25): Promise<any[]> {
    try {
      logger.info(`🔍 Searching for videos about: ${topic}`);

      const searchResults = await this.youtubeService.searchVideos(topic, maxResults);
      
      if (!searchResults || searchResults.length === 0) {
        logger.warn(`⚠️ No videos found for topic: ${topic}`);
        return [];
      }

      // Get detailed information for each video
      const detailedVideos = await Promise.all(
        searchResults.map(async (video) => {
          const videoDetails = await this.youtubeService.getVideoDetails(video.id.videoId);
          return videoDetails ? await this.analyzeVideo(videoDetails) : null;
        })
      );

      const validVideos = detailedVideos.filter(video => video !== null);

      logger.info(`✅ Found ${validVideos.length} videos for topic: ${topic}`);
      return validVideos;

    } catch (error: any) {
      logger.error(`❌ Failed to find videos for topic "${topic}":`, error);
      return [];
    }
  }

  // Get trending topics based on current videos
  async getTrendingTopics(limit: number = 10): Promise<string[]> {
    try {
      logger.info('📈 Extracting trending topics...');

      const trendingVideos = await this.huntTrendingVideos(100);
      
      if (!trendingVideos || trendingVideos.length === 0) {
        return [];
      }

      // Extract topics from titles and tags
      const topicMap = new Map<string, number>();

      trendingVideos.forEach(video => {
        // Extract from title
        const titleWords = video.title
          .toLowerCase()
          .split(/\s+/)
          .filter((word: string) => word.length > 3)
          .filter((word: string) => !['that', 'this', 'with', 'from', 'they', 'have', 'will', 'your', 'what', 'when', 'where', 'how'].includes(word));

        titleWords.forEach((word: string) => {
          topicMap.set(word, (topicMap.get(word) || 0) + 1);
        });

        // Extract from tags
        if (video.tags) {
          video.tags.forEach((tag: string) => {
            if (tag.length > 3) {
              topicMap.set(tag.toLowerCase(), (topicMap.get(tag.toLowerCase()) || 0) + 2); // Tags get double weight
            }
          });
        }
      });

      // Sort topics by frequency and return top ones
      const sortedTopics = Array.from(topicMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([topic]) => topic);

      logger.info(`✅ Extracted ${sortedTopics.length} trending topics`);
      return sortedTopics;

    } catch (error: any) {
      logger.error('❌ Failed to get trending topics:', error);
      return [];
    }
  }

  // Store trending analysis in database
  private async storeTrendingAnalysis(videos: any[]): Promise<void> {
    try {
      if (!supabase) {
        logger.warn('⚠️ Database not available, skipping trending analysis storage');
        return;
      }

      await supabase
        .from('trending_analysis')
        .insert({
          analyzed_at: new Date().toISOString(),
          video_count: videos.length,
          average_engagement: videos.reduce((sum, v) => sum + (v.engagementScore || 0), 0) / videos.length,
          top_categories: this.extractTopCategories(videos),
          analysis_summary: {
            totalViews: videos.reduce((sum, v) => sum + (v.viewCount || 0), 0),
            averageViews: videos.reduce((sum, v) => sum + (v.viewCount || 0), 0) / videos.length,
            topChannels: this.extractTopChannels(videos)
          }
        });

      logger.info('💾 Trending analysis stored in database');

    } catch (error: any) {
      logger.error('❌ Failed to store trending analysis:', error);
    }
  }

  // Extract top categories from videos
  private extractTopCategories(videos: any[]): string[] {
    const categoryMap = new Map<string, number>();
    
    videos.forEach(video => {
      if (video.category) {
        categoryMap.set(video.category, (categoryMap.get(video.category) || 0) + 1);
      }
    });

    return Array.from(categoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category]) => category);
  }

  // Extract top channels from videos
  private extractTopChannels(videos: any[]): string[] {
    const channelMap = new Map<string, number>();
    
    videos.forEach(video => {
      if (video.channelTitle) {
        channelMap.set(video.channelTitle, (channelMap.get(video.channelTitle) || 0) + 1);
      }
    });

    return Array.from(channelMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([channel]) => channel);
  }
}
