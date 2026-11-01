-- =====================================================================
-- TXT Vault — تحديث 2
-- شغّل هذا الملف في SQL Editor بعد schema.sql (آمن لإعادة التشغيل).
-- يضيف: قسم «خاصة»، إظهار/إخفاء الأقسام، تخزين الملفات (Storage)،
--       سلة المحذوفات، سجل الفتح والتنزيل.
-- ⚠️ لو شغّلت schema.sql مرة ثانية بعد هذا الملف، أعد تشغيل هذا الملف.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) تعديل الجداول
-- ---------------------------------------------------------------------

-- الأقسام: صف خاصة + مواد حرة
alter table public.learning_sections drop constraint if exists learning_sections_grade_check;
alter table public.learning_sections add constraint learning_sections_grade_check
  check (grade in ('first','second','private'));
alter table public.learning_sections drop constraint if exists learning_sections_subject_check;

-- المحتوى: ملفات Storage + سلة + ترقيم فصول + مجلدات
alter table public.learning_content add column if not exists storage_path  text;
alter table public.learning_content add column if not exists file_size     bigint;
alter table public.learning_content add column if not exists original_name text;
alter table public.learning_content add column if not exists chapter_no    int;
alter table public.learning_content add column if not exists folder        text;
alter table public.learning_content add column if not exists deleted_at    timestamptz;

alter table public.learning_content drop constraint if exists learning_content_kind_check;
alter table public.learning_content add constraint learning_content_kind_check
  check (kind in ('txt','pdf','video','zip','file'));

alter table public.learning_content drop constraint if exists content_has_payload;
alter table public.learning_content add constraint content_has_payload check (
  (kind = 'txt'  and (body is not null or storage_path is not null)) or
  (kind <> 'txt' and (external_url is not null or storage_path is not null))
);

create index if not exists idx_content_deleted on public.learning_content(deleted_at);
create index if not exists idx_content_path    on public.learning_content(storage_path);

-- إعدادات عامة (إظهار/إخفاء الأقسام الثلاثة)
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value)
values ('grade_visible', '{"first": true, "second": true, "private": true}'::jsonb)
on conflict (key) do nothing;

-- سجل الفتح والتنزيل
create table if not exists public.access_log (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.student_profiles(id) on delete cascade,
  content_id    uuid references public.learning_content(id) on delete set null,
  content_title text,
  action        text not null check (action in ('view','download','copy')),
  created_at    timestamptz not null default now()
);
create index if not exists idx_log_created on public.access_log(created_at desc);

-- ---------------------------------------------------------------------
-- 2) الدوال
-- ---------------------------------------------------------------------

create or replace function public.grade_visible(g text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> g)::boolean from public.app_settings where key = 'grade_visible'), true);
$$;

-- القراءة: مشرف، أو طالب مفعّل لديه الفصل، والقسم ظاهر، والصف مطابق (إلا «خاصة»)
create or replace function public.can_read_section(sec uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or ( public.is_student_active()
           and exists (
             select 1
             from public.student_section_access a
             join public.learning_sections s on s.id = a.section_id
             join public.student_profiles  p on p.id = a.student_id
             where a.student_id = auth.uid()
               and a.section_id = sec
               and s.is_published
               and public.grade_visible(s.grade)
               and (s.grade = 'private' or s.grade = p.grade)
           ) );
$$;

-- الفصل الجديد لا يُمنح تلقائيًا في قسم «خاصة»
create or replace function public.grant_new_section()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.grade = 'private' then return new; end if;
  insert into public.student_section_access (student_id, section_id)
  select p.id, new.id from public.student_profiles p
  where p.grade = new.grade and p.status = 'approved'
  on conflict do nothing;
  return new;
end;
$$;

-- نقل الطالب بين الصفوف: لا يمسّ صلاحياته في «خاصة»
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
  where s.grade = p_grade and p.status = 'approved'
  on conflict do nothing;
end;
$$;

-- تسجيل الفتح/التنزيل/النسخ (الطلاب فقط، ويتحقق من حق القراءة)
create or replace function public.log_access(p_content uuid, p_action text)
returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if auth.uid() is null or public.is_admin() then return; end if;
  if p_action not in ('view','download','copy') then return; end if;

  select id, title, section_id into c
  from public.learning_content where id = p_content and deleted_at is null;
  if not found then return; end if;
  if not public.can_read_section(c.section_id) then return; end if;

  insert into public.access_log (user_id, content_id, content_title, action)
  values (auth.uid(), c.id, c.title, p_action);
end;
$$;

grant execute on function public.grade_visible(text)           to authenticated;
grant execute on function public.log_access(uuid, text)        to authenticated;
grant execute on function public.can_read_section(uuid)        to authenticated;
grant execute on function public.admin_set_student_grade(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.access_log   enable row level security;

drop policy if exists settings_select      on public.app_settings;
drop policy if exists settings_admin_write on public.app_settings;
create policy settings_select on public.app_settings
  for select to authenticated using (true);
create policy settings_admin_write on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists log_admin_select on public.access_log;
create policy log_admin_select on public.access_log
  for select to authenticated using (public.is_admin());
-- لا توجد سياسة إدخال: الكتابة عبر log_access() فقط

-- الفصول: الطالب يرى فصول صفه + فصول «خاصة» الممنوحة له، بشرط أن يكون القسم ظاهرًا
drop policy if exists sections_select on public.learning_sections;
create policy sections_select on public.learning_sections
  for select to authenticated using (
    public.is_admin()
    or ( is_published
         and public.grade_visible(grade)
         and exists (
           select 1
           from public.student_profiles p
           join public.student_section_access a
             on a.student_id = p.id and a.section_id = learning_sections.id
           where p.id = auth.uid() and p.status = 'approved'
             and (learning_sections.grade = 'private' or p.grade = learning_sections.grade)
         ) )
  );

-- المحتوى: لا يظهر المحذوف (في السلة) للطلاب
drop policy if exists content_select on public.learning_content;
create policy content_select on public.learning_content
  for select to authenticated using (deleted_at is null and public.can_read_section(section_id));

-- ---------------------------------------------------------------------
-- 4) صلاحيات الجداول الجديدة
-- ---------------------------------------------------------------------

revoke all on public.app_settings from anon;
revoke all on public.access_log   from anon;
grant select, insert, update, delete on public.app_settings to authenticated;
grant select                         on public.access_log   to authenticated;

-- ---------------------------------------------------------------------
-- 5) التخزين الخاص (Storage) — حد الملف 50MB (حد الخطة المجانية)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists vault_admin_all    on storage.objects;
drop policy if exists vault_student_read on storage.objects;

create policy vault_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'vault' and public.is_admin())
  with check (bucket_id = 'vault' and public.is_admin());

-- الطالب يقرأ الملف فقط إن كان يحق له قراءة فصله (وليس في السلة)
create policy vault_student_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vault'
    and exists (
      select 1 from public.learning_content c
      where c.storage_path = storage.objects.name
        and c.deleted_at is null
        and public.can_read_section(c.section_id)
    )
  );
