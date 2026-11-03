-- =====================================================================
-- TXT Vault — تحديث 3: حظر كامل + حذف نهائي للحساب
-- شغّل هذا الملف في SQL Editor بعد schema.sql و migration_2.sql (آمن لإعادة التشغيل).
-- ⚠️ لو شغّلت schema.sql مرة ثانية بعده، أعد تشغيل هذا الملف.
-- =====================================================================

-- 1) حالة جديدة: blocked (حظر كامل)
alter table public.student_profiles drop constraint if exists student_profiles_status_check;
alter table public.student_profiles add constraint student_profiles_status_check
  check (status in ('pending','approved','rejected','suspended','blocked'));

-- 2) تغيير الحالة (يقبل الحالة الجديدة)
create or replace function public.admin_set_student_status(p_user uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','approved','rejected','suspended','blocked') then
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

-- 3) حذف نهائي: يمسح الحساب من نظام الدخول فتُحذف معه كل بياناته تلقائيًا
--    (الملف الشخصي، ربط تيليجرام، صلاحيات الفصول، سجل الفتح).
--    لو سجّل بنفس البريد بعدها يكون حسابًا جديدًا تمامًا.
create or replace function public.admin_delete_student(p_user uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot delete yourself'; end if;
  if exists (select 1 from public.app_admins where user_id = p_user) then
    raise exception 'cannot delete an admin';
  end if;
  delete from auth.users where id = p_user;
end;
$$;

revoke all on function public.admin_delete_student(uuid) from public, anon;
grant execute on function public.admin_set_student_status(uuid,text) to authenticated;
grant execute on function public.admin_delete_student(uuid)          to authenticated;
