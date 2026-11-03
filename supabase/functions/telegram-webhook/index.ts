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
//   TELEGRAM_CHANNEL_URL = رابط القناة (لو مش موجود، البوت يوجّه الطالب لزر «فتح القناة» في الموقع)
//   SITE_URL             = رابط الموقع (لو موجود يظهر زر "فتح الموقع")
//
// أسرار اختيارية إضافية:
//   ADMIN_TELEGRAM_ID = رقم تيليجرام للمشرف (أو أكثر مفصولة بفاصلة) لتصله رسالة عند وصول طلب كلمة مرور
//
// أمر جديد للطالب: /password (أو زر «نسيت كلمة المرور» في الموقع) ← طلب تغيير كلمة المرور بموافقة المشرف
//
// مهم: لازم allowed_updates تحتوي على: message, chat_member, callback_query

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID")!; // مثال: -1001234567890
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const CHANNEL_URL = (Deno.env.get("TELEGRAM_CHANNEL_URL") ?? "").trim();
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").trim();

const ADMIN_TG_IDS = (Deno.env.get("ADMIN_TELEGRAM_ID") ?? "").split(",").map((x) => x.trim()).filter(Boolean);

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

// رابط القناة: من السر TELEGRAM_CHANNEL_URL فقط (البوت لا ينشئ روابط دعوة)
async function inviteLink(): Promise<string | null> {
  return CHANNEL_URL.startsWith("https://") ? CHANNEL_URL : null;
}

async function askToJoin(chatId: number, intro = "") {
  const url = await inviteLink();
  const rows: Record<string, unknown>[][] = [];
  if (url) rows.push([{ text: "📢 الاشتراك في القناة", url }]);
  rows.push([{ text: "✅ اشتركت، تحقق", callback_data: "check" }]);
  await say(
    chatId,
    `${intro}⚠️ يرجى الاشتراك في القناة أولًا لإكمال التفعيل.\n\n` +
      (url
        ? "1) اضغط «الاشتراك في القناة» وانضم.\n"
        : "1) افتح القناة من الموقع (صفحة الطالب ← فتح القناة) وانضم.\n") +
      "2) ارجع هنا واضغط «اشتركت، تحقق».",
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

// ---------- التواصل مع المشرف (من أزرار الموقع) ----------
const SUPPORT_PROMPT: Record<string, string> = {
  register: "شكلك بتواجه مشكلة في *التسجيل* (إنشاء الحساب).",
  login: "شكلك بتواجه مشكلة في *تسجيل الدخول*.",
  chapters: "شكلك بتواجه مشكلة في *الفصول أو المحتوى*.",
  general: "أهلًا بيك في الدعم.",
};
const SOURCE_LABEL: Record<string, string> = {
  register: "صفحة التسجيل", login: "صفحة تسجيل الدخول", chapters: "الفصول والمحتوى", general: "عام",
};

async function supportStart(chatId: number, tgId: number, source: string) {
  if (!SUPPORT_PROMPT[source]) source = "general";
  // حماية من السبام: رسالة دعم واحدة كل دقيقة
  const minuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recent } = await db.from("support_requests").select("id")
    .eq("chat_id", chatId).eq("status", "sent").gte("created_at", minuteAgo).limit(1).maybeSingle();
  if (recent) {
    await say(chatId, "⏳ بعتّ رسالة من شوية. استنى دقيقة وحاول تاني.");
    return;
  }
  const { data: link } = await db.from("telegram_links").select("user_id").eq("telegram_id", tgId).maybeSingle();
  await db.from("support_requests").delete().eq("chat_id", chatId).eq("status", "awaiting");
  await db.from("support_requests").insert({ chat_id: chatId, user_id: link?.user_id ?? null, source });
  await say(chatId, `${SUPPORT_PROMPT[source]}\n\nما هي مشكلتك؟ اكتبها هنا في رسالة واحدة وهتوصل للمشرف.`);
}

// لو الطالب كان في انتظار كتابة مشكلته نسجّل رسالته ونحوّلها للمشرف. ترجع true لو تم التعامل مع الرسالة.
async function supportReceive(chatId: number, from: any, text: string): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: req } = await db.from("support_requests")
    .select("id, source, user_id").eq("chat_id", chatId).eq("status", "awaiting")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!req) return false;

  await db.from("support_requests").update({ status: "sent", message: text.slice(0, 3000) }).eq("id", req.id);

  let who = `${from.first_name ?? ""} ${from.last_name ?? ""}`.trim() || "—";
  let extra = from.username ? `\nتيليجرام: @${from.username}` : "";
  if (req.user_id) {
    const { data: p } = await db.from("student_profiles").select("full_name, email, grade").eq("id", req.user_id).maybeSingle();
    const { data: l } = await db.from("telegram_links").select("phone").eq("user_id", req.user_id).maybeSingle();
    if (p) who = `${p.full_name || who}`;
    extra += (p?.email ? `\nالإيميل: ${p.email}` : "") + (l?.phone ? `\nالهاتف: ${l.phone}` : "");
  } else {
    extra += "\n(غير مربوط بحساب على الموقع)";
  }
  for (const a of ADMIN_TG_IDS) {
    await say(Number(a), `📩 رسالة جديدة للمشرف\nالمكان: ${SOURCE_LABEL[req.source] ?? req.source}\nالاسم: ${who}${extra}\n\n${text.slice(0, 3000)}`);
  }
  await say(chatId, "✅ وصلت رسالتك للمشرف وهيرد عليك قريبًا.");
  return true;
}

// ---------- VIP: الأسعار وطلب الاشتراك ----------
// الأسعار: كل منصة 100 ما عدا Python = 50 (عدّلها هنا لو تغيّرت). العملة من السر PRICE_CURRENCY (الافتراضي «جنيه»).
const CURRENCY = (Deno.env.get("PRICE_CURRENCY") ?? "جنيه").trim();
const PLATFORMS = [
  { name: "JavaScript", price: 100 },
  { name: "Python", price: 50 },
  { name: "الثقافة المالية", price: 100 },
  { name: "المنصة كاملة (JavaScript + Python + الثقافة المالية)", price: 150 }, // باقة الثلاث منصات
];
const BUNDLE = 3;
// أولى: JavaScript فقط، ثانية: الثلاثة + الباقة الكاملة
const GRADE_PLATFORMS: Record<string, number[]> = { first: [0], second: [0, 1, 2, 3] };

async function vipGradeOf(tgId: number): Promise<string | null> {
  const { data: link } = await db.from("telegram_links").select("user_id").eq("telegram_id", tgId).maybeSingle();
  if (!link) return null;
  const { data: p } = await db.from("student_profiles").select("grade").eq("id", link.user_id).maybeSingle();
  return p?.grade ?? null;
}

async function vipAskGrade(chatId: number) {
  await say(chatId, "💎 VIP — فتح المنصة\n\nأنت في أنهي سنة؟", {
    reply_markup: { inline_keyboard: [[
      { text: "أولى بكالوريا", callback_data: "vg:first" },
      { text: "ثانية بكالوريا", callback_data: "vg:second" },
    ]] },
  });
}

async function vipShowPlatforms(chatId: number, grade: string) {
  const idx = GRADE_PLATFORMS[grade] ?? [];
  if (idx.length === 1) return vipShowPrice(chatId, grade, idx[0]); // منصة واحدة: نعرض سعرها مباشرة
  const full = PLATFORMS[0].price + PLATFORMS[1].price + PLATFORMS[2].price;
  await say(chatId, `💎 اختار المنصة اللي عايز تعرف سعرها:\n\n• تقدر تشترك في منصة واحدة بس (جزء من المنصة) بسعر أقل.\n• أو تاخد المنصة كاملة (الثلاث منصات) بـ ${PLATFORMS[BUNDLE].price} ${CURRENCY} بدل ${full} ${CURRENCY}.`, {
    reply_markup: { inline_keyboard: idx.map((i) => [{
      text: i === BUNDLE ? `⭐ المنصة كاملة (الثلاث منصات) — ${PLATFORMS[i].price} ${CURRENCY}` : `${PLATFORMS[i].name} — ${PLATFORMS[i].price} ${CURRENCY}`,
      callback_data: `vp:${grade}:${i}`,
    }]) },
  });
}

async function vipShowPrice(chatId: number, grade: string, i: number) {
  const pl = PLATFORMS[i];
  if (!pl || !(GRADE_PLATFORMS[grade] ?? []).includes(i)) return;
  const rows: Record<string, unknown>[][] = [[{ text: "✅ أريد الاشتراك", callback_data: `vs:${grade}:${i}` }]];
  if ((GRADE_PLATFORMS[grade] ?? []).length > 1) rows.push([{ text: "↩️ رجوع للمنصات", callback_data: `vg:${grade}` }]);
  const full = PLATFORMS[0].price + PLATFORMS[1].price + PLATFORMS[2].price;
  const head = i === BUNDLE
    ? `💎 ${pl.name}\nالسعر: ${pl.price} ${CURRENCY} بدل ${full} ${CURRENCY} لو اشتريت كل منصة لوحدها (توفير ${full - pl.price} ${CURRENCY}).`
    : `💎 منصة ${pl.name}\nالسعر: ${pl.price} ${CURRENCY}\n(ده حل جزء من المنصة بسعر أقل. والمنصة كاملة بـ ${PLATFORMS[BUNDLE].price} ${CURRENCY}.)`;
  await say(chatId, `${head}\n\nلو حابب تشترك اضغط الزر وهيتواصل معاك المشرف.`, {
    reply_markup: { inline_keyboard: rows },
  });
}

async function vipSubscribe(chatId: number, from: any, grade: string, i: number) {
  const pl = PLATFORMS[i];
  if (!pl || !(GRADE_PLATFORMS[grade] ?? []).includes(i)) return;
  const minuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recent } = await db.from("support_requests").select("id")
    .eq("chat_id", chatId).eq("source", "vip").gte("created_at", minuteAgo).limit(1).maybeSingle();
  if (recent) { await say(chatId, "⏳ طلبك وصل قبل شوية. استنى المشرف يتواصل معاك."); return; }

  const { data: link } = await db.from("telegram_links").select("user_id, phone").eq("telegram_id", from.id).maybeSingle();
  await db.from("support_requests").insert({
    chat_id: chatId, user_id: link?.user_id ?? null, source: "vip", status: "sent",
    message: `طلب اشتراك: ${pl.name} — ${pl.price} ${CURRENCY}`,
  });
  let who = `${from.first_name ?? ""} ${from.last_name ?? ""}`.trim() || "—";
  let extra = from.username ? `\nتيليجرام: @${from.username}` : "";
  if (link?.user_id) {
    const { data: p } = await db.from("student_profiles").select("full_name, email").eq("id", link.user_id).maybeSingle();
    if (p?.full_name) who = p.full_name;
    extra += (p?.email ? `\nالإيميل: ${p.email}` : "") + (link.phone ? `\nالهاتف: ${link.phone}` : "");
  } else extra += "\n(غير مربوط بحساب على الموقع)";
  for (const a of ADMIN_TG_IDS) {
    await say(Number(a), `💎 طلب اشتراك جديد\nالمنصة: ${pl.name}\nالسعر: ${pl.price} ${CURRENCY}\nالصف: ${grade === "first" ? "أولى" : "ثانية"}\nالاسم: ${who}${extra}`);
  }
  await say(chatId, "✅ وصل طلبك، والمشرف هيتواصل معاك قريبًا.");
}

async function vipStart(chatId: number, tgId: number) {
  const g = await vipGradeOf(tgId);
  if (g && GRADE_PLATFORMS[g]) return vipShowPlatforms(chatId, g);
  return vipAskGrade(chatId);
}

// ---------- طلب تغيير كلمة المرور ----------
async function pwStart(chatId: number, tgId: number) {
  const { data: link } = await db.from("telegram_links").select("user_id").eq("telegram_id", tgId).maybeSingle();
  if (!link) {
    await say(chatId, "اربط حسابك أولًا من الموقع (صفحة الطالب ← ربط تيليجرام) عشان نقدر نعرفك.");
    return;
  }
  const { data: p } = await db.from("student_profiles").select("full_name, status").eq("id", link.user_id).maybeSingle();
  if (!p || ["blocked", "rejected", "suspended"].includes(p.status)) {
    await say(chatId, "⚠️ مش قادرين نكمل الطلب ده على حسابك. تواصل مع الإدارة.");
    return;
  }
  const { data: pending } = await db.from("password_requests")
    .select("id").eq("user_id", link.user_id).eq("status", "pending").maybeSingle();
  if (pending) {
    await say(chatId, "⏳ طلبك لتغيير كلمة المرور وصل قبل كده وبانتظار موافقة المشرف. يرجى الانتظار.");
    return;
  }
  await say(chatId, `أهلًا ${p.full_name || ""} 👋\nهل تريد تغيير كلمة المرور؟`, {
    reply_markup: { inline_keyboard: [[
      { text: "✅ نعم", callback_data: "pw_yes" },
      { text: "❌ لا", callback_data: "pw_no" },
    ]] },
  });
}

async function pwConfirm(chatId: number, tgId: number) {
  const { data: link } = await db.from("telegram_links").select("user_id, phone").eq("telegram_id", tgId).maybeSingle();
  if (!link) return;
  const { error } = await db.from("password_requests").insert({ user_id: link.user_id });
  if (error && error.code !== "23505") {
    await say(chatId, "⚠️ حصلت مشكلة. حاول بعد شوية.");
    return;
  }
  await say(chatId, "⏳ يرجى الانتظار لحين موافقة المشرف. هتوصلك رسالة هنا بكلمة المرور الجديدة.");
  if (!error) {
    const { data: p } = await db.from("student_profiles").select("full_name").eq("id", link.user_id).maybeSingle();
    for (const a of ADMIN_TG_IDS) {
      await say(Number(a), `🔑 طلب تغيير كلمة مرور جديد\nالطالب: ${p?.full_name || "—"}\nالهاتف: ${link.phone || "—"}\nراجعه من لوحة المشرف ← كلمات المرور.`);
    }
  }
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
      const vm = /^v([gps]):([a-z]+)(?::(\d+))?$/.exec(cb.data ?? "");
      if (vm && GRADE_PLATFORMS[vm[2]]) {
        if (vm[1] === "g") await vipShowPlatforms(chatId, vm[2]);
        else if (vm[1] === "p") await vipShowPrice(chatId, vm[2], Number(vm[3]));
        else await vipSubscribe(chatId, cb.from, vm[2], Number(vm[3]));
        return new Response("ok");
      }
      if (cb.data === "pw_yes") { await pwConfirm(chatId, cb.from.id); return new Response("ok"); }
      if (cb.data === "pw_no") { await say(chatId, "تمام، مفيش تغيير."); return new Response("ok"); }
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
    if (/^\/start\s+vip(_[a-z]+)?$/.test(text) || /^\/vip\b/.test(text)) {
      await vipStart(chatId, from.id);
      return new Response("ok");
    }
    const hm = text.match(/^\/start\s+help_([a-z]+)$/);
    if (hm) {
      await supportStart(chatId, from.id, hm[1]);
      return new Response("ok");
    }
    if (text && !text.startsWith("/") && (await supportReceive(chatId, from, text))) {
      return new Response("ok");
    }
    if (text.startsWith("/password") || /نسيت كلمة المرور/.test(text) || /^\/start\s+password$/.test(text)) {
      await pwStart(chatId, from.id);
      return new Response("ok");
    }
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
