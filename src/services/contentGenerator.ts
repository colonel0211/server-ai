import OpenAI from 'openai';
import { logger } from '../utils/logger';

export interface ContentRequest {
  topic: string;
  style: 'educational' | 'entertainment' | 'news' | 'tutorial' | 'review';
  duration: number; // in seconds
  audience: 'kids' | 'teens' | 'adults' | 'general';
  language?: string;
}

export interface GeneratedContent {
  success: boolean;
  title?: string;
  description?: string;
  script?: string;
  tags?: string[];
  thumbnail_prompt?: string;
  error?: string;
}

export class ContentGenerator {
  public openai: OpenAI; // FIXED: Changed from private to public

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    this.openai = new OpenAI({
      apiKey: apiKey
    });

    logger.info('✅ Content Generator initialized');
  }

  // Generate video content based on request
  async generateVideoContent(request: ContentRequest): Promise<GeneratedContent> {
    try {
      logger.info(`🎬 Generating content for topic: ${request.topic}`);

      // Generate title
      const title = await this.generateTitle(request);
      
      // Generate description
      const description = await this.generateDescription(request, title);
      
      // Generate script
      const script = await this.generateScript(request, title);
      
      // Generate tags
      const tags = await this.generateTags(request, title);
      
      // Generate thumbnail prompt
      const thumbnail_prompt = await this.generateThumbnailPrompt(request, title);

      const result: GeneratedContent = {
        success: true,
        title,
        description,
        script,
        tags,
        thumbnail_prompt
      };

      logger.info(`✅ Content generated successfully for: ${title}`);
      return result;

    } catch (error: any) {
      logger.error('❌ Content generation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate engaging title
  private async generateTitle(request: ContentRequest): Promise<string> {
    try {
      const prompt = `Generate an engaging YouTube title for a ${request.style} video about "${request.topic}" 
        targeted at ${request.audience} audience. The title should be:
        - Attention-grabbing and clickable
        - SEO-friendly
        - Under 60 characters
        - Relevant to the topic
        
        Topic: ${request.topic}
        Style: ${request.style}
        Audience: ${request.audience}
        
        Return only the title, nothing else.`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
        temperature: 0.8
      });

      return completion.choices[0]?.message?.content?.trim() || `${request.topic} - Complete Guide`;

    } catch (error: any) {
      logger.error('❌ Title generation failed:', error);
      return `${request.topic} - Complete Guide`;
    }
  }

  // Generate video description
  private async generateDescription(request: ContentRequest, title: string): Promise<string> {
    try {
      const prompt = `Write a compelling YouTube video description for a video titled "${title}".
        The video is about "${request.topic}" in ${request.style} style for ${request.audience} audience.
        
        The description should:
        - Be engaging and informative
        - Include relevant keywords for SEO
        - Be around 150-200 words
        - Include a call-to-action
        - Have proper formatting with line breaks
        
        Topic: ${request.topic}
        Style: ${request.style}
        Duration: ${Math.floor(request.duration / 60)} minutes`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.7
      });

      return completion.choices[0]?.message?.content?.trim() || 
        `Learn everything about ${request.topic} in this comprehensive ${request.style} video. Perfect for ${request.audience} audience!`;

    } catch (error: any) {
      logger.error('❌ Description generation failed:', error);
      return `Learn everything about ${request.topic} in this comprehensive ${request.style} video.`;
    }
  }

  // Generate video script
  private async generateScript(request: ContentRequest, title: string): Promise<string> {
    try {
      const durationMinutes = Math.floor(request.duration / 60);
      
      const prompt = `Create a detailed video script for a ${durationMinutes}-minute YouTube video titled "${title}".
        
        Video Details:
        - Topic: ${request.topic}
        - Style: ${request.style}
        - Audience: ${request.audience}
        - Duration: ${durationMinutes} minutes
        
        Script Requirements:
        - Include engaging hook in first 15 seconds
        - Clear structure with introduction, main content, and conclusion
        - Natural, conversational tone
        - Include timing cues [00:00]
        - Add call-to-action for likes and subscribes
        - Make it educational and valuable
        
        Format the script with clear sections and timing markers.`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500,
        temperature: 0.7
      });

      return completion.choices[0]?.message?.content?.trim() || 
        `[00:00] Welcome to today's video about ${request.topic}!\n\n[00:15] In this video, we'll explore everything you need to know about ${request.topic}.\n\n[01:00] Thank you for watching! Don't forget to like and subscribe!`;

    } catch (error: any) {
      logger.error('❌ Script generation failed:', error);
      return `Welcome to today's video about ${request.topic}! In this video, we'll explore everything you need to know about this topic.`;
    }
  }

  // Generate relevant tags
  private async generateTags(request: ContentRequest, title: string): Promise<string[]> {
    try {
      const prompt = `Generate 15-20 relevant YouTube tags for a video titled "${title}" about "${request.topic}".
        
        Video Details:
        - Topic: ${request.topic}
        - Style: ${request.style}
        - Audience: ${request.audience}
        
        Tags should be:
        - SEO-friendly
        - Mix of specific and broad terms
        - Relevant to the content
        - Help with discoverability
        
        Return tags as a comma-separated list.`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.6
      });

      const tagsString = completion.choices[0]?.message?.content?.trim() || '';
      return tagsString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

    } catch (error: any) {
      logger.error('❌ Tags generation failed:', error);
      return [request.topic, request.style, 'tutorial', 'guide', 'howto'];
    }
  }

  // Generate thumbnail prompt for AI image generation
  private async generateThumbnailPrompt(request: ContentRequest, title: string): Promise<string> {
    try {
      const prompt = `Create a detailed prompt for generating a YouTube thumbnail image for a video titled "${title}".
        
        Video Details:
        - Topic: ${request.topic}
        - Style: ${request.style}
        - Audience: ${request.audience}
        
        The prompt should describe:
        - Visual elements that represent the topic
        - Color scheme that's eye-catching
        - Text placement and style
        - Overall composition
        - Make it click-worthy and professional
        
        Return only the image generation prompt.`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.7
      });

      return completion.choices[0]?.message?.content?.trim() || 
        `Professional YouTube thumbnail with "${title}" text, vibrant colors, clean design, ${request.topic} related imagery`;

    } catch (error: any) {
      logger.error('❌ Thumbnail prompt generation failed:', error);
      return `Professional YouTube thumbnail about ${request.topic} with vibrant colors and clean design`;
    }
  }

  // PUBLIC METHOD: Analyze video content for trending potential
  public async analyzeVideoContent(video: any): Promise<any> {
    try {
      const prompt = `Analyze this YouTube video for content creation insights:
        
        Title: ${video.title}
        Description: ${video.description?.substring(0, 200) || 'No description'}
        Views: ${video.viewCount}
        Likes: ${video.likeCount}
        Comments: ${video.commentCount}
        
        Provide analysis on:
        1. Why this video is trending
        2. Key elements that make it engaging
        3. Content creation opportunities
        4. Target audience insights
        5. Replication potential (1-10 score)
        
        Return as JSON object with these fields: reason, elements, opportunities, audience, replicationScore`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        temperature: 0.6
      });

      const analysisText = completion.choices[0]?.message?.content?.trim() || '{}';
      
      try {
        return JSON.parse(analysisText);
      } catch {
        return {
          reason: "Analysis failed",
          elements: [],
          opportunities: [],
          audience: "general",
          replicationScore: 5
        };
      }

    } catch (error: any) {
      logger.error('❌ Video content analysis failed:', error);
      return {
        reason: "Analysis failed",
        elements: [],
        opportunities: [],
        audience: "general",
        replicationScore: 1
      };
    }
  }

  // Generate content ideas based on trending topics
  async generateContentIdeas(topics: string[], count: number = 5): Promise<ContentRequest[]> {
    try {
      logger.info(`💡 Generating ${count} content ideas from trending topics`);

      const ideas: ContentRequest[] = [];

      for (let i = 0; i < Math.min(count, topics.length); i++) {
        const topic = topics[i];
        
        const idea: ContentRequest = {
          topic: topic,
          style: this.getRandomStyle(),
          duration: this.getRandomDuration(),
          audience: this.getRandomAudience(),
          language: 'en'
        };

        ideas.push(idea);
      }

      logger.info(`✅ Generated ${ideas.length} content ideas`);
      return ideas;

    } catch (error: any) {
      logger.error('❌ Content ideas generation failed:', error);
      return [];
    }
  }

  // Helper methods
  private getRandomStyle(): 'educational' | 'entertainment' | 'news' | 'tutorial' | 'review' {
    const styles: ('educational' | 'entertainment' | 'news' | 'tutorial' | 'review')[] = 
      ['educational', 'entertainment', 'tutorial', 'review'];
    return styles[Math.floor(Math.random() * styles.length)];
  }

  private getRandomDuration(): number {
    const durations = [60, 120, 180, 300, 420, 600]; // 1-10 minutes
    return durations[Math.floor(Math.random() * durations.length)];
  }

  private getRandomAudience(): 'kids' | 'teens' | 'adults' | 'general' {
    const audiences: ('kids' | 'teens' | 'adults' | 'general')[] = ['teens', 'adults', 'general'];
    return audiences[Math.floor(Math.random() * audiences.length)];
  }

  // Generate voiceover script from regular script
  async generateVoiceoverScript(script: string): Promise<string> {
    try {
      const prompt = `Convert this video script into a natural voiceover script:
        
        Original Script:
        ${script}
        
        Requirements:
        - Remove timing markers and stage directions
        - Make it flow naturally for text-to-speech
        - Keep the educational value
        - Maintain engaging tone
        - Add natural pauses with periods
        
        Return only the clean voiceover text.`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.5
      });

      return completion.choices[0]?.message?.content?.trim() || script;

    } catch (error: any) {
      logger.error('❌ Voiceover script generation failed:', error);
      return script; // Return original script as fallback
    }
  }
}
