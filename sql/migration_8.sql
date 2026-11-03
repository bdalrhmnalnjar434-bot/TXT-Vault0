-- =====================================================================
-- TXT Vault — تحديث 8: طلبات إعادة تعيين كلمة المرور عبر البوت
-- شغّل هذا الملف في SQL Editor بعد migration_7.sql (آمن لإعادة التشغيل).
--
-- الفكرة: الطالب يطلب من البوت → يظهر الطلب للمشرف مع رقم الطالب →
-- المشرف يوافق → النظام يولّد كلمة مؤقتة ويبعتها للطالب في البوت →
-- أول دخول يُجبر الطالب على اختيار كلمة مرور جديدة.
-- =====================================================================

alter table public.student_profiles
  add column if not exists must_change_password boolean not null default false;

create table if not exists public.password_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.student_profiles(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','done','rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

-- طلب واحد معلّق فقط لكل طالب
create unique index if not exists uq_pwreq_pending
  on public.password_requests(user_id) where status = 'pending';

alter table public.password_requests enable row level security;
-- لا سياسات: القراءة للمشرف عبر الدالة أدناه، والكتابة من الخادم (البوت/الدالة) فقط.

create or replace function public.admin_list_password_requests()
returns table (
  id uuid, user_id uuid, full_name text, email text, grade text,
  phone text, telegram_username text, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select r.id, r.user_id, p.full_name, p.email, p.grade,
           t.phone, t.telegram_username, r.created_at
    from public.password_requests r
    join public.student_profiles p on p.id = r.user_id
    left join public.telegram_links t on t.user_id = r.user_id
    where r.status = 'pending'
    order by r.created_at;
end;
$$;

-- الطالب بعد اختيار كلمة مرور جديدة
create or replace function public.clear_must_change_password()
returns void
language sql security definer set search_path = public as $$
  update public.student_profiles set must_change_password = false where id = auth.uid();
$$;

revoke all on function public.admin_list_password_requests() from public, anon;
revoke all on function public.clear_must_change_password()   from public, anon;
grant execute on function public.admin_list_password_requests() to authenticated;
grant execute on function public.clear_must_change_password()   to authenticated;
