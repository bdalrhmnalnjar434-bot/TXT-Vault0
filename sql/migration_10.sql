-- =====================================================================
-- TXT Vault — تحديث 10: حالات الفصول (مقفول / غير مسموح / محذوف)،
--                       تحديد الجمهور عند الإضافة، القبول بفصول محددة، التواصل مع المشرف
-- شغّل هذا الملف في SQL Editor بعد migration_9.sql (آمن لإعادة التشغيل).
-- ⚠️ لو شغّلت schema.sql أو migration_2.sql أو migration_6.sql بعده، أعد تشغيل هذا الملف.
-- =====================================================================

-- 1) أعمدة جديدة على الفصول
alter table public.learning_sections add column if not exists is_locked       boolean not null default false; -- مقفول حاليًا
alter table public.learning_sections add column if not exists content_deleted boolean not null default false; -- تم حذف المحتوى
alter table public.learning_sections add column if not exists auto_grant      boolean not null default true;  -- منح تلقائي لكل طلاب الصف عند الإنشاء

-- 2) المنح التلقائي عند إنشاء فصل: فقط لو auto_grant (يحدده المشرف عند الإضافة)
create or replace function public.grant_new_section()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.auto_grant then
    insert into public.student_section_access (student_id, section_id)
    select p.id, new.id from public.student_profiles p
    where p.grade = new.grade and p.status = 'approved'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- 3) القراءة: نفس شروط migration_6 + الفصل غير مقفول
create or replace function public.can_read_section(sec uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or ( public.is_student_active()
           and public.device_allowed()
           and exists (
             select 1
             from public.student_section_access a
             join public.learning_sections s on s.id = a.section_id
             join public.student_profiles  p on p.id = a.student_id
             where a.student_id = auth.uid()
               and a.section_id = sec
               and s.is_published
               and not s.is_locked
               and not s.content_deleted
               and public.grade_visible(s.grade)
               and (s.grade = 'private' or s.grade = p.grade)
           ) );
$$;

-- 4) قائمة الفصول للطالب بحالتها: open | locked | denied | deleted
--    (عناوين فصول صفه تظهر للجميع، والمحتوى نفسه يبقى محميًا بـ can_read_section)
create or replace function public.student_chapters()
returns table (id uuid, grade text, subject text, title text, "position" int, state text)
language sql stable security definer set search_path = public as $$
  select s.id, s.grade, s.subject, s.title, s."position",
         case
           when s.content_deleted           then 'deleted'
           when a.section_id is null        then 'denied'
           when s.is_locked                 then 'locked'
           else 'open'
         end
  from public.learning_sections s
  join public.student_profiles p on p.id = auth.uid()
  left join public.student_section_access a on a.student_id = p.id and a.section_id = s.id
  where public.is_student_active()
    and public.device_allowed()
    and s.is_published
    and public.grade_visible(s.grade)
    and ( (s.grade <> 'private' and s.grade = p.grade)
          or (s.grade = 'private' and a.section_id is not null) )
  order by s.subject, s."position", s.created_at;
$$;

-- 5) المشرف: منح/سحب فصول لجمهور محدد
--    p_mode: all | grade | channel | selected
create or replace function public.admin_grant_sections(
  p_sections uuid[], p_mode text, p_grade text default null, p_users uuid[] default null, p_revoke boolean default false
) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_mode not in ('all','grade','channel','selected') then raise exception 'bad_mode'; end if;
  if p_mode = 'grade' and p_grade not in ('first','second') then raise exception 'bad_grade'; end if;

  if p_revoke then
    delete from public.student_section_access a
    where a.section_id = any(p_sections)
      and a.student_id in (
        select p.id from public.student_profiles p
        left join public.telegram_links t on t.user_id = p.id
        where (p_mode = 'all'
            or (p_mode = 'grade'    and p.grade = p_grade)
            or (p_mode = 'channel'  and coalesce(t.channel_member, false))
            or (p_mode = 'selected' and p.id = any(p_users)))
          and not exists (select 1 from public.app_admins ad where ad.user_id = p.id)
      );
    get diagnostics n = row_count;
  else
    insert into public.student_section_access (student_id, section_id)
    select p.id, s.id
    from public.student_profiles p
    left join public.telegram_links t on t.user_id = p.id
    join public.learning_sections s on s.id = any(p_sections)
                                   and (s.grade = 'private' or s.grade = p.grade)
    where (p.status = 'approved' or p_mode = 'selected')
      and not exists (select 1 from public.app_admins ad where ad.user_id = p.id)
      and (p_mode = 'all'
        or (p_mode = 'grade'    and p.grade = p_grade)
        or (p_mode = 'channel'  and coalesce(t.channel_member, false))
        or (p_mode = 'selected' and p.id = any(p_users)))
    on conflict do nothing;
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;

-- 6) المشرف: قبول طالب مع اختيار «كل الفصول» أو «فصول محددة»
create or replace function public.admin_approve_student(p_user uuid, p_all boolean, p_sections uuid[] default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.student_profiles set status = 'approved' where id = p_user;

  if p_all then
    insert into public.student_section_access (student_id, section_id)
    select p_user, s.id
    from public.learning_sections s
    join public.student_profiles p on p.id = p_user and p.grade = s.grade
    on conflict do nothing;
  else
    -- فصول المواد تُستبدل بالمحدد، وفصول «خاصة» الممنوحة سابقًا تبقى كما هي
    delete from public.student_section_access a
    using public.learning_sections s
    where a.student_id = p_user and s.id = a.section_id and s.grade <> 'private';

    insert into public.student_section_access (student_id, section_id)
    select p_user, s.id
    from public.learning_sections s
    join public.student_profiles p on p.id = p_user
    where s.id = any(coalesce(p_sections, '{}'::uuid[]))
      and (s.grade = 'private' or s.grade = p.grade)
    on conflict do nothing;
  end if;
end;
$$;

-- 7) التواصل مع المشرف عبر البوت (الكتابة من البوت فقط)
create table if not exists public.support_requests (
  id         uuid primary key default gen_random_uuid(),
  chat_id    bigint not null,
  user_id    uuid references public.student_profiles(id) on delete set null,
  source     text not null default 'general',   -- register | login | chapters | general
  status     text not null default 'awaiting' check (status in ('awaiting','sent')),
  message    text,
  created_at timestamptz not null default now()
);
create index if not exists idx_support_chat on public.support_requests(chat_id, status);
alter table public.support_requests enable row level security;

drop policy if exists support_admin_select on public.support_requests;
create policy support_admin_select on public.support_requests
  for select to authenticated using (public.is_admin());

revoke all on function public.student_chapters()                                      from public, anon;
revoke all on function public.admin_grant_sections(uuid[], text, text, uuid[], boolean) from public, anon;
revoke all on function public.admin_approve_student(uuid, boolean, uuid[])            from public, anon;
grant execute on function public.student_chapters()                                      to authenticated;
grant execute on function public.admin_grant_sections(uuid[], text, text, uuid[], boolean) to authenticated;
grant execute on function public.admin_approve_student(uuid, boolean, uuid[])            to authenticated;
grant execute on function public.can_read_section(uuid)                                  to authenticated;
