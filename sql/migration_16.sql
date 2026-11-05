-- migration_16: تحقق شبه يدوي من رقم واتساب (للطلاب اللي معندهمش تيليجرام)
-- الفكرة: الطالب يطلب كود من الموقع، يبعته لواتساب المشرف من رقمه هو (فده بيثبت إنه صاحب الرقم فعلًا)،
-- والمشرف يشوف الرقم والكود في لوحته ويتأكد إنهم مطابقين لرسالة الواتساب قبل ما يفعّل.
-- شغّله مرة واحدة في SQL Editor بعد migration_15.

alter table public.student_profiles
  add column if not exists manual_code text,
  add column if not exists manual_code_at timestamptz;

-- الطالب يطلب كود تحقق (أو يرجّعله نفس الكود لو طلب قبل كده بأقل من دقيقتين، عشان رسالة الواتساب تفضل صحيحة)
create or replace function public.request_manual_verification(p_phone text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  phone text := regexp_replace(trim(coalesce(p_phone, '')), '[^0-9]', '', 'g');
  existing record;
  code text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if length(phone) < 8 then raise exception 'bad_phone'; end if;

  select manual_code, manual_code_at into existing
  from public.student_profiles where id = auth.uid();

  if existing.manual_code is not null and existing.manual_code_at > now() - interval '2 minutes' then
    code := existing.manual_code; -- نفس الكود عشان ميتبعتش كودين مختلفين بالغلط
  else
    code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  end if;

  update public.student_profiles
     set manual_phone = phone, manual_code = code, manual_code_at = now()
   where id = auth.uid();

  return code;
end;
$$;

-- تفعيل يدوي: نمسح الكود بعد التفعيل عشان ميتعادش استخدامه
create or replace function public.admin_manual_activate(p_user uuid, p_phone text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.student_profiles
     set manual_activation = true,
         manual_phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), manual_phone),
         manual_activated_at = now(),
         manual_activated_by = auth.uid(),
         manual_code = null,
         manual_code_at = null
   where id = p_user;
  if not found then raise exception 'not_found'; end if;
end;
$$;

revoke all on function public.request_manual_verification(text) from public, anon;
grant execute on function public.request_manual_verification(text) to authenticated;
