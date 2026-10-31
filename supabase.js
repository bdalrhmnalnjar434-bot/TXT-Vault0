// =====================================================================
// supabase.js — إعداد الاتصال بـ Supabase
// ضع هنا Project URL و anon (public) key فقط.
// ⚠️ ممنوع وضع service_role key في أي ملف يصل للمتصفح.
// =====================================================================

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Supabase Dashboard → Project Settings → API
export const SUPABASE_URL = "https://ywrttyxfxmeosidoszjc.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_jZoqAZh23DpOsG5pSzKXsg_ZXvYfvq2";

// اسم البوت (بدون @) ورابط القناة — يظهران في صفحة الطالب
export const TELEGRAM_BOT_USERNAME = "bdalrhmnalnjar434_2010_bot";
export const TELEGRAM_CHANNEL_URL = "https://t.me/+inLoexMjf_I2ODQ0";

export const isConfigured =
  !SUPABASE_URL.includes("YOUR-PROJECT-ID") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : "https://placeholder.supabase.co",
  isConfigured ? SUPABASE_ANON_KEY : "placeholder-key",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export const GRADES = { first: "أولى بكالوريا", second: "ثانية بكالوريا" };
export const SUBJECTS = ["JavaScript", "Python"];
