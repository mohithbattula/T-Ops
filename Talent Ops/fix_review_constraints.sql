-- 1. Clean up potential duplicate reviews (keeping the most recent one)
delete from public.employee_reviews
where id not in (
    select id from (
        select id, row_number() over (partition by user_id order by created_at desc) as rn
        from public.employee_reviews
    ) t where rn = 1
);

-- 2. Add Unique Constraint to user_id to support UPSERT operations
alter table public.employee_reviews 
drop constraint if exists employee_reviews_user_id_key;

alter table public.employee_reviews 
add constraint employee_reviews_user_id_key unique (user_id);
