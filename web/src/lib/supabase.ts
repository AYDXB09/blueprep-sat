import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env.'
  );
}

// Publishable key only — safe for the client. Every table this touches is
// protected by RLS (see blueprep_schema.sql); this key can never bypass it.
export const supabase = createClient<Database>(url, publishableKey);
