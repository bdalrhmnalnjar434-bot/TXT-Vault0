// Edge Function: send-message
// المشرف يرسل رسالة نصية عبر البوت:
//   audience = "all"      → كل الطلاب المفعّلين المربوطين بتيليجرام
//   audience = "first"    → طلاب أولى بكالوريا المفعّلون
//   audience = "second"   → طلاب ثانية بكالوريا المفعّلون
//   audience = "selected" → طلاب محددون (user_ids)، ما عدا المحظورين
//   audience = "channel"  → منشور في القناة
// البوت لا يستطيع مراسلة من لم يضغط Start أو من حظر البوت (تُحسب ضمن «فشل»).
//
// النشر من لوحة Supabase: Edge Functions ← Deploy a new function ← Via Editor
//   الاسم: send-message  •  Verify JWT: ON (الافتراضي)
// الأسرار المستخدمة: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID")!;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// يرجع رقم الرسالة عند النجاح (نحتاجه لحذفها لاحقًا) أو null عند الفشل
async function send(chat_id: number | string, text: string, retry = true): Promise<number | null> {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j?.result?.message_id ?? null;
  // حد تيليجرام: ننتظر المدة المطلوبة ونعيد مرة واحدة
  if (r.status === 429 && retry) {
    await sleep(((j?.parameters?.retry_after ?? 2) + 1) * 1000);
    return send(chat_id, text, false);
  }
  return null;
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
    const audience: string = body.audience;
    const text = String(body.text ?? "").trim();
    if (!["all", "first", "second", "selected", "channel"].includes(audience)) return json({ error: "bad_audience" }, 400);
    if (!text) return json({ error: "empty_text" }, 400);
    if (text.length > 3500) return json({ error: "text_too_long" }, 400);

    const message = `📢 رسالة من الإدارة\n\n${text}`;
    let sent = 0, failed = 0, total = 0;
    const deliveries: { c: number | string; m: number }[] = [];

    if (audience === "channel") {
      total = 1;
      const mid = await send(CHANNEL_ID, message);
      if (mid) { sent++; deliveries.push({ c: CHANNEL_ID, m: mid }); } else failed++;
    } else {
      // 3) تحديد المستلمين
      let q = db.from("student_profiles").select("id");
      if (audience === "selected") {
        const ids: string[] = (Array.isArray(body.user_ids) ? body.user_ids : []).map(String).slice(0, 2000);
        if (!ids.length) return json({ error: "no_recipients" }, 400);
        q = q.in("id", ids).neq("status", "blocked");
      } else {
        q = q.eq("status", "approved");
        if (audience !== "all") q = q.eq("grade", audience);
      }
      const { data: studs } = await q;
      const ids = (studs ?? []).map((s) => s.id);
      if (!ids.length) return json({ sent: 0, failed: 0, total: 0 });

      const { data: links } = await db.from("telegram_links")
        .select("telegram_id").in("user_id", ids).not("telegram_id", "is", null);
      const targets = links ?? [];
      total = targets.length;

      // 4) الإرسال بسرعة آمنة (أقل من حد تيليجرام)
      for (const l of targets) {
        const mid = await send(l.telegram_id as number, message);
        if (mid) { sent++; deliveries.push({ c: l.telegram_id as number, m: mid }); } else failed++;
        await sleep(60);
      }
    }

    await db.from("broadcasts").insert({
      created_by: auth.user.id, audience, body: text, total, sent, failed, deliveries,
    });
    return json({ sent, failed, total });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
