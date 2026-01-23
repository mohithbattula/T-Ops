-- Add manager review columns to employee_reviews table
alter table public.employee_reviews 
add column if not exists manager_development_skills jsonb default '{}'::jsonb,
add column if not exists manager_soft_skills jsonb default '{}'::jsonb,
add column if not exists manager_feedback text,
add column if not exists manager_id uuid references auth.users(id),
add column if not exists date_reviewed timestamp with time zone;

-- Update RLS policies to allow managers to update reviews
create policy "Managers can update reviews for their team"
    on public.employee_reviews for update
    using (
        exists (
            select 1 from public.profiles
            where profiles.id = employee_reviews.user_id
            and (
                profiles.manager_id = auth.uid() 
                or 
                exists (
                   select 1 from public.project_members
                   where project_members.user_id = profiles.id
                   and project_members.project_id in (
                       select project_id from public.project_members 
                       where user_id = auth.uid() and role in ('manager', 'team_lead')
                   )
                )
            )
        )
    );

-- Allow managers to view reviews of their team
create policy "Managers can view reviews for their team"
    on public.employee_reviews for select
    using (
        exists (
            select 1 from public.profiles
            where profiles.id = employee_reviews.user_id
            and (
                profiles.manager_id = auth.uid() 
                or 
                exists (
                   select 1 from public.project_members
                   where project_members.user_id = profiles.id
                   and project_members.project_id in (
                       select project_id from public.project_members 
                       where user_id = auth.uid() and role in ('manager', 'team_lead')
                   )
                )
            )
        )
    );
