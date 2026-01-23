-- Create a secure view for the leaderboard to avoid exposing sensitive review details
-- Joins with departments table to show actual department names instead of UUIDs
create or replace view public.employee_rankings_view as
select 
    r.user_id,
    r.manager_score_total,
    r.manager_score_percentage,
    p.full_name,
    p.avatar_url,
    p.job_title,
    d.department_name as department
from public.employee_reviews r
join public.profiles p on r.user_id = p.id
left join public.departments d on p.department::uuid = d.id
where r.manager_score_total > 0;

-- Grant access to authenticated users
grant select on public.employee_rankings_view to authenticated;
grant select on public.employee_rankings_view to anon;
