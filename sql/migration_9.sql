-- =====================================================================
-- TXT Vault — تحديث 9: حذف الرسائل المرسلة + مسح السجلات (للمالك فقط)
-- شغّل هذا الملف في SQL Editor بعد migration_8.sql (آمن لإعادة التشغيل).
-- =====================================================================

-- أرقام الرسائل المرسلة (لحذفها من عند الطلاب لاحقًا) ووقت حذفها
alter table public.broadcasts add column if not exists deliveries jsonb not null default '[]'::jsonb;
alter table public.broadcasts add column if not exists deleted_at timestamptz;

-- المسح الكامل للمالك فقط (الحماية هنا في قاعدة البيانات، لا في الواجهة)
create or replace function public.owner_clear_log()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  delete from public.access_log where true;
end;
$$;

create or replace function public.owner_clear_broadcasts()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  delete from public.broadcasts where true;
end;
$$;

-- يمسح الطلبات المنتهية (المنفّذة والمرفوضة) ويبقي المعلّقة
create or replace function public.owner_clear_password_requests()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  delete from public.password_requests where status <> 'pending';
end;
$$;

revoke all on function public.owner_clear_log()                from public, anon;
revoke all on function public.owner_clear_broadcasts()         from public, anon;
revoke all on function public.owner_clear_password_requests()  from public, anon;
grant execute on function public.owner_clear_log()                to authenticated;
grant execute on function public.owner_clear_broadcasts()         to authenticated;
grant execute on function public.owner_clear_password_requests()  to authenticated;
