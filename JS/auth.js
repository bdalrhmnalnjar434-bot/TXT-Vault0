// منطق الجلسة وحماية الصفحات.
// ⚠️ هذا الملف يحمي تجربة الواجهة فقط. الحماية الحقيقية هي سياسات RLS في قاعدة البيانات
// (sql/schema.sql)، فحتى لو تجاوز أحدهم الواجهة لن يستطيع قراءة ما لا يحق له.

import { supabase, isConfigured } from "../supabase.js";
import { getMaintenance, showMaintenance } from "./maintenance.js";

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

// التحقق من المشرف من الجدول المحمي بـ RLS (المستخدم يرى سجله فقط)
export async function checkAdmin(userId) {
  const { data, error } = await supabase
    .from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) return false;
  return !!data;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("student_profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function signOut(redirect = "login.html") {
  try { await supabase.auth.signOut(); } catch { /* تجاهل */ }
  location.href = redirect;
}

export function bindLogout(selector = "#logoutBtn") {
  const btn = document.querySelector(selector);
  if (btn) btn.addEventListener("click", () => signOut());
}

export const STATUS_LABEL = {
  pending: "بانتظار الموافقة",
  approved: "مفعّل",
  rejected: "مرفوض",
  suspended: "موقوف",
  blocked: "محظور",
};

export const STATUS_MESSAGE = {
  rejected: "تم رفض طلب التسجيل. تواصل مع الإدارة لمزيد من التفاصيل.",
  suspended: "هذا الحساب موقوف حاليًا. تواصل مع الإدارة.",
  blocked: "تم حظر هذا الحساب. تواصل مع الإدارة.",
  device: "هذا الحساب مسجّل على جهاز آخر من نفس النوع (موبايل واحد + كمبيوتر واحد فقط). تواصل مع الإدارة لإعادة ضبط الجهاز.",
  storage: "المتصفح يمنع حفظ بيانات الموقع (وضع التصفح الخفي أو حظر التخزين). افتح الموقع في نافذة عادية.",
};

/* ---------- ربط الحساب بجهازين: موبايل واحد + كمبيوتر واحد ---------- */
const DEV_KEY = "txtv_device_id";

function deviceId() {
  try {
    let id = localStorage.getItem(DEV_KEY);
    if (!id || id.length < 16) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
      localStorage.setItem(DEV_KEY, id);
    }
    return id;
  } catch { return null; }
}

function deviceKind() {
  const ua = navigator.userAgent || "";
  const mobileUA = navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPad بوضع سطح المكتب
  // حتى لو المتصفح بوضع «موقع سطح المكتب»: شاشة صغيرة + لمس = موبايل/تابلت
  const small = Math.min(screen.width || 9999, screen.height || 9999) <= 820;
  const touch = (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
  return mobileUA || (small && touch) ? "mobile" : "desktop";
}

function deviceLabel() {
  const ua = navigator.userAgent || "";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows"
    : /Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "?";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "?";
  return `${br} / ${os}`;
}

// يرجع: ok | blocked | no_storage. لو دالة قاعدة البيانات غير موجودة بعد (لم تُشغَّل migration_6) لا نمنع أحدًا.
export function detectedKind() { return deviceKind(); }

export async function registerDevice() {
  const id = deviceId();
  if (!id) return "no_storage";
  const { data, error } = await supabase.rpc("register_device", {
    p_device_id: id, p_kind: deviceKind(), p_label: deviceLabel(),
  });
  if (error) return "ok";
  return data === "blocked" ? "blocked" : "ok";
}

// الحالات التي لا يُسمح لها بدخول المنصة
const DENIED = new Set(["rejected", "suspended", "blocked"]);

export function arabicAuthError(err) {
  console.error("Auth error:", err);
  const m = String(err?.message || err || "").toLowerCase();
  if (m.includes("database error")) return "خطأ في قاعدة البيانات: غالبًا لم يتم تشغيل sql/schema.sql في Supabase (أو حدث فيه خطأ). شغّله كاملًا ثم أعد المحاولة.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "التسجيل مغلق في Supabase: فعّل Email من Authentication ← Providers.";
  if (m.includes("invalid api key") || m.includes("apikey")) return "مفتاح anon غير صحيح. راجع supabase.js.";
  if (m.includes("invalid login")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  if (m.includes("email not confirmed")) return "لم يتم تأكيد بريدك بعد. افتح رسالة التأكيد في بريدك ثم حاول مرة أخرى.";
  if (m.includes("already registered") || m.includes("already been registered")) return "هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول.";
  if (m.includes("password") && m.includes("least")) return "كلمة المرور قصيرة جدًا (٨ أحرف على الأقل).";
  if (m.includes("rate limit") || m.includes("too many")) return "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.";
  if (m.includes("network") || m.includes("fetch")) return "تعذّر الاتصال بالخادم. تحقق من الإنترنت وإعدادات Supabase.";
  if (m.includes("invalid email")) return "صيغة البريد الإلكتروني غير صحيحة.";
  return "حدث خطأ غير متوقع: " + String(err?.message || err || "unknown");
}

// يوجّه المستخدم بعد الدخول: مشرف → admin.html ، طالب → student.html
export async function routeAfterLogin(user) {
  if (await checkAdmin(user.id)) {
    location.href = "admin.html";
    return;
  }
  let profile = null;
  try { profile = await getProfile(user.id); } catch { /* سيُعامل كحساب جديد */ }
  if (profile && DENIED.has(profile.status)) {
    await supabase.auth.signOut();
    location.href = `login.html?reason=${profile.status}`;
    return;
  }
  if (profile && profile.profile_completed === false) { location.href = "register.html"; return; }
  if (profile && profile.must_change_password) { location.href = "change-password.html"; return; }
  location.href = "student.html";
}

// حماية الصفحات: يعيد { session, user, profile?, isAdmin }
export async function requireUser({ admin = false } = {}) {
  if (!isConfigured) {
    document.body.innerHTML = `
      <div class="center-screen" style="padding:24px">
        <div class="card" style="max-width:520px">
          <h3>الإعداد غير مكتمل</h3>
          <p>افتح <code>supabase.js</code> وضع Project URL و anon key الخاصين بمشروعك.</p>
        </div>
      </div>`;
    throw new Error("Supabase not configured");
  }

  const session = await getSession();
  if (!session) { location.replace("login.html"); throw new Error("no session"); }

  const user = session.user;
  // نجلب هل هو مشرف + ملفه + تسجيل الجهاز بالتوازي بدل التتابع (أسرع في التحميل)
  const [isAdmin, profileRes, devRes] = await Promise.all([
    checkAdmin(user.id),
    admin ? Promise.resolve(null) : getProfile(user.id).then((p) => ({ p }), (e) => ({ e })),
    admin ? Promise.resolve("ok") : registerDevice().catch(() => "ok"),
  ]);

  if (admin) {
    if (!isAdmin) { location.replace("student.html"); throw new Error("not admin"); }
    return { session, user, isAdmin };
  }

  if (isAdmin) { location.replace("admin.html"); throw new Error("admin goes to admin page"); }

  // وضع الصيانة: الطالب يرى رسالة فقط (الحماية الحقيقية في قاعدة البيانات)
  const maint = await getMaintenance();
  if (maint.on) { showMaintenance(maint, { loginLink: false }); throw new Error("maintenance"); }

  if (profileRes?.e) throw profileRes.e;
  const profile = profileRes?.p ?? null;
  if (!profile || DENIED.has(profile.status)) {
    await supabase.auth.signOut();
    location.replace(`login.html?reason=${profile?.status || "pending"}`);
    throw new Error("blocked");
  }

  if (profile.profile_completed === false) { location.replace("register.html"); throw new Error("registration incomplete"); }
  if (profile.must_change_password) { location.replace("change-password.html"); throw new Error("must change password"); }

  // موبايل واحد + كمبيوتر واحد: جهاز ثالث من نفس النوع يُمنع (والحماية الفعلية في قاعدة البيانات)
  const dev = devRes;
  if (dev !== "ok") {
    await supabase.auth.signOut();
    location.replace(`login.html?reason=${dev === "blocked" ? "device&kind=" + deviceKind() : "storage"}`);
    throw new Error("device " + dev);
  }
  return { session, user, isAdmin, profile };
}
