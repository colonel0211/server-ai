import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let supabaseClient: SupabaseClient | null = null;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase URL or Key is missing. Please ensure SUPABASE_URL and SUPABASE_KEY environment variables are set.');
} else {
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase client initialized successfully.');
  } catch (error: any) {
    console.error('❌ Error initializing Supabase client:', error.message);
  }
}

export const supabase = supabaseClient;
export type { SupabaseClient };

export default supabase;
