import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: 'private' | 'public' | 'unlisted';
  thumbnailPath?: string;
}

export interface UploadResult {
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  error?: string;
}

class YouTubeService {
  private youtube: any;
  private oauth2Client: any;

  constructor() {
    this.initializeAuth();
  }

  private initializeAuth() {
    const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      console.error('❌ YouTube OAuth credentials missing');
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // Set refresh token if available
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || process.env.REFRESH_TOKEN;
    if (refreshToken) {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });
    }

    // Initialize YouTube API
    this.youtube = google.youtube({
      version: 'v3',
      auth: this.oauth2Client
    });

    console.log('✅ YouTube API initialized');
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  /**
   * Upload video to YouTube
   */
  async uploadVideo(videoPath: string, metadata: VideoMetadata): Promise<UploadResult> {
    try {
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      console.log(`🎬 Starting upload: ${metadata.title}`);

      const fileSize = fs.statSync(videoPath).size;
      console.log(`📁 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

      const requestBody = {
        snippet: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          categoryId: metadata.categoryId,
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en'
        },
        status: {
          privacyStatus: metadata.privacyStatus,
          selfDeclaredMadeForKids: false
        }
      };

      const media = {
        body: fs.createReadStream(videoPath)
      };

      const response = await this.youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody,
        media
      });

      const videoId = response.data.id;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      console.log(`✅ Video uploaded successfully: ${videoUrl}`);

      // Upload thumbnail if provided
      if (metadata.thumbnailPath && fs.existsSync(metadata.thumbnailPath)) {
        await this.uploadThumbnail(videoId, metadata.thumbnailPath);
      }

      return {
        success: true,
        videoId,
        videoUrl
      };

    } catch (error: any) {
      console.error('❌ YouTube upload failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Upload custom thumbnail
   */
  async uploadThumbnail(videoId: string, thumbnailPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(thumbnailPath)) {
        console.warn(`⚠️ Thumbnail file not found: ${thumbnailPath}`);
        return false;
      }

      await this.youtube.thumbnails.set({
        videoId,
        media: {
          body: fs.createReadStream(thumbnailPath)
        }
      });

      console.log(`✅ Thumbnail uploaded for video: ${videoId}`);
      return true;

    } catch (error: any) {
      console.error('❌ Thumbnail upload failed:', error.message);
      return false;
    }
  }

  /**
   * Get channel information
   */
  async getChannelInfo() {
    try {
      const response = await this.youtube.channels.list({
        part: ['snippet', 'statistics'],
        mine: true
      });

      return response.data.items[0];
    } catch (error: any) {
      console.error('❌ Failed to get channel info:', error.message);
      throw error;
    }
  }

  /**
   * Search for videos (for research)
   */
  async searchVideos(query: string, maxResults: number = 10) {
    try {
      const response = await this.youtube.search.list({
        part: ['snippet'],
        q: query,
        type: 'video',
        maxResults,
        order: 'relevance'
      });

      return response.data.items;
    } catch (error: any) {
      console.error('❌ Video search failed:', error.message);
      throw error;
    }
  }

  /**
   * Get trending videos for research
   */
  async getTrendingVideos(regionCode: string = 'US', categoryId?: string) {
    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics'],
        chart: 'mostPopular',
        regionCode,
        categoryId,
        maxResults: 50
      });

      return response.data.items;
    } catch (error: any) {
      console.error('❌ Failed to get trending videos:', error.message);
      throw error;
    }
  }

  /**
   * Check if service is properly configured
   */
  isConfigured(): boolean {
    return !!(
      this.oauth2Client &&
      (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
      (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
    );
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return !!(this.oauth2Client?.credentials?.refresh_token);
  }
}

export default new YouTubeService();
