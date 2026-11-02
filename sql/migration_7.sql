-- =====================================================================
-- TXT Vault — تحديث 7: التسجيل عبر اختيار حساب Google
-- شغّل هذا الملف في SQL Editor بعد migration_6.sql (آمن لإعادة التشغيل).
-- ⚠️ لو شغّلت schema.sql مرة ثانية بعده، أعد تشغيل هذا الملف.
--
-- الفكرة: الطالب يختار بريده من حسابات Google (يتأكد البريد تلقائيًا)،
-- ثم يكمل الاسم الثلاثي والصف ويكتب كلمة المرور بنفسه.
-- =====================================================================

-- الحسابات الحالية تُعتبر مكتملة، والجديدة عبر Google تبدأ غير مكتملة
alter table public.student_profiles
  add column if not exists profile_completed boolean not null default true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g text := coalesce(new.raw_user_meta_data->>'grade', 'first');
  via_google boolean := coalesce(new.raw_app_meta_data->>'provider', '') = 'google';
begin
  if g not in ('first','second') then g := 'first'; end if;
  insert into public.student_profiles (id, full_name, email, grade, status, profile_completed)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 100),
    new.email,
    g,
    'pending',
    not via_google
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- إكمال التسجيل: الاسم والصف، مسموح فقط للحساب المعلّق وغير المكتمل
create or replace function public.complete_registration(p_name text, p_grade text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null then return 'unauthorized'; end if;
  if p_grade not in ('first','second') then return 'bad_grade'; end if;
  if array_length(string_to_array(n, ' '), 1) < 3 or length(n) > 100 then return 'bad_name'; end if;
  update public.student_profiles
     set full_name = n, grade = p_grade, profile_completed = true
   where id = auth.uid() and status = 'pending' and profile_completed = false;
  if not found then return 'not_allowed'; end if;
  return 'ok';
end;
$$;

revoke all on function public.complete_registration(text, text) from public, anon;
grant execute on function public.complete_registration(text, text) to authenticated;
