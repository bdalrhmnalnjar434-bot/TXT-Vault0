// Edge Function: check-membership
// يتحقق من جهة الخادم أن الطالب مشترك فعلًا في قناة تيليجرام (عبر getChatMember)،
// ثم يحدّث telegram_links. المتصفح لا يستطيع كتابة هذه القيمة بنفسه.
//
// النشر:  supabase functions deploy check-membership
// (يتطلب JWT المستخدم — الافتراضي)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authErr } = await db.auth.getUser(token);
    if (authErr || !auth?.user) return json({ error: "unauthorized" }, 401);

    const { data: link } = await db.from("telegram_links")
      .select("telegram_id").eq("user_id", auth.user.id).maybeSingle();

    if (!link?.telegram_id) return json({ linked: false, channel_member: false });

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember` +
      `?chat_id=${encodeURIComponent(CHANNEL_ID)}&user_id=${link.telegram_id}`;
    const tgRes = await (await fetch(url)).json();

    let isMember = false;
    if (tgRes.ok) {
      const st = tgRes.result?.status;
      isMember = ["member", "administrator", "creator"].includes(st) ||
        (st === "restricted" && tgRes.result?.is_member === true);
    } else {
      // خطأ من تيليجرام (مثلًا البوت ليس مشرفًا في القناة): لا نمنح الوصول
      console.error("getChatMember failed", tgRes);
      return json({ linked: true, channel_member: false, error: "telegram_error" }, 502);
    }

    await db.from("telegram_links").update({
      channel_member: isMember,
      channel_checked_at: new Date().toISOString(),
    }).eq("user_id", auth.user.id);

    return json({ linked: true, channel_member: isMember });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
