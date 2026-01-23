-- Drop existing restrictive policies if they exist (need to know exact names, assuming the ones created previously)
-- We can drop and recreate to be safe.

drop policy if exists "Managers can update reviews for their team" on public.employee_reviews;
drop policy if exists "Managers can view reviews for their team" on public.employee_reviews;
drop policy if exists "Managers can insert reviews for their team" on public.employee_reviews;

-- Create broad Organization-based policies for Managers
-- Managers (role='manager') can view/update/insert reviews for ANYONE in their specific organization

create policy "Managers can view all org reviews"
    on public.employee_reviews for select
    using (
        exists (
            select 1 from public.profiles as viewer
            where viewer.id = auth.uid()
            and viewer.role = 'manager'
            and viewer.org_id = (
                select target.org_id from public.profiles as target
                where target.id = employee_reviews.user_id
            )
        )
        OR
        -- Keep Team Lead access limited to project/team
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
                       where user_id = auth.uid() and role = 'team_lead'
                   )
                )
            )
        )
        OR
        -- Users can still view their own
        auth.uid() = user_id
    );

create policy "Managers can update all org reviews"
    on public.employee_reviews for update
    using (
        exists (
            select 1 from public.profiles as viewer
            where viewer.id = auth.uid()
            and viewer.role = 'manager'
            and viewer.org_id = (
                select target.org_id from public.profiles as target
                where target.id = employee_reviews.user_id
            )
        )
        OR
        -- Team Leads for their team
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
                       where user_id = auth.uid() and role = 'team_lead'
                   )
                )
            )
        )
        -- Users can update their own reviews (specifically the self-review parts, handled by column-level security or app logic, but row access allows update)
        OR auth.uid() = user_id
    );

create policy "Managers can insert reviews for all org"
    on public.employee_reviews for insert
    with check (
        -- For inserting, we check if the authenticated user is a manager in the same org as the target user_id
        exists (
            select 1 from public.profiles as viewer, public.profiles as target
            where viewer.id = auth.uid()
            and target.id = employee_reviews.user_id
            and viewer.role = 'manager'
            and viewer.org_id = target.org_id
        )
        OR
        -- Or Team Leads for their team
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
                       where user_id = auth.uid() and role = 'team_lead'
                   )
                )
            )
        )
        OR
        -- Users can insert their own
        auth.uid() = user_id
    );
