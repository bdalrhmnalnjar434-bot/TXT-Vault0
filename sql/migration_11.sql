-- =====================================================================
-- TXT Vault — تحديث 11: الفصول المشتركة بين أولى وثانية
-- شغّل هذا الملف في SQL Editor بعد migration_10.sql (آمن لإعادة التشغيل).
-- ⚠️ لو شغّلت migration_2/6/10 بعده، أعد تشغيل هذا الملف.
--
-- الفكرة: الفصل يبقى له مالك (صفه الأصلي) ويمكن «مشاركته» مع الصف الآخر.
-- المحتوى يُرفع مرة واحدة بدون تكرار، ويظهر عند الصفين.
-- =====================================================================

create table if not exists public.section_shares (
  section_id uuid not null references public.learning_sections(id) on delete cascade,
  grade      text not null check (grade in ('first','second')),
  primary key (section_id, grade)
);
alter table public.section_shares enable row level security;
drop policy if exists shares_admin_all on public.section_shares;
create policy shares_admin_all on public.section_shares
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- هل الفصل ظاهر لطالب صفه g؟ (فصل «خاصة» | صفه الأصلي | مُشارَك مع صفه)
create or replace function public.section_for_grade(sec uuid, sec_grade text, g text)
returns boolean
language sql stable security definer set search_path = public as $$
  select sec_grade = 'private'
      or sec_grade = g
      or exists (select 1 from public.section_shares sh where sh.section_id = sec and sh.grade = g);
$$;

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
               and public.grade_visible(case when s.grade = 'private' then 'private' else p.grade end)
               and public.section_for_grade(s.id, s.grade, p.grade)
           ) );
$$;

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
    and public.grade_visible(case when s.grade = 'private' then 'private' else p.grade end)
    and ( (s.grade <> 'private' and public.section_for_grade(s.id, s.grade, p.grade))
          or (s.grade = 'private' and a.section_id is not null) )
  order by s.subject, s."position", s.created_at;
$$;

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
                                   and public.section_for_grade(s.id, s.grade, p.grade)
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
    join public.student_profiles p on p.id = p_user
    where s.grade <> 'private' and public.section_for_grade(s.id, s.grade, p.grade)
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
      and public.section_for_grade(s.id, s.grade, p.grade)
    on conflict do nothing;
  end if;
end;
$$;

-- نقل الطالب بين الصفوف: لا يمسّ «خاصة»، ويراعي الفصول المشتركة
create or replace function public.admin_set_student_grade(p_user uuid, p_grade text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_grade not in ('first','second') then raise exception 'invalid grade'; end if;

  delete from public.student_section_access a
  using public.learning_sections s
  where a.student_id = p_user and s.id = a.section_id and s.grade <> 'private';

  update public.student_profiles set grade = p_grade where id = p_user;

  insert into public.student_section_access (student_id, section_id)
  select p_user, s.id
  from public.learning_sections s
  join public.student_profiles p on p.id = p_user
  where s.grade <> 'private' and public.section_for_grade(s.id, s.grade, p_grade) and p.status = 'approved'
  on conflict do nothing;
end;
$$;

-- المشرف: مشاركة فصول مع صف آخر (أو إلغاء المشاركة)
create or replace function public.admin_share_sections(p_sections uuid[], p_grade text, p_remove boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_grade not in ('first','second') then raise exception 'bad_grade'; end if;

  if p_remove then
    delete from public.section_shares where section_id = any(p_sections) and grade = p_grade;
    get diagnostics n = row_count;
    -- سحب الصلاحية ممن كان يراها بسبب المشاركة فقط (صفهم ليس صف الفصل)
    delete from public.student_section_access a
    using public.learning_sections s, public.student_profiles p
    where a.section_id = any(p_sections) and s.id = a.section_id and p.id = a.student_id
      and p.grade = p_grade and s.grade <> p_grade and s.grade <> 'private';
  else
    insert into public.section_shares (section_id, grade)
    select s.id, p_grade from public.learning_sections s
    where s.id = any(p_sections) and s.grade <> 'private' and s.grade <> p_grade
    on conflict do nothing;
    get diagnostics n = row_count;
    -- امنح الطلاب المقبولين في الصف المُشارَك معه
    insert into public.student_section_access (student_id, section_id)
    select p.id, s.id
    from public.student_profiles p
    join public.learning_sections s on s.id = any(p_sections) and s.grade <> 'private' and s.grade <> p_grade
    where p.grade = p_grade and p.status = 'approved'
      and not exists (select 1 from public.app_admins ad where ad.user_id = p.id)
    on conflict do nothing;
  end if;
  return n;
end;
$$;

revoke all on function public.admin_share_sections(uuid[], text, boolean) from public, anon;
revoke all on function public.section_for_grade(uuid, text, text)         from public, anon;
grant execute on function public.admin_share_sections(uuid[], text, boolean) to authenticated;
grant execute on function public.section_for_grade(uuid, text, text)         to authenticated;
grant execute on function public.can_read_section(uuid)                      to authenticated;
grant execute on function public.student_chapters()                          to authenticated;
grant execute on function public.admin_grant_sections(uuid[], text, text, uuid[], boolean) to authenticated;
grant execute on function public.admin_approve_student(uuid, boolean, uuid[]) to authenticated;
