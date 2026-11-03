-- ===========================================================
-- migration_13: وضع الصيانة (قفل الموقع عن كل الطلاب برسالة تكتبها أنت)
-- شغّله في Supabase > SQL Editor (مرة واحدة). آمن لإعادة التشغيل.
-- ملاحظة: لو أعدت تشغيل migration_11 أو schema لاحقًا، أعد تشغيل هذا الملف بعدها.
-- ===========================================================

-- هل الصيانة شغالة؟
create or replace function public.maintenance_on()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> 'on')::boolean from public.app_settings where key = 'maintenance'), false);
$$;

-- يقرأها الجميع (حتى قبل تسجيل الدخول) لعرض رسالة الصيانة
create or replace function public.get_maintenance()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'on',  public.maintenance_on(),
    'message', coalesce((select value ->> 'message' from public.app_settings where key = 'maintenance'), '')
  );
$$;

-- التشغيل/الإيقاف: للمالك فقط
create or replace function public.set_maintenance(p_on boolean, p_message text default '')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_is_owner() then raise exception 'forbidden'; end if;
  insert into public.app_settings (key, value, updated_at)
  values ('maintenance', jsonb_build_object('on', p_on, 'message', left(coalesce(p_message, ''), 500)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- أثناء الصيانة: الطالب لا يقرأ أي فصل أو ملف (حماية على مستوى قاعدة البيانات)
create or replace function public.can_read_section(sec uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or ( not public.maintenance_on()
           and public.is_student_active()
           and public.device_allowed()
           and exists (
             select 1
             from public.student_section_access a
             join public.learning_sections s on s.id = a.section_id
             join public.student_profiles  p on p.id = a.student_id
             where a.student_id = auth.uid()
               and a.section_id = sec
               and s.is_published
               and not s.is_locked
               and not s.content_deleted
               and public.grade_visible(case when s.grade = 'private' then 'private' else p.grade end)
               and public.section_for_grade(s.id, s.grade, p.grade)
           ) );
$$;

create or replace function public.student_chapters()
returns table (id uuid, grade text, subject text, title text, "position" int, state text)
language sql stable security definer set search_path = public as $$
  select s.id, s.grade, s.subject, s.title, s."position",
         case
           when s.content_deleted           then 'deleted'
           when a.section_id is null        then 'denied'
           when s.is_locked                 then 'locked'
           else 'open'
         end
  from public.learning_sections s
  join public.student_profiles p on p.id = auth.uid()
  left join public.student_section_access a on a.student_id = p.id and a.section_id = s.id
  where not public.maintenance_on()
    and public.is_student_active()
    and public.device_allowed()
    and s.is_published
    and public.grade_visible(case when s.grade = 'private' then 'private' else p.grade end)
    and ( (s.grade <> 'private' and public.section_for_grade(s.id, s.grade, p.grade))
          or (s.grade = 'private' and a.section_id is not null) )
  order by s.subject, s."position", s.created_at;
$$;

revoke all on function public.set_maintenance(boolean, text) from public, anon;
grant execute on function public.get_maintenance()  to anon, authenticated;
grant execute on function public.maintenance_on()   to anon, authenticated;
grant execute on function public.set_maintenance(boolean, text) to authenticated;
grant execute on function public.can_read_section(uuid) to authenticated;
grant execute on function public.student_chapters()     to authenticated;
