// Edge Function: notify-content
// يرسل المشرف إشعارًا بإضافة محتوى جديد:
//   mode = "grade"   → رسالة خاصة من البوت لطلاب نفس الصف (أو لمن لديهم الفصل في «خاصة»)
//   mode = "channel" → رسالة في القناة (للكل)
// لا تُرسل أي ملفات؛ فقط اسم الفصل وعناوين المحتوى.
//
// النشر:  supabase functions deploy notify-content
// أسرار اختيارية: SITE_URL (رابط الموقع ليظهر في الرسالة)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GRADE_LABEL: Record<string, string> = { first: "أولى بكالوريا", second: "ثانية بكالوريا", private: "خاصة" };

async function send(chat_id: number | string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
  });
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1) التحقق أن المستدعي مشرف
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return json({ error: "unauthorized" }, 401);
    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle();
    if (!adminRow) return json({ error: "forbidden" }, 403);

    // 2) المدخلات
    const body = await req.json();
    const mode: string = body.mode;
    const titles: string[] = (Array.isArray(body.titles) ? body.titles : []).map((t: unknown) => String(t)).slice(0, 20);
    const { data: sec } = await db.from("learning_sections")
      .select("id, grade, subject, title").eq("id", body.section_id).maybeSingle();
    if (!sec) return json({ error: "section_not_found" }, 404);
    if (!titles.length) return json({ error: "no_titles" }, 400);
    if (!["grade", "channel"].includes(mode)) return json({ error: "bad_mode" }, 400);
    if (mode === "channel" && sec.grade === "private") return json({ error: "private_not_for_channel" }, 400);

    const where = sec.grade === "private" ? "خاصة" : `${GRADE_LABEL[sec.grade]} — ${sec.subject}`;
    const text =
      `📚 محتوى جديد في TXT Vault\n${where} • ${sec.title}\n\n` +
      titles.map((t) => `• ${t}`).join("\n") +
      (SITE_URL ? `\n\n${SITE_URL}` : "\n\nادخل الموقع للاطلاع عليه.");

    // 3) الإرسال
    if (mode === "channel") {
      const ok = await send(CHANNEL_ID, text);
      return json({ sent: ok ? 1 : 0, failed: ok ? 0 : 1 });
    }

    // طلاب الصف المفعّلون (وفي «خاصة»: من لديهم الفصل فقط)
    let ids: string[] = [];
    if (sec.grade === "private") {
      const { data } = await db.from("student_section_access").select("student_id").eq("section_id", sec.id);
      ids = (data ?? []).map((r) => r.student_id);
    } else {
      const { data } = await db.from("student_profiles")
        .select("id").eq("grade", sec.grade).eq("status", "approved");
      ids = (data ?? []).map((r) => r.id);
    }
    if (!ids.length) return json({ sent: 0, failed: 0 });

    const { data: links } = await db.from("telegram_links")
      .select("telegram_id").in("user_id", ids).not("telegram_id", "is", null);

    let sent = 0, failed = 0;
    for (const l of links ?? []) {
      (await send(l.telegram_id as number, text)) ? sent++ : failed++;
      await new Promise((r) => setTimeout(r, 60)); // احترام حد تيليجرام
    }
    return json({ sent, failed });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
