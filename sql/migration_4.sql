-- =====================================================================
-- TXT Vault — تحديث 4: سجل الرسائل المرسلة من لوحة المشرف عبر البوت
-- شغّل هذا الملف في SQL Editor بعد migration_3.sql (آمن لإعادة التشغيل).
-- =====================================================================

create table if not exists public.broadcasts (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid references auth.users(id) on delete set null,
  audience    text not null check (audience in ('all','first','second','selected','channel')),
  body        text not null,
  total       int  not null default 0,   -- عدد المستلمين المربوطين بتيليجرام
  sent        int  not null default 0,
  failed      int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_broadcasts_created on public.broadcasts(created_at desc);

alter table public.broadcasts enable row level security;

-- القراءة للمشرف فقط. الكتابة تتم من دالة send-message بمفتاح الخادم (لا سياسة كتابة).
drop policy if exists broadcasts_admin_select on public.broadcasts;
create policy broadcasts_admin_select on public.broadcasts
  for select to authenticated using (public.is_admin());
