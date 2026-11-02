// Edge Function: delete-broadcast
// المشرف يحذف رسالة أرسلها سابقًا من عند الطلاب (أو من القناة) عبر البوت.
// ملاحظة من تيليجرام: البوت يقدر يحذف رسائله فقط خلال ٤٨ ساعة من إرسالها.
//
// النشر من لوحة Supabase: Edge Functions ← Deploy a new function ← Via Editor
//   الاسم: delete-broadcast  •  Verify JWT: ON (الافتراضي)
// الأسرار المستخدمة: TELEGRAM_BOT_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return json({ error: "unauthorized" }, 401);
    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle();
    if (!adminRow) return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const id = String(body.broadcast_id ?? "");
    if (!id) return json({ error: "bad_request" }, 400);

    const { data: b } = await db.from("broadcasts").select("id, deliveries").eq("id", id).maybeSingle();
    if (!b) return json({ error: "not_found" }, 404);

    const list: { c: number | string; m: number }[] = Array.isArray(b.deliveries) ? b.deliveries : [];
    let deleted = 0, failed = 0;
    for (const d of list) {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: d.c, message_id: d.m }),
      });
      const j = await r.json().catch(() => ({}));
      j?.ok ? deleted++ : failed++;
      await sleep(60);
    }
    await db.from("broadcasts").update({ deliveries: [], deleted_at: new Date().toISOString() }).eq("id", id);
    return json({ deleted, failed, total: list.length });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
