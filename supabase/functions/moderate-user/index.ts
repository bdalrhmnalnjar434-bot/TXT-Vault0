// Edge Function: moderate-user
// المشرف يحظر/يفك حظر/يطرد طالبًا من القناة الخاصة عبر البوت:
//   action = "ban"   → حظر من القناة (لا يستطيع الرجوع حتى لو معه رابط)
//   action = "unban" → فك الحظر (يستطيع الانضمام من جديد)
//   action = "kick"  → طرد فقط (يستطيع الانضمام من جديد) — يُستخدم قبل الحذف النهائي
// شرط: البوت أدمن في القناة وعنده صلاحية «حظر المستخدمين» (Ban users).
//
// النشر من لوحة Supabase: Edge Functions ← Deploy a new function ← Via Editor
//   الاسم: moderate-user  •  Verify JWT: ON (الافتراضي)
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

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({ ok: false, description: "bad response" }));
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
    const userId = String(body.user_id ?? "");
    const action = String(body.action ?? "");
    if (!userId || !["ban", "unban", "kick"].includes(action)) return json({ error: "bad_request" }, 400);

    // لا نستهدف المشرفين أبدًا
    const { data: isAdminTarget } = await db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
    if (isAdminTarget) return json({ error: "cannot_target_admin" }, 400);

    // 3) حساب تيليجرام المربوط
    const { data: link } = await db.from("telegram_links").select("telegram_id").eq("user_id", userId).maybeSingle();
    if (!link?.telegram_id) return json({ channel: "no_telegram" });
    const tgId = link.telegram_id as number;

    // 4) التنفيذ
    let r: any;
    if (action === "ban") {
      r = await tg("banChatMember", { chat_id: CHANNEL_ID, user_id: tgId });
      if (r.ok) {
        await db.from("telegram_links").update({ channel_member: false, channel_checked_at: new Date().toISOString() }).eq("user_id", userId);
      }
    } else if (action === "unban") {
      r = await tg("unbanChatMember", { chat_id: CHANNEL_ID, user_id: tgId, only_if_banned: true });
    } else {
      r = await tg("banChatMember", { chat_id: CHANNEL_ID, user_id: tgId });
      if (r.ok) r = await tg("unbanChatMember", { chat_id: CHANNEL_ID, user_id: tgId, only_if_banned: true });
    }

    if (!r.ok) return json({ channel: "failed", detail: r.description ?? "telegram error" });
    return json({ channel: "done" });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
