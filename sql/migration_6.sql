-- =====================================================================
-- TXT Vault — تحديث 6: ربط الحساب بجهازين فقط (موبايل واحد + كمبيوتر واحد)
-- شغّل هذا الملف في SQL Editor بعد migration_5.sql (آمن لإعادة التشغيل).
-- ⚠️ لو شغّلت schema.sql أو migration_2.sql مرة ثانية بعده، أعد تشغيل هذا الملف.
--
-- الفكرة: كل طالب له خانتان: mobile و desktop. أول جهاز من كل نوع يُسجَّل،
-- وأي جهاز آخر من نفس النوع يُمنع من قراءة المحتوى (الحماية في قاعدة البيانات).
-- =====================================================================

create table if not exists public.student_devices (
  user_id    uuid not null references public.student_profiles(id) on delete cascade,
  kind       text not null check (kind in ('mobile','desktop')),
  device_id  text not null,
  label      text,
  session_id text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.student_devices enable row level security;

-- القراءة للمشرف فقط. الكتابة عبر الدوال أدناه فقط.
drop policy if exists devices_admin_select on public.student_devices;
create policy devices_admin_select on public.student_devices
  for select to authenticated using (public.is_admin());

-- تسجيل/فحص الجهاز الحالي. يرجع: ok | blocked | bad_request | unauthorized
create or replace function public.register_device(p_device_id text, p_kind text, p_label text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sid text := auth.jwt() ->> 'session_id';
  r public.student_devices;
begin
  if auth.uid() is null then return 'unauthorized'; end if;
  if public.is_admin() then return 'ok'; end if;
  if p_kind not in ('mobile','desktop') or coalesce(length(p_device_id), 0) < 16 then
    return 'bad_request';
  end if;

  insert into public.student_devices (user_id, kind, device_id, label, session_id)
  values (auth.uid(), p_kind, p_device_id, left(p_label, 80), v_sid)
  on conflict (user_id, kind) do nothing;

  select * into r from public.student_devices where user_id = auth.uid() and kind = p_kind;

  if r.device_id = p_device_id then
    update public.student_devices
       set session_id = v_sid, last_seen = now(), label = coalesce(left(p_label, 80), label)
     where user_id = auth.uid() and kind = p_kind;
    return 'ok';
  end if;
  return 'blocked';
end;
$$;

-- هل جلسة المستخدم الحالية تخص جهازًا مسجّلًا؟ (المشرف دائمًا نعم)
create or replace function public.device_allowed()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (auth.jwt() ->> 'session_id') is null
      or exists (
        select 1 from public.student_devices d
        where d.user_id = auth.uid() and d.session_id = auth.jwt() ->> 'session_id'
      );
$$;

-- نفس شروط القراءة السابقة + شرط الجهاز (يغطي المحتوى وملفات التخزين وسجل الفتح)
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
               and public.grade_visible(s.grade)
               and (s.grade = 'private' or s.grade = p.grade)
           ) );
$$;

-- المشرف: إعادة ضبط جهاز (kind = 'mobile' | 'desktop') أو الاثنين (kind = null)
create or replace function public.admin_reset_devices(p_user uuid, p_kind text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.student_devices
   where user_id = p_user and (p_kind is null or kind = p_kind);
end;
$$;

revoke all on function public.register_device(text, text, text) from public, anon;
revoke all on function public.admin_reset_devices(uuid, text)    from public, anon;
grant execute on function public.register_device(text, text, text) to authenticated;
grant execute on function public.device_allowed()                  to authenticated;
grant execute on function public.can_read_section(uuid)            to authenticated;
grant execute on function public.admin_reset_devices(uuid, text)   to authenticated;
