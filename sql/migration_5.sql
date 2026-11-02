-- =====================================================================
-- TXT Vault — تحديث 5: «المالك» وإدارة المشرفين (تظهر للمالك فقط)
-- شغّل هذا الملف في SQL Editor بعد migration_4.sql (آمن لإعادة التشغيل).
--
-- ⚠️ قبل التشغيل: غيّر YOUR_MAIN_ADMIN_EMAIL@example.com (في الأمر الأول تحت)
--    إلى إيميل حسابك الأساسي الذي سيكون «المالك».
-- =====================================================================

-- 1) عمود المالك
alter table public.app_admins add column if not exists is_owner boolean not null default false;

-- 2) حدّد المالك بإيميلك (غيّر الإيميل هنا)
update public.app_admins set is_owner = true
where user_id = (
  select id from auth.users where lower(email) = lower('YOUR_MAIN_ADMIN_EMAIL@example.com')
);

-- احتياط: لو ما وُجد أي مالك (نسيت تغيير الإيميل) نجعل أقدم مشرف هو المالك
update public.app_admins set is_owner = true
where not exists (select 1 from public.app_admins where is_owner)
  and user_id = (select user_id from public.app_admins order by created_at limit 1);

-- 3) هل المستخدم الحالي هو المالك؟
create or replace function public.admin_is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid() and is_owner);
$$;

-- 4) أرقام المشرفين فقط (بدون إيميلات) لإخفائهم من قائمة الطلاب — لأي مشرف
create or replace function public.admin_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select a.user_id from public.app_admins a where public.is_admin();
$$;

-- 5) قائمة المشرفين — للمالك فقط
create or replace function public.owner_list_admins()
returns table (user_id uuid, email text, is_owner boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  return query
    select a.user_id, u.email::text, a.is_owner, a.created_at
    from public.app_admins a
    join auth.users u on u.id = a.user_id
    order by a.is_owner desc, a.created_at;
end;
$$;

-- 6) إضافة مشرف بإيميله (لازم يكون سجّل حسابًا عاديًا) — للمالك فقط
create or replace function public.owner_add_admin(p_email text)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare v uuid;
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then raise exception 'user_not_found'; end if;
  insert into public.app_admins (user_id) values (v) on conflict do nothing;
end;
$$;

-- 7) إزالة مشرف — للمالك فقط (لا يمكن إزالة المالك ولا نفسك)
create or replace function public.owner_remove_admin(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_self'; end if;
  if exists (select 1 from public.app_admins where user_id = p_user and is_owner) then
    raise exception 'cannot_remove_owner';
  end if;
  delete from public.app_admins where user_id = p_user;
end;
$$;

revoke all on function public.admin_is_owner()               from public, anon;
revoke all on function public.admin_ids()                    from public, anon;
revoke all on function public.owner_list_admins()            from public, anon;
revoke all on function public.owner_add_admin(text)          from public, anon;
revoke all on function public.owner_remove_admin(uuid)       from public, anon;
grant execute on function public.admin_is_owner()            to authenticated;
grant execute on function public.admin_ids()                 to authenticated;
grant execute on function public.owner_list_admins()         to authenticated;
grant execute on function public.owner_add_admin(text)       to authenticated;
grant execute on function public.owner_remove_admin(uuid)    to authenticated;
