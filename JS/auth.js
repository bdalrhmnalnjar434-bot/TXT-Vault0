// منطق الجلسة وحماية الصفحات.
// ⚠️ هذا الملف يحمي تجربة الواجهة فقط. الحماية الحقيقية هي سياسات RLS في قاعدة البيانات
// (sql/schema.sql)، فحتى لو تجاوز أحدهم الواجهة لن يستطيع قراءة ما لا يحق له.

import { supabase, isConfigured } from "../../supabase.js";

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
};

export const STATUS_MESSAGE = {
  rejected: "تم رفض طلب التسجيل. تواصل مع الإدارة لمزيد من التفاصيل.",
  suspended: "هذا الحساب موقوف حاليًا. تواصل مع الإدارة.",
};

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
  if (profile && (profile.status === "rejected" || profile.status === "suspended")) {
    await supabase.auth.signOut();
    location.href = `login.html?reason=${profile.status}`;
    return;
  }
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
  const isAdmin = await checkAdmin(user.id);

  if (admin) {
    if (!isAdmin) { location.replace("student.html"); throw new Error("not admin"); }
    return { session, user, isAdmin };
  }

  if (isAdmin) { location.replace("admin.html"); throw new Error("admin goes to admin page"); }

  const profile = await getProfile(user.id);
  if (!profile || profile.status === "rejected" || profile.status === "suspended") {
    await supabase.auth.signOut();
    location.replace(`login.html?reason=${profile?.status || "pending"}`);
    throw new Error("blocked");
  }
  return { session, user, isAdmin, profile };
}
