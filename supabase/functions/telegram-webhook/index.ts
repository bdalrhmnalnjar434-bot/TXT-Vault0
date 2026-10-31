// Edge Function: telegram-webhook
// الترتيب الجديد للتفعيل داخل البوت:
//   1) /start <code>      → ربط حساب الموقع بحساب تيليجرام
//   2) مشاركة رقم الهاتف   → توثيق الرقم (لازم يكون رقم صاحب الحساب)
//   3) طلب الاشتراك       → رسالة "يرجى الاشتراك في القناة" + زر الرابط + زر "اشتركت، تحقق"
//   4) أي رسالة قبل الاشتراك → نفس رسالة "يرجى الاشتراك"
//   5) بعد الانضمام        → البوت يفتح معاه ويقوله استنى موافقة الإدارة
//
// النشر:  Verify JWT = OFF
// الأسرار المطلوبة: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_WEBHOOK_SECRET
// أسرار اختيارية:
//   TELEGRAM_CHANNEL_URL = رابط دعوة ثابت للقناة (لو مش موجود، البوت بيعمل رابط جديد لكل طالب)
//   SITE_URL             = رابط الموقع (لو موجود يظهر زر "فتح الموقع")
//
// مهم: لازم allowed_updates تحتوي على: message, chat_member, callback_query

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID")!; // مثال: -1001234567890
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const CHANNEL_URL = (Deno.env.get("TELEGRAM_CHANNEL_URL") ?? "").trim();
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").trim();

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // يعمل داخل الخادم فقط — لا يصل للمتصفح أبدًا
);

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

const say = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, ...extra });

const MEMBER_STATUSES = new Set(["member", "administrator", "creator"]);

function sameChannel(chat: { id?: number; username?: string }) {
  if (!chat) return false;
  if (String(chat.id) === String(CHANNEL_ID)) return true;
  return !!chat.username && CHANNEL_ID.toLowerCase() === `@${chat.username.toLowerCase()}`;
}

// ---------- عضوية القناة ----------
async function isChannelMember(tgId: number): Promise<boolean> {
  const r = await tg("getChatMember", { chat_id: CHANNEL_ID, user_id: tgId });
  if (!r?.ok) return false;
  const s = r.result?.status;
  return MEMBER_STATUSES.has(s) || (s === "restricted" && r.result?.is_member === true);
}

async function saveMembership(tgId: number, isMember: boolean) {
  await db.from("telegram_links").update({
    channel_member: isMember,
    channel_checked_at: new Date().toISOString(),
  }).eq("telegram_id", tgId);
}

// رابط الدعوة: الثابت من الأسرار لو موجود، وإلا نعمل رابط جديد صالح 24 ساعة لشخص واحد
async function inviteLink(): Promise<string | null> {
  if (CHANNEL_URL.startsWith("https://")) return CHANNEL_URL;
  const r = await tg("createChatInviteLink", {
    chat_id: CHANNEL_ID,
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 86400,
    name: "TXT Vault",
  });
  return r?.ok ? (r.result?.invite_link ?? null) : null;
}

async function askToJoin(chatId: number, intro = "") {
  const url = await inviteLink();
  const rows: Record<string, unknown>[][] = [];
  if (url) rows.push([{ text: "📢 الاشتراك في القناة", url }]);
  rows.push([{ text: "✅ اشتركت، تحقق", callback_data: "check" }]);
  await say(
    chatId,
    `${intro}⚠️ يرجى الاشتراك في القناة أولًا لإكمال التفعيل.\n\n` +
      "1) اضغط «الاشتراك في القناة» وانضم.\n2) ارجع هنا واضغط «اشتركت، تحقق».",
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function allDone(chatId: number) {
  const extra: Record<string, unknown> = {};
  if (SITE_URL.startsWith("https://")) {
    extra.reply_markup = { inline_keyboard: [[{ text: "🌐 فتح الموقع", url: SITE_URL }]] };
  }
  await say(
    chatId,
    "✅ أنت مشترك في القناة وتم توثيق رقمك. كل خطوات التفعيل خلصت.\n\n" +
      "⏳ ارجع للموقع واضغط «تحقق الآن»، وبعدها استنى موافقة الإدارة على حسابك.\n" +
      "لو حبيت تتأكد من حالتك في أي وقت ابعت /start",
    extra,
  );
}

// البوابة: بتحدد الخطوة الناقصة وترد بالمناسب
async function gate(chatId: number, tgId: number) {
  const { data: link } = await db.from("telegram_links")
    .select("user_id, phone_verified").eq("telegram_id", tgId).maybeSingle();

  if (!link) {
    await say(chatId, "اربط حسابك أولًا من الموقع (صفحة الطالب ← ربط تيليجرام).");
    return;
  }
  if (!link.phone_verified) {
    await say(chatId, "📱 الخطوة الجاية: وثّق رقم هاتفك بالضغط على الزر بالأسفل 👇", {
      reply_markup: {
        keyboard: [[{ text: "📱 مشاركة رقم الهاتف", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }
  const member = await isChannelMember(tgId);
  await saveMembership(tgId, member);
  if (member) await allDone(chatId);
  else await askToJoin(chatId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  try {
    // ---- متابعة القناة: دخول/خروج عضو ----
    const cm = update.chat_member;
    if (cm && sameChannel(cm.chat)) {
      const st = cm.new_chat_member?.status;
      const isMember = MEMBER_STATUSES.has(st) ||
        (st === "restricted" && cm.new_chat_member?.is_member === true);
      const tgId: number = cm.new_chat_member.user.id;

      const { data: rows } = await db.from("telegram_links").update({
        channel_member: isMember,
        channel_checked_at: new Date().toISOString(),
      }).eq("telegram_id", tgId).select("phone_verified");

      // لو الطالب مربوط عندنا نبلغه في الخاص (يفشل بصمت لو لم يبدأ البوت)
      if (rows && rows.length) {
        if (isMember && rows[0].phone_verified) await allDone(tgId);
        else if (!isMember) await askToJoin(tgId, "ℹ️ لاحظنا إنك خرجت من القناة.\n\n");
      }
      return new Response("ok");
    }

    // ---- ضغط زر "اشتركت، تحقق" ----
    const cb = update.callback_query;
    if (cb) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id });
      const chatId = cb.message?.chat?.id ?? cb.from.id;
      await gate(chatId, cb.from.id);
      return new Response("ok");
    }

    const msg = update.message;
    if (!msg || msg.chat?.type !== "private") return new Response("ok");
    const chatId: number = msg.chat.id;
    const from = msg.from;

    // ---- مشاركة رقم الهاتف ----
    if (msg.contact) {
      if (msg.contact.user_id !== from.id) {
        await say(chatId, "⚠️ لازم تشارك رقمك أنت بنفسك باستخدام الزر، مش جهة اتصال لشخص آخر.");
        return new Response("ok");
      }
      const { data: link } = await db.from("telegram_links")
        .select("user_id").eq("telegram_id", from.id).maybeSingle();
      if (!link) {
        await say(chatId, "اربط حسابك أولًا من الموقع (صفحة الطالب ← ربط تيليجرام).");
        return new Response("ok");
      }
      const phone = String(msg.contact.phone_number).replace(/[^\d+]/g, "");
      const { error } = await db.from("telegram_links")
        .update({ phone, phone_verified: true }).eq("user_id", link.user_id);
      if (error) {
        await say(chatId, "⚠️ الرقم ده مستخدم في حساب آخر. لو دي غلطة تواصل مع الإدارة.");
        return new Response("ok");
      }
      await say(chatId, "✅ تم توثيق رقم الهاتف.", { reply_markup: { remove_keyboard: true } });
      // الخطوة التالية مباشرة: الاشتراك في القناة
      await gate(chatId, from.id);
      return new Response("ok");
    }

    // ---- /start <code> ----
    const text: string = (msg.text ?? "").trim();
    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1];
      if (!code) {
        // /start بدون كود: نعرض حالة الطالب لو كان مربوطًا
        const { data: me } = await db.from("telegram_links")
          .select("user_id").eq("telegram_id", from.id).maybeSingle();
        if (me) await gate(chatId, from.id);
        else await say(chatId, "أهلًا بك في بوت TXT Vault 👋\nابدأ من صفحة الطالب في الموقع واضغط «ربط تيليجرام».");
        return new Response("ok");
      }

      const { data: link } = await db.from("telegram_links")
        .select("user_id, telegram_id").eq("link_code", code).maybeSingle();
      if (!link) {
        await say(chatId, "⚠️ كود الربط غير صالح أو منتهي. ارجع للموقع واطلب ربطًا جديدًا.");
        return new Response("ok");
      }

      const { error } = await db.from("telegram_links").update({
        telegram_id: from.id,
        telegram_username: from.username ?? null,
        link_code: null, // الكود يُستخدم مرة واحدة فقط
        linked_at: new Date().toISOString(),
      }).eq("user_id", link.user_id);

      if (error) {
        await say(chatId, "⚠️ حساب تيليجرام ده مربوط بحساب آخر في الموقع.");
        return new Response("ok");
      }

      await say(chatId, "✅ تم ربط حسابك بنجاح.");
      await gate(chatId, from.id); // يطلب الرقم أولًا ثم الاشتراك
      return new Response("ok");
    }

    // ---- أي رسالة أخرى: نرد بالخطوة الناقصة ----
    await gate(chatId, from.id);
  } catch (e) {
    console.error("webhook error", e);
  }

  // دائمًا نرد 200 حتى لا يعيد تيليجرام إرسال نفس التحديث
  return new Response("ok");
});
