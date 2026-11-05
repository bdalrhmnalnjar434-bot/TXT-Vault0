-- migration_15: تفعيل يدوي للطلاب اللي معندهمش تيليجرام
-- شغّله مرة واحدة في SQL Editor. (لو أعدت تشغيل schema.sql أو migration_13، أعد تشغيل هذا الملف بعدها)

alter table public.student_profiles
  add column if not exists manual_activation boolean not null default false,
  add column if not exists manual_phone text,
  add column if not exists manual_activated_at timestamptz,
  add column if not exists manual_activated_by uuid references auth.users(id);

-- الطالب نشط لو كل خطوات تيليجرام تمام، أو لو مفعّل يدويًا من المشرف (ومحتاج موافقة في الحالتين)
create or replace function public.is_student_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.student_profiles p
    where p.id = auth.uid()
      and p.status = 'approved'
      and (
        p.manual_activation
        or exists (
          select 1 from public.telegram_links t
          where t.user_id = p.id
            and t.telegram_id is not null
            and t.channel_member
            and t.phone_verified
            and t.channel_checked_at > now() - interval '12 hours'
        )
      )
  );
$$;

-- تفعيل يدوي: للمشرفين فقط. بيسجّل رقم الهاتف اللي بعته الطالب (من غير توثيق عبر البوت)
create or replace function public.admin_manual_activate(p_user uuid, p_phone text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.student_profiles
     set manual_activation = true,
         manual_phone = nullif(trim(coalesce(p_phone, '')), ''),
         manual_activated_at = now(),
         manual_activated_by = auth.uid()
   where id = p_user;
  if not found then raise exception 'not_found'; end if;
end;
$$;

create or replace function public.admin_revoke_manual_activation(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.student_profiles
     set manual_activation = false
   where id = p_user;
end;
$$;

revoke all on function public.admin_manual_activate(uuid, text) from public, anon;
revoke all on function public.admin_revoke_manual_activation(uuid) from public, anon;
grant execute on function public.admin_manual_activate(uuid, text)        to authenticated;
grant execute on function public.admin_revoke_manual_activation(uuid)     to authenticated;
grant execute on function public.is_student_active()                     to authenticated;
