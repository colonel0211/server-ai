import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Check if we have valid configuration
const hasValidUrl = supabaseUrl && supabaseUrl.includes('.supabase.co');
const hasValidKey = supabaseKey && supabaseKey.length > 20;

// Lazy initialization - only create clients when actually needed
let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient | null => {
  if (!hasValidUrl || !hasValidKey) {
    console.warn('Supabase client not available - missing or invalid environment variables');
    return null;
  }
  
  if (!_supabase) {
    try {
      _supabase = createClient(supabaseUrl!, supabaseKey!);
    } catch (error) {
      console.error('Failed to create Supabase client:', error);
      return null;
    }
  }
  
  return _supabase;
};

export const getSupabaseAdmin = (): SupabaseClient | null => {
  if (!hasValidUrl || !supabaseServiceKey) {
    console.warn('Supabase admin client not available - missing environment variables');
    return null;
  }
  
  if (!_supabaseAdmin) {
    try {
      _supabaseAdmin = createClient(supabaseUrl!, supabaseServiceKey!);
    } catch (error) {
      console.error('Failed to create Supabase admin client:', error);
      return null;
    }
  }
  
  return _supabaseAdmin;
};

// Legacy exports for backward compatibility (but these are safe now)
export const supabase = null; // Don't export direct client
export const supabaseAdmin = null; // Don't export direct admin client

// Test database connection
export async function testDatabaseConnection(): Promise<{ connected: boolean; error?: string }> {
  const client = getSupabaseClient();
  
  if (!client) {
    return { 
      connected: false, 
      error: 'Supabase client not configured - missing or invalid environment variables' 
    };
  }

  try {
    // Try a simple query that doesn't require specific tables
    const { data, error } = await client
      .from('videos') // This table might not exist, which is fine
      .select('count')
      .limit(1);
    
    // If table doesn't exist (PGRST116), connection is still good
    if (error && error.code !== 'PGRST116') {
      return { connected: false, error: error.message };
    }
    
    return { connected: true };
  } catch (error) {
    return { 
      connected: false, 
      error: error instanceof Error ? error.message : 'Unknown database error' 
    };
  }
}

// Check if Supabase is properly configured
export function isSupabaseConfigured(): boolean {
  return hasValidUrl && hasValidKey;
}

// Get configuration status
export function getSupabaseStatus() {
  return {
    configured: isSupabaseConfigured(),
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseKey,
    hasServiceKey: !!supabaseServiceKey,
    urlValid: !!hasValidUrl,
    keyValid: !!hasValidKey
  };
}
