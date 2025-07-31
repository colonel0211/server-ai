import OpenAI from 'openai';

export interface ContentIdea {
  title: string;
  description: string;
  tags: string[];
  category: string;
  script: string;
  hook: string;
  thumbnail_text: string;
}

export interface VideoScript {
  hook: string;
  introduction: string;
  main_points: string[];
  conclusion: string;
  call_to_action: string;
  full_script: string;
}

class ContentGenerator {
  private openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('❌ OpenAI API key missing');
      return;
    }

    this.openai = new OpenAI({ apiKey });
    console.log('✅ OpenAI Content Generator initialized');
  }

  /**
   * Generate trending video ideas
   */
  async generateVideoIdeas(niche: string, count: number = 5): Promise<ContentIdea[]> {
    try {
      const prompt = `Generate ${count} viral YouTube video ideas for the ${niche} niche. 
      
      Focus on:
      - Trending topics and current events
      - High-engagement formats (lists, how-to, facts)
      - SEO-optimized titles
      - Click-worthy but not clickbait
      - Evergreen content that stays relevant
      
      For each idea, provide:
      1. Catchy title (under 60 characters)
      2. Compelling description (2-3 sentences)
      3. 10-15 relevant tags
      4. Video category
      5. Brief video script outline
      6. Opening hook (first 15 seconds)
      7. Thumbnail text (2-4 words)
      
      Return as JSON array with objects containing: title, description, tags, category, script, hook, thumbnail_text`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a viral YouTube content strategist. Create engaging, original video ideas that follow YouTube best practices.'
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
      console.error('❌ Failed to generate video ideas:', error.message);
      throw error;
    }
  }

  /**
   * Generate detailed video script
   */
  async generateScript(topic: string, duration: number = 300): Promise<VideoScript> {
    try {
      const prompt = `Create a detailed ${duration}-second YouTube video script about: "${topic}"

      Structure:
      1. Hook (0-15 seconds) - Grab attention immediately
      2. Introduction (15-30 seconds) - What they'll learn
      3. Main content (60-80% of video) - Core information with smooth transitions
      4. Conclusion (last 30 seconds) - Summarize key points
      5. Call to action - Subscribe, like, comment

      Requirements:
      - Conversational, engaging tone
      - Keep viewers watching (retention hooks)
      - Include specific facts and examples
      - Natural pauses for text overlays
      - Strong opening and closing

      Return as JSON with: hook, introduction, main_points (array), conclusion, call_to_action, full_script`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a professional YouTube scriptwriter. Create engaging, well-structured scripts that maximize viewer retention.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      });

      const content = response.choices[0].message.content;
      return JSON.parse(content || '{}');

    } catch (error: any) {
      console.error('❌ Failed to generate script:', error.message);
      throw error;
    }
  }

  /**
   * Generate SEO-optimized title variations
   */
  async generateTitles(topic: string, count: number = 5): Promise<string[]> {
    try {
      const prompt = `Generate ${count} SEO-optimized YouTube titles for: "${topic}"

      Requirements:
      - Under 60 characters
      - Include power words (Ultimate, Secret, Amazing, etc.)
      - Use numbers when possible
      - Create curiosity without clickbait
      - Include relevant keywords
      - Mix of different formats (How to, List, Question, etc.)

      Return as JSON array of strings.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a YouTube SEO expert. Create titles that rank well and get clicks.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 500
      });

      const content = response.choices[0].message.content;
      return JSON.parse(content || '[]');

    } catch (error: any) {
      console.error('❌ Failed to generate titles:', error.message);
      throw error;
    }
  }

  /**
   * Generate video description with SEO
   */
  async generateDescription(title: string, script: string): Promise<string> {
    try {
      const prompt = `Create a YouTube video description for: "${title}"

      Based on this script: "${script.substring(0, 500)}..."

      Include:
      - Compelling first 2 lines (visible without "show more")
      - Key points covered in the video
      - Relevant hashtags (3-5)
      - Call to action to subscribe
      - Social media links placeholder
      - Timestamps if applicable

      Keep it under 1000 characters for the main description.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a YouTube SEO specialist. Write descriptions that improve discoverability and engagement.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.6,
        max_tokens: 800
      });

      return response.choices[0].message.content || '';

    } catch (error: any) {
      console.error('❌ Failed to generate description:', error.message);
      throw error;
    }
  }

  /**
   * Generate relevant tags for better discoverability
   */
  async generateTags(title: string, description: string): Promise<string[]> {
    try {
      const prompt = `Generate 15-20 YouTube tags for this video:
      Title: "${title}"
      Description: "${description.substring(0, 200)}..."

      Include:
      - Primary keywords from title
      - Related search terms
      - Niche-specific tags
      - Long-tail keywords
      - Trending hashtags

      Return as JSON array of strings. Keep tags under 50 characters each.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a YouTube SEO expert. Generate tags that improve video discoverability.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 600
      });

      const content = response.choices[0].message.content;
      return JSON.parse(content || '[]');

    } catch (error: any) {
      console.error('❌ Failed to generate tags:', error.message);
      throw error;
    }
  }

  /**
   * Analyze trending topics for content ideas
   */
  async analyzeTrends(industry: string): Promise<string[]> {
    try {
      const prompt = `What are the top 10 trending topics in ${industry} right now that would make great YouTube content?

      Focus on:
      - Current events and news
      - Seasonal trends
      - Popular searches
      - Emerging technologies or methods
      - Common problems people are searching for

      Return as JSON array of trending topic strings.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a trend analysis expert. Identify current topics with high search volume and engagement potential.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.6,
        max_tokens: 800
      });

      const content = response.choices[0].message.content;
      return JSON.parse(content || '[]');

    } catch (error: any) {
      console.error('❌ Failed to analyze trends:', error.message);
      throw error;
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }
}

export default new ContentGenerator();
