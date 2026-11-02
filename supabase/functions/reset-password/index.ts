// Edge Function: reset-password
// المشرف يوافق/يرفض طلب إعادة تعيين كلمة المرور:
//   action = "approve" → يولّد كلمة مؤقتة قوية، يضبطها للطالب، ويبعتها له في البوت
//   action = "reject"  → يرفض الطلب ويبلّغ الطالب
//
// النشر من لوحة Supabase: Edge Functions ← Deploy a new function ← Via Editor
//   الاسم: reset-password  •  Verify JWT: ON (الافتراضي)
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

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({ ok: false }));
}

function rnd(n: number) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
function pick(chars: string) { return chars[rnd(chars.length)]; }

// كلمة مؤقتة ١٢ حرفًا تحقق كل شروط الموقع (صغير + كبير + رقم + رمز)
function tempPassword() {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789", S = "@#$!%*";
  const all = U + L + D + S;
  const out = [pick(U), pick(L), pick(D), pick(S)];
  while (out.length < 12) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return json({ error: "unauthorized" }, 401);
    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle();
    if (!adminRow) return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const requestId = String(body.request_id ?? "");
    const action = String(body.action ?? "");
    if (!requestId || !["approve", "reject"].includes(action)) return json({ error: "bad_request" }, 400);

    const { data: reqRow } = await db.from("password_requests")
      .select("id, user_id, status").eq("id", requestId).maybeSingle();
    if (!reqRow || reqRow.status !== "pending") return json({ error: "not_pending" }, 400);

    const { data: isAdminTarget } = await db.from("app_admins").select("user_id").eq("user_id", reqRow.user_id).maybeSingle();
    if (isAdminTarget) return json({ error: "cannot_target_admin" }, 400);

    const { data: link } = await db.from("telegram_links").select("telegram_id").eq("user_id", reqRow.user_id).maybeSingle();
    const chatId = link?.telegram_id ?? null;
    const done = (status: string) => db.from("password_requests")
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: auth.user!.id }).eq("id", requestId);

    if (action === "reject") {
      await done("rejected");
      if (chatId) await tg("sendMessage", { chat_id: chatId, text: "❌ تم رفض طلب تغيير كلمة المرور. تواصل مع الإدارة لو محتاج مساعدة." });
      return json({ ok: true });
    }

    const pw = tempPassword();
    const { error: upErr } = await db.auth.admin.updateUserById(reqRow.user_id, { password: pw });
    if (upErr) return json({ error: "update_failed", detail: upErr.message }, 500);
    await db.from("student_profiles").update({ must_change_password: true }).eq("id", reqRow.user_id);
    await done("done");

    let sent = false;
    if (chatId) {
      const r = await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: "✅ تمت الموافقة على طلبك.\n\nكلمة المرور المؤقتة:\n<code>" + pw + "</code>\n\n" +
          "ادخل الموقع بإيميلك وكلمة المرور دي، وهيطلب منك تختار كلمة مرور جديدة.\n" +
          "⚠️ متشاركهاش مع حد، وامسح الرسالة بعد ما تغيّرها.",
      });
      sent = !!r?.ok;
    }
    // لو الرسالة ما وصلت، نرجّع الكلمة للمشرف عشان يوصلها للطالب بنفسه
    return json(sent ? { ok: true, sent: true } : { ok: true, sent: false, temp_password: pw });
  } catch (e) {
    console.error("reset-password error", e);
    return json({ error: "server_error" }, 500);
  }
});
