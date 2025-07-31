import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Retrieve Supabase URL and Key from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let supabaseClient: SupabaseClient | null = null;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase URL or Key is missing. Please ensure SUPABASE_URL and SUPABASE_KEY environment variables are set.');
  // In a production environment, you might want to throw an error here to prevent startup.
} else {
  try {
    // Initialize Supabase client
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase client initialized successfully.');
  } catch (error: any) {
    console.error('❌ Error initializing Supabase client:', error.message);
    // Optionally, handle critical Supabase initialization failure.
  }
}

// Export the Supabase client instance and its type
export const supabase = supabaseClient;
export type { SupabaseClient };

// Default export for convenience
export default supabase;
