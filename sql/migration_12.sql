-- =====================================================================
-- TXT Vault — تحديث 12: تقوية الأمان والتنظيف
-- شغّل هذا الملف في SQL Editor بعد migration_11.sql (آمن لإعادة التشغيل).
--  1) إنهاء كل جلسات الطالب بعد إعادة تعيين كلمة المرور
--  2) حذف ملفات المحتوى نهائيًا للمالك فقط (على مستوى قاعدة البيانات)
--  3) تنظيف الحسابات غير المكتملة (للمالك فقط)
-- =====================================================================

-- 1) تُستدعى من دالة reset-password بمفتاح الخادم فقط (لا يستطيع أي مستخدم استدعاءها)
create or replace function public.kill_user_sessions(p_user uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.sessions where user_id = p_user;
end;
$$;
revoke all on function public.kill_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.kill_user_sessions(uuid) to service_role;

-- 2) learning_content: المشرف يقرأ ويضيف ويعدّل، لكن الحذف النهائي للمالك فقط
drop policy if exists content_admin_write  on public.learning_content;
drop policy if exists content_admin_select on public.learning_content;
drop policy if exists content_admin_insert on public.learning_content;
drop policy if exists content_admin_update on public.learning_content;
drop policy if exists content_owner_delete on public.learning_content;

create policy content_admin_select on public.learning_content
  for select to authenticated using (public.is_admin());
create policy content_admin_insert on public.learning_content
  for insert to authenticated with check (public.is_admin());
create policy content_admin_update on public.learning_content
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy content_owner_delete on public.learning_content
  for delete to authenticated using (public.admin_is_owner());

-- 3) حذف الحسابات غير المكتملة (بدأت بـ Google ولم تكمل بيانات التسجيل) الأقدم من يومين
create or replace function public.owner_clear_incomplete_accounts()
returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  with gone as (
    delete from auth.users u
    using public.student_profiles p
    where p.id = u.id
      and p.profile_completed = false
      and p.created_at < now() - interval '2 days'
      and not exists (select 1 from public.app_admins a where a.user_id = u.id)
    returning u.id
  )
  select count(*) into n from gone;
  return n;
end;
$$;
revoke all on function public.owner_clear_incomplete_accounts() from public, anon;
grant execute on function public.owner_clear_incomplete_accounts() to authenticated;
