-- migration_14: الاسم الثلاثي إجباري ومش بيتملى من Google
-- شغّله مرة واحدة في SQL Editor. (لو أعدت migration_7 بعد كده، أعد تشغيل هذا الملف)

-- 1) حسابات Google تبدأ باسم فاضي (الطالب هو اللي يكتبه)
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
    case when via_google then '' else left(coalesce(new.raw_user_meta_data->>'full_name', ''), 100) end,
    new.email,
    g,
    'pending',
    not via_google
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 2) تحقق الاسم في قاعدة البيانات: 3 أجزاء على الأقل، كل جزء حرفين فأكثر، بدون أرقام أو رموز
create or replace function public.complete_registration(p_name text, p_grade text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  part text;
  cnt int := 0;
begin
  if auth.uid() is null then return 'unauthorized'; end if;
  if p_grade not in ('first','second') then return 'bad_grade'; end if;
  if length(n) > 100 then return 'bad_name'; end if;
  foreach part in array string_to_array(n, ' ') loop
    if part !~ '^[^[:space:][:digit:]_@#$%^&*()+=<>/\\|~`!?,;:"\[\]{}]{2,}$' then return 'bad_name'; end if;
    cnt := cnt + 1;
  end loop;
  if cnt < 3 then return 'bad_name'; end if;
  update public.student_profiles
     set full_name = n, grade = p_grade, profile_completed = true
   where id = auth.uid() and status = 'pending' and profile_completed = false;
  if not found then return 'not_allowed'; end if;
  return 'ok';
end;
$$;

revoke all on function public.complete_registration(text, text) from public, anon;
grant execute on function public.complete_registration(text, text) to authenticated;
