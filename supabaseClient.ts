import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://okpdgsabulxwwpdhxxay.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rcGRnc2FidWx4d3dwZGh4eGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NjU3OTQsImV4cCI6MjA4MjU0MTc5NH0.l9mCtCY6Xzuk7jnZWUsmo_vbBHRorwdzYrdouzh3VxI';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Version constant to track schema changes
export const SQL_SCHEMA_VERSION = "2.1";

// SQL Schema for the user to run
export const SQL_SCHEMA = `
-- Version: ${SQL_SCHEMA_VERSION}
-- Update Note: Ensure user_saves handles JSONB correctly for nested calculations

create table if not exists public.user_saves (
  id uuid references auth.users on delete cascade not null primary key,
  state jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS
alter table public.user_saves enable row level security;

-- Create policies (safe to run even if they exist, but best to drop if conflicts occur)
drop policy if exists "Users can view their own save" on public.user_saves;
create policy "Users can view their own save" on public.user_saves
  for select using (auth.uid() = id);

drop policy if exists "Users can insert their own save" on public.user_saves;
create policy "Users can insert their own save" on public.user_saves
  for insert with check (auth.uid() = id);

drop policy if exists "Users can update their own save" on public.user_saves;
create policy "Users can update their own save" on public.user_saves
  for update using (auth.uid() = id);
`;