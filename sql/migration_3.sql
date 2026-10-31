-- =====================================================================
-- TXT Vault — تحديث 3
-- شغّله في SQL Editor بعد schema.sql و migration_2.sql (آمن لإعادة التشغيل).
-- يضيف: تذاكر الدعم (مشكلة يوميًا + طلب رسائل إضافية) + عرض telegram_students.
-- =====================================================================

create table if not exists public.support_tickets (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.student_profiles(id) on delete cascade,
  kind        text not null default 'problem' check (kind in ('problem','extra')),
  message     text,
  extra_count int,
  status      text not null default 'open'
              check (status in ('open','answered','approved','rejected')),
  admin_reply text,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

create index if not exists idx_tickets_user_day
  on public.support_tickets(user_id, created_at desc);

alter table public.telegram_links
  add column if not exists extra_messages int not null default 0;

-- مقفول على الموقع: الكتابة والقراءة من البوت (service_role) فقط
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon, authenticated;

-- عرض للإدارة: اسم الطالب + بيانات تيليجرام في مكان واحد (من لوحة Supabase فقط)
create or replace view public.telegram_students
with (security_invoker = on) as
select
  t.user_id,
  p.full_name,
  p.email,
  p.grade,
  p.status,
  t.telegram_username,
  t.phone,
  t.phone_verified,
  t.channel_member,
  t.linked_at
from public.telegram_links t
join public.student_profiles p on p.id = t.user_id;

revoke all on public.telegram_students from anon, authenticated;