-- Add columns for storing calculated scores
alter table public.employee_reviews 
add column if not exists manager_score_dev numeric default 0,
add column if not exists manager_score_soft numeric default 0,
add column if not exists manager_score_total numeric default 0,
add column if not exists manager_score_percentage numeric default 0;

-- Index for faster ranking/sorting
create index if not exists idx_employee_reviews_total_score on public.employee_reviews(manager_score_total desc);
