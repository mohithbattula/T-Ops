-- Create employee_reviews table
create table if not exists public.employee_reviews (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    development_skills jsonb default '{}'::jsonb,
    soft_skills jsonb default '{}'::jsonb,
    notes text
);

-- Enable RLS
alter table public.employee_reviews enable row level security;

-- Policies
create policy "Users can view their own reviews"
    on public.employee_reviews for select
    using (auth.uid() = user_id);

create policy "Users can insert their own reviews"
    on public.employee_reviews for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own reviews"
    on public.employee_reviews for update
    using (auth.uid() = user_id);

-- Optional: Allow managers/admins to view (add checks based on roles table if needed later)
