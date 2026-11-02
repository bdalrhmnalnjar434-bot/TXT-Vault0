-- =====================================================================
-- TXT Vault — قاعدة البيانات الكاملة (Supabase / PostgreSQL)
-- شغّل الملف كاملًا مرة واحدة من: Supabase Dashboard → SQL Editor
-- الملف آمن لإعادة التشغيل (idempotent) قدر الإمكان.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الجداول
-- ---------------------------------------------------------------------

-- حسابات الإدارة المصرح بها (تُضاف يدويًا فقط من SQL Editor)
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- بيانات الطالب والصف وحالة الموافقة
create table if not exists public.student_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text,
  grade      text not null default 'first' check (grade in ('first','second')),
  status     text not null default 'pending'
             check (status in ('pending','approved','rejected','suspended')),
  created_at timestamptz not null default now()
);

-- ربط الحساب بتيليجرام والتحقق (الكتابة هنا تتم من الخادم فقط)
create table if not exists public.telegram_links (
  user_id            uuid primary key references public.student_profiles(id) on delete cascade,
  link_code          text unique,
  telegram_id        bigint unique,
  telegram_username  text,
  phone              text unique,
  phone_verified     boolean not null default false,
  channel_member     boolean not null default false,
  channel_checked_at timestamptz,
  linked_at          timestamptz
);

-- المواد والفصول
create table if not exists public.learning_sections (
  id           uuid primary key default gen_random_uuid(),
  grade        text not null check (grade in ('first','second')),
  subject      text not null check (subject in ('JavaScript','Python')),
  title        text not null,
  position     int  not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now()
);

-- المحتوى والملفات
create table if not exists public.learning_content (
  id           uuid primary key default gen_random_uuid(),
  section_id   uuid not null references public.learning_sections(id) on delete cascade,
  title        text not null,
  kind         text not null check (kind in ('txt','pdf','video')),
  body         text,          -- نص ملفات TXT
  external_url text,          -- رابط تيليجرام أو تخزين خارجي للـ PDF والفيديو
  position     int  not null default 0,
  created_at   timestamptz not null default now(),
  constraint content_has_payload check (
    (kind = 'txt'  and body is not null) or
    (kind <> 'txt' and external_url is not null)
  )
);

-- الفصول المسموح بها لكل طالب
create table if not exists public.student_section_access (
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  section_id uuid not null references public.learning_sections(id) on delete cascade,
  primary key (student_id, section_id)
);

create index if not exists idx_sections_grade   on public.learning_sections(grade, subject, position);
create index if not exists idx_content_section  on public.learning_content(section_id, position);
create index if not exists idx_profiles_status  on public.student_profiles(status);

-- ---------------------------------------------------------------------
-- 2) دوال مساعدة للصلاحيات (security definer حتى لا تدخل في حلقة RLS)
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- الطالب "مفعّل" = موافق عليه + مشترك في القناة (تم فحصه مؤخرًا) + رقم هاتف موثّق
create or replace function public.is_student_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.student_profiles p
    join public.telegram_links t on t.user_id = p.id
    where p.id = auth.uid()
      and p.status = 'approved'
      and t.telegram_id is not null
      and t.channel_member
      and t.phone_verified
      and t.channel_checked_at > now() - interval '12 hours'
  );
$$;

-- هل يحق للمستخدم الحالي قراءة محتوى هذا الفصل؟
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
               and s.grade = p.grade
               and s.is_published
           ) );
$$;

-- ---------------------------------------------------------------------
-- 3) إنشاء ملف الطالب تلقائيًا عند التسجيل
--    (الحالة دائمًا pending؛ لا يمكن للمستخدم تحديدها)
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g text := coalesce(new.raw_user_meta_data->>'grade', 'first');
begin
  if g not in ('first','second') then g := 'first'; end if;
  insert into public.student_profiles (id, full_name, email, grade, status)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'full_name', ''), 100),
    new.email,
    g,
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- عند إضافة فصل جديد: يُمنح تلقائيًا للطلاب الموافق عليهم في نفس الصف
create or replace function public.grant_new_section()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.student_section_access (student_id, section_id)
  select p.id, new.id from public.student_profiles p
  where p.grade = new.grade and p.status = 'approved'
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_section_created on public.learning_sections;
create trigger on_section_created
  after insert on public.learning_sections
  for each row execute function public.grant_new_section();

-- ---------------------------------------------------------------------
-- 4) دوال RPC
-- ---------------------------------------------------------------------

-- الطالب يطلب كود ربط تيليجرام (يُستخدم في رابط /start)
create or replace function public.create_telegram_link()
returns text
language plpgsql security definer set search_path = public as $$
declare
  code text := replace(gen_random_uuid()::text, '-', '');
  already boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select telegram_id is not null into already
  from public.telegram_links where user_id = auth.uid();

  if coalesce(already, false) then
    return null;  -- مربوط بالفعل
  end if;

  insert into public.telegram_links (user_id, link_code)
  values (auth.uid(), code)
  on conflict (user_id) do update set link_code = excluded.link_code;

  return code;
end;
$$;

-- المشرف: تغيير حالة الطالب
create or replace function public.admin_set_student_status(p_user uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','approved','rejected','suspended') then
    raise exception 'invalid status';
  end if;

  update public.student_profiles set status = p_status where id = p_user;

  -- عند الموافقة: امنح كل فصول صفه المنشورة (يمكن للمشرف تقليلها لاحقًا)
  if p_status = 'approved' then
    insert into public.student_section_access (student_id, section_id)
    select p_user, s.id
    from public.learning_sections s
    join public.student_profiles p on p.id = p_user and p.grade = s.grade
    on conflict do nothing;
  end if;
end;
$$;

-- المشرف: نقل الطالب بين الصفوف (يغيّر صلاحياته الفعلية)
create or replace function public.admin_set_student_grade(p_user uuid, p_grade text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_grade not in ('first','second') then raise exception 'invalid grade'; end if;

  delete from public.student_section_access where student_id = p_user;
  update public.student_profiles set grade = p_grade where id = p_user;

  insert into public.student_section_access (student_id, section_id)
  select p_user, s.id
  from public.learning_sections s
  join public.student_profiles p on p.id = p_user
  where s.grade = p_grade and p.status = 'approved'
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) RLS — تفعيل على كل الجداول
-- ---------------------------------------------------------------------

alter table public.app_admins              enable row level security;
alter table public.student_profiles        enable row level security;
alter table public.telegram_links          enable row level security;
alter table public.learning_sections       enable row level security;
alter table public.learning_content        enable row level security;
alter table public.student_section_access  enable row level security;

-- تنظيف السياسات القديمة لإعادة التشغيل
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('app_admins','student_profiles','telegram_links',
                        'learning_sections','learning_content','student_section_access')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- app_admins: يرى المستخدم سجله فقط. لا إضافة ولا تعديل من التطبيق.
create policy admins_select_self on public.app_admins
  for select to authenticated using (user_id = auth.uid());

-- student_profiles: الطالب يقرأ ملفه فقط، والمشرف يقرأ الكل.
-- لا توجد سياسة تعديل للطلاب إطلاقًا → لا يستطيع تغيير الصف أو الحالة.
create policy profiles_select on public.student_profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.student_profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_admin_delete on public.student_profiles
  for delete to authenticated using (public.is_admin());

-- telegram_links: قراءة فقط للطالب (الكتابة من Edge Functions بمفتاح service_role)
create policy tg_select on public.telegram_links
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- learning_sections: الطالب الموافق عليه يرى فصول صفه المسموحة فقط
create policy sections_select on public.learning_sections
  for select to authenticated using (
    public.is_admin()
    or ( is_published
         and exists (
           select 1
           from public.student_profiles p
           join public.student_section_access a
             on a.student_id = p.id and a.section_id = learning_sections.id
           where p.id = auth.uid() and p.status = 'approved' and p.grade = learning_sections.grade
         ) )
  );
create policy sections_admin_write on public.learning_sections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- learning_content: القراءة مرتبطة بدالة can_read_section عند كل طلب
create policy content_select on public.learning_content
  for select to authenticated using (public.can_read_section(section_id));
create policy content_admin_write on public.learning_content
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- student_section_access: الطالب يقرأ صلاحياته، والمشرف يديرها
create policy access_select on public.student_section_access
  for select to authenticated using (student_id = auth.uid() or public.is_admin());
create policy access_admin_write on public.student_section_access
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 6) صلاحيات التنفيذ والجداول
-- ---------------------------------------------------------------------

revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;

grant select, insert, update, delete on all tables in schema public to authenticated;
-- الطالب لا يكتب في telegram_links ولا student_profiles إلا عبر السياسات أعلاه (غير موجودة للكتابة)

grant execute on function public.is_admin()                           to authenticated;
grant execute on function public.is_student_active()                  to authenticated;
grant execute on function public.can_read_section(uuid)               to authenticated;
grant execute on function public.create_telegram_link()               to authenticated;
grant execute on function public.admin_set_student_status(uuid,text)  to authenticated;
grant execute on function public.admin_set_student_grade(uuid,text)   to authenticated;

-- ---------------------------------------------------------------------
-- 7) بيانات أولية: فصول مبدئية (عدّلها من لوحة الإدارة)
-- ---------------------------------------------------------------------

insert into public.learning_sections (grade, subject, title, position)
select v.grade, v.subject, v.title, v.position
from (values
  ('first',  'JavaScript', 'الفصل الأول',  1),
  ('first',  'JavaScript', 'الفصل الثاني', 2),
  ('first',  'JavaScript', 'الفصل الثالث', 3),
  ('second', 'JavaScript', 'الفصل الأول',  1),
  ('second', 'JavaScript', 'الفصل الثاني', 2),
  ('second', 'JavaScript', 'الفصل الثالث', 3),
  ('second', 'Python',     'الفصل الأول',  1),
  ('second', 'Python',     'الفصل الثاني', 2),
  ('second', 'Python',     'الفصل الثالث', 3)
) as v(grade, subject, title, position)
where not exists (select 1 from public.learning_sections);

-- ---------------------------------------------------------------------
-- 8) تعيين حساب المشرف (نفّذ هذا السطر بعد إنشاء حسابك من register.html)
--    استبدل البريد ببريدك:
-- ---------------------------------------------------------------------
-- insert into public.app_admins (user_id)
-- select id from auth.users where email = 'YOUR_EMAIL@example.com'
-- on conflict do nothing;
