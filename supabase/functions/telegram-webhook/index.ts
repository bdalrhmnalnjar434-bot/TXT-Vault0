// Edge Function: telegram-webhook  (النسخة 2)
// الجديد: تواصل مع المشرف (مشكلة واحدة يوميًا) + طلب رسائل إضافية بموافقة المشرف
//        + صندوق وارد للمشرف يرد منه على الطالب من البوت.
// الأسرار: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ADMIN_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const ADMIN_ID = (Deno.env.get("TELEGRAM_ADMIN_ID") ?? "").trim();

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---------- نصوص الأزرار والرسائل ----------
const BTN_CONTACT = "📩 تواصل مع المشرف";
const BTN_EXTRA = "➕ طلب رسائل إضافية";
const BTN_INBOX = "📥 صندوق الوارد";
const PROMPT_PROBLEM = "✍️ اكتب مشكلتك في رسالة واحدة (رد على هذه الرسالة):";
const PROMPT_EXTRA = "🔢 كم رسالة إضافية تريد؟ اكتب رقمًا من 1 إلى 10 (رد على هذه الرسالة):";
const REPLY_PREFIX = "✍️ اكتب ردك على التذكرة #";

const studentMenu = {
  keyboard: [[{ text: BTN_CONTACT }, { text: BTN_EXTRA }]],
  resize_keyboard: true,
  is_persistent: true,
};
const adminMenu = {
  keyboard: [[{ text: BTN_INBOX }]],
  resize_keyboard: true,
  is_persistent: true,
};

// ---------- أدوات تيليجرام ----------
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

const forceReply = (placeholder: string) => ({
  force_reply: true,
  input_field_placeholder: placeholder,
});

const MEMBER_STATUSES = new Set(["member", "administrator", "creator"]);

function sameChannel(chat: { id?: number; username?: string }) {
  if (!chat) return false;
  if (String(chat.id) === String(CHANNEL_ID)) return true;
  return !!chat.username && CHANNEL_ID.toLowerCase() === `@${chat.username.toLowerCase()}`;
}

// ---------- أدوات الدعم ----------
const cairoDay = (d: Date | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(d));

type Me = { user_id: string; extra_messages: number } | null;

async function getMe(telegramId: number): Promise<Me> {
  const { data } = await db.from("telegram_links")
    .select("user_id, extra_messages").eq("telegram_id", telegramId).maybeSingle();
  return (data as Me) ?? null;
}

async function problemQuota(userId: string, extra: number) {
  const { data } = await db.from("support_tickets").select("created_at")
    .eq("user_id", userId).eq("kind", "problem")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const usedToday = !!data && cairoDay(data.created_at) === cairoDay(new Date());
  return { usedToday, allowed: !usedToday || extra > 0 };
}

async function getTicket(id: number): Promise<any> {
  const { data } = await db.from("support_tickets")
    .select("id, user_id, kind, message, extra_count, status, admin_reply, created_at, student_profiles(full_name, email, grade)")
    .eq("id", id).maybeSingle();
  return data;
}

const STATUS_LABEL: Record<string, string> = {
  open: "⏳ مفتوحة",
  answered: "✅ تم الرد",
  approved: "✅ تمت الموافقة",
  rejected: "❌ مرفوض",
};

function cardText(t: any) {
  const p = t.student_profiles ?? {};
  const kind = t.kind === "extra" ? "طلب رسائل إضافية" : "مشكلة";
  const body = t.kind === "extra" ? `🔢 العدد المطلوب: ${t.extra_count}` : `💬 ${t.message}`;
  const reply = t.admin_reply ? `\n\n↩️ ردك: ${t.admin_reply}` : "";
  return `🎫 #${t.id} — ${kind}\n👤 ${p.full_name || "—"}\n✉️ ${p.email || "—"}\n\n${body}${reply}\n\nالحالة: ${STATUS_LABEL[t.status] ?? t.status}`;
}

function cardButtons(t: any) {
  if (t.kind === "problem") {
    return [[{ text: "↩️ رد", callback_data: `r:${t.id}` }]];
  }
  if (t.status === "open") {
    return [[
      { text: "✅ موافقة", callback_data: `a:${t.id}` },
      { text: "❌ رفض", callback_data: `x:${t.id}` },
    ]];
  }
  return [];
}

async function notifyAdmin(ticketId: number) {
  if (!ADMIN_ID) return;
  const t = await getTicket(ticketId);
  if (!t) return;
  await say(Number(ADMIN_ID), "🔔 طلب جديد\n\n" + cardText(t), {
    reply_markup: { inline_keyboard: cardButtons(t) },
  });
}

async function sendInbox(chatId: number) {
  const { data } = await db.from("support_tickets")
    .select("id, kind, student_profiles(full_name)")
    .eq("status", "open").order("created_at", { ascending: true }).limit(20);
  if (!data || data.length === 0) {
    await say(chatId, "📭 لا توجد طلبات مفتوحة.", { reply_markup: adminMenu });
    return;
  }
  const kb = data.map((t: any) => [{
    text: `${t.kind === "extra" ? "➕" : "💬"} #${t.id} ${t.student_profiles?.full_name ?? ""}`.slice(0, 60),
    callback_data: `t:${t.id}`,
  }]);
  await say(chatId, `📥 الطلبات المفتوحة (${data.length}):`, { reply_markup: { inline_keyboard: kb } });
}

async function studentTelegramId(userId: string): Promise<number | null> {
  const { data } = await db.from("telegram_links")
    .select("telegram_id").eq("user_id", userId).maybeSingle();
  return data?.telegram_id ?? null;
}

// ---------- الخادم ----------
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
    // ---- متابعة القناة: خروج/دخول عضو ----
    const cm = update.chat_member;
    if (cm && sameChannel(cm.chat)) {
      const isMember = MEMBER_STATUSES.has(cm.new_chat_member?.status) ||
        (cm.new_chat_member?.status === "restricted" && cm.new_chat_member?.is_member === true);
      await db.from("telegram_links").update({
        channel_member: isMember,
        channel_checked_at: new Date().toISOString(),
      }).eq("telegram_id", cm.new_chat_member.user.id);
      return new Response("ok");
    }

    // ---- ضغطات أزرار المشرف (Inline) ----
    const cb = update.callback_query;
    if (cb) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id });
      if (!ADMIN_ID || String(cb.from?.id) !== ADMIN_ID) return new Response("ok");

      const chatId: number = cb.message.chat.id;
      const [act, idStr] = String(cb.data ?? "").split(":");
      const t = await getTicket(Number(idStr));
      if (!t) {
        await say(chatId, "⚠️ الطلب غير موجود.");
        return new Response("ok");
      }

      if (act === "t") {
        await say(chatId, cardText(t), { reply_markup: { inline_keyboard: cardButtons(t) } });
      } else if (act === "r") {
        await say(chatId, `${REPLY_PREFIX}${t.id} (رد على هذه الرسالة):`, {
          reply_markup: forceReply("اكتب ردك للطالب"),
        });
      } else if (act === "a" || act === "x") {
        if (t.kind !== "extra" || t.status !== "open") {
          await say(chatId, "ℹ️ الطلب ده اتعالج قبل كده.");
          return new Response("ok");
        }
        const approve = act === "a";
        await db.from("support_tickets").update({
          status: approve ? "approved" : "rejected",
          handled_at: new Date().toISOString(),
        }).eq("id", t.id);

        const tid = await studentTelegramId(t.user_id);
        if (approve) {
          const { data: cur } = await db.from("telegram_links")
            .select("extra_messages").eq("user_id", t.user_id).maybeSingle();
          await db.from("telegram_links")
            .update({ extra_messages: (cur?.extra_messages ?? 0) + (t.extra_count ?? 0) })
            .eq("user_id", t.user_id);
        }
        if (tid) {
          await say(
            tid,
            approve
              ? `✅ وافق المشرف على طلبك. أُضيف لك ${t.extra_count} رسالة إضافية.`
              : "❌ المشرف رفض طلب الرسائل الإضافية.",
            { reply_markup: studentMenu },
          );
        }
        await say(chatId, approve ? "✅ تمت الموافقة." : "❌ تم الرفض.");
      }
      return new Response("ok");
    }

    const msg = update.message;
    if (!msg || msg.chat?.type !== "private") return new Response("ok");
    const chatId: number = msg.chat.id;
    const from = msg.from;
    const text: string = (msg.text ?? "").trim();
    const isAdmin = !!ADMIN_ID && String(from.id) === ADMIN_ID;
    const replyTo: string = msg.reply_to_message?.text ?? "";

    // ---- معرفة رقمك في تيليجرام (لإعداد المشرف) ----
    if (text === "/myid") {
      await say(chatId, `رقمك في تيليجرام: ${from.id}`);
      return new Response("ok");
    }

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
      } else {
        await say(chatId, "✅ تم توثيق رقم الهاتف. ارجع للموقع واضغط «تحقق الآن».", {
          reply_markup: studentMenu,
        });
      }
      return new Response("ok");
    }

    // ---- /start <code> ----
    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1];
      if (!code) {
        if (isAdmin) {
          await say(chatId, "أهلًا يا مشرف 👋", { reply_markup: adminMenu });
        } else {
          const me = await getMe(from.id);
          await say(
            chatId,
            "أهلًا بك في بوت TXT Vault 👋\nابدأ من صفحة الطالب في الموقع واضغط «ربط تيليجرام».",
            me ? { reply_markup: studentMenu } : {},
          );
        }
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
        link_code: null,
        linked_at: new Date().toISOString(),
      }).eq("user_id", link.user_id);

      if (error) {
        await say(chatId, "⚠️ حساب تيليجرام ده مربوط بحساب آخر في الموقع.");
        return new Response("ok");
      }

      await say(
        chatId,
        "✅ تم ربط حسابك بنجاح.\n\nالخطوة الجاية: وثّق رقم هاتفك بالضغط على الزر بالأسفل 👇",
        {
          reply_markup: {
            keyboard: [[{ text: "📱 مشاركة رقم الهاتف", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      );
      return new Response("ok");
    }

    // =========================== المشرف ===========================
    if (isAdmin) {
      // رد المشرف على مشكلة
      if (replyTo.startsWith(REPLY_PREFIX) && text) {
        const id = Number(replyTo.slice(REPLY_PREFIX.length).match(/^(\d+)/)?.[1]);
        const t = id ? await getTicket(id) : null;
        if (!t) {
          await say(chatId, "⚠️ مش لاقي المشكلة دي.");
          return new Response("ok");
        }
        await db.from("support_tickets").update({
          status: "answered",
          admin_reply: text.slice(0, 2000),
          handled_at: new Date().toISOString(),
        }).eq("id", t.id);

        const tid = await studentTelegramId(t.user_id);
        if (tid) {
          await say(tid, `📬 رد المشرف على مشكلتك #${t.id}:\n\n${text}`, { reply_markup: studentMenu });
          await say(chatId, "✅ تم إرسال ردك للطالب.", { reply_markup: adminMenu });
        } else {
          await say(chatId, "⚠️ الطالب مش مربوط بتيليجرام، الرد اتحفظ بس ما وصلش.");
        }
        return new Response("ok");
      }

      if (text === BTN_INBOX || text === "/inbox") {
        await sendInbox(chatId);
        return new Response("ok");
      }
      if (text === "/menu") {
        await say(chatId, "القائمة 👇", { reply_markup: adminMenu });
        return new Response("ok");
      }
    }

    // =========================== الطالب ===========================
    const me = await getMe(from.id);

    if (text === "/menu" && me) {
      await say(chatId, "القائمة 👇", { reply_markup: studentMenu });
      return new Response("ok");
    }

    if (text === BTN_CONTACT) {
      if (!me) {
        await say(chatId, "اربط حسابك أولًا من الموقع (صفحة الطالب ← ربط تيليجرام).");
        return new Response("ok");
      }
      const q = await problemQuota(me.user_id, me.extra_messages ?? 0);
      if (!q.allowed) {
        await say(
          chatId,
          "⏳ وصلت للحد اليومي (مشكلة واحدة في اليوم). تقدر تطلب رسائل إضافية من زرار «➕ طلب رسائل إضافية» أو ترجع بكرة.",
          { reply_markup: studentMenu },
        );
        return new Response("ok");
      }
      await say(chatId, PROMPT_PROBLEM, { reply_markup: forceReply("اكتب مشكلتك هنا") });
      return new Response("ok");
    }

    if (text === BTN_EXTRA) {
      if (!me) {
        await say(chatId, "اربط حسابك أولًا من الموقع (صفحة الطالب ← ربط تيليجرام).");
        return new Response("ok");
      }
      const { data: pending } = await db.from("support_tickets").select("id")
        .eq("user_id", me.user_id).eq("kind", "extra").eq("status", "open").limit(1);
      if (pending && pending.length > 0) {
        await say(chatId, "⏳ عندك طلب رسائل إضافية لسه مستني رد المشرف.", { reply_markup: studentMenu });
        return new Response("ok");
      }
      await say(chatId, PROMPT_EXTRA, { reply_markup: forceReply("مثال: 3") });
      return new Response("ok");
    }

    // الطالب كتب مشكلته (رد على رسالة الطلب)
    if (me && replyTo === PROMPT_PROBLEM && text) {
      const q = await problemQuota(me.user_id, me.extra_messages ?? 0);
      if (!q.allowed) {
        await say(chatId, "⏳ وصلت للحد اليومي (مشكلة واحدة في اليوم).", { reply_markup: studentMenu });
        return new Response("ok");
      }
      const { data: t, error } = await db.from("support_tickets")
        .insert({ user_id: me.user_id, kind: "problem", message: text.slice(0, 1000) })
        .select("id").single();
      if (error || !t) {
        await say(chatId, "⚠️ حصلت مشكلة وما اتسجلتش. جرّب تاني بعد شوية.", { reply_markup: studentMenu });
        return new Response("ok");
      }
      if (q.usedToday) {
        await db.from("telegram_links")
          .update({ extra_messages: Math.max(0, (me.extra_messages ?? 0) - 1) })
          .eq("user_id", me.user_id);
      }
      await say(chatId, `✅ وصلت مشكلتك للمشرف (#${t.id}). هيجيلك الرد هنا في البوت.`, {
        reply_markup: studentMenu,
      });
      await notifyAdmin(t.id);
      return new Response("ok");
    }

    // الطالب كتب عدد الرسائل الإضافية
    if (me && replyTo === PROMPT_EXTRA && text) {
      const n = Number(text.replace(/[^\d]/g, ""));
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        await say(chatId, "⚠️ اكتب رقم من 1 إلى 10. اضغط «➕ طلب رسائل إضافية» وجرّب تاني.", {
          reply_markup: studentMenu,
        });
        return new Response("ok");
      }
      const { data: t, error } = await db.from("support_tickets")
        .insert({ user_id: me.user_id, kind: "extra", extra_count: n })
        .select("id").single();
      if (error || !t) {
        await say(chatId, "⚠️ حصلت مشكلة وما اتسجلش الطلب. جرّب تاني.", { reply_markup: studentMenu });
        return new Response("ok");
      }
      await say(chatId, `✅ اتبعت طلبك لـ ${n} رسالة إضافية للمشرف، وهيجيلك الرد هنا.`, {
        reply_markup: studentMenu,
      });
      await notifyAdmin(t.id);
      return new Response("ok");
    }

    await say(
      chatId,
      "استخدم الأزرار بالأسفل، أو الموقع لإكمال خطوات التفعيل.",
      me ? { reply_markup: studentMenu } : {},
    );
  } catch (e) {
    console.error("webhook error", e);
  }

  // دائمًا نرد 200 حتى لا يعيد تيليجرام إرسال نفس التحديث
  return new Response("ok");
});
