import { supabase, isConfigured, TELEGRAM_BOT_USERNAME } from "../supabase.js";
import { getSession, getProfile, routeAfterLogin, arabicAuthError, STATUS_MESSAGE } from "./auth.js";
import { bindSupport } from "./support.js";
import { showAlert, hideAlert, setBusy, initPasswordToggles } from "./ui.js";

const form = document.getElementById("loginForm");
const messageEl = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");
initPasswordToggles();
bindSupport();

// نسيت كلمة المرور: يوجّه الطالب للبوت (والموافقة من المشرف)
document.getElementById("forgotLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  const box = document.getElementById("forgotBox");
  box.hidden = !box.hidden;
  document.getElementById("forgotBot").href = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=password`;
});

// رسالة قادمة من إعادة توجيه (حساب موقوف/مرفوض)
const reason = new URLSearchParams(location.search).get("reason");
if (reason && STATUS_MESSAGE[reason]) {
  const kind = new URLSearchParams(location.search).get("kind");
  const extra = reason === "device" && kind
    ? `\n(الموقع تعرّف على جهازك كـ «${kind === "mobile" ? "موبايل" : "كمبيوتر"}». لو ده غلط، شغّل وضع الموبايل في المتصفح وليس «موقع سطح المكتب».)` : "";
  showAlert(messageEl, STATUS_MESSAGE[reason] + extra, "warn");
}
if (new URLSearchParams(location.search).get("registered")) {
  showAlert(messageEl, "تم إنشاء الحساب. تأكد من بريدك إن طُلب تأكيده ثم سجّل الدخول.", "ok");
}

if (!isConfigured) {
  showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js وضع Project URL و anon key.", "warn");
}

// إن كانت هناك جلسة نشطة نوجّه المستخدم مباشرة
(async () => {
  if (!isConfigured || reason) return;
  const session = await getSession();
  if (!session) return;
  // تسجيل غير مكتمل (اختار Google ولم يضع كلمة مرور): لا نعيده لصفحة التسجيل، نلغي الجلسة ونعرض الدخول
  try {
    const profile = await getProfile(session.user.id);
    if (profile && profile.profile_completed === false) {
      await supabase.auth.signOut();
      showAlert(messageEl, "التسجيل السابق لم يكتمل. سجّل الدخول بحسابك، أو أنشئ حسابًا جديدًا من صفحة التسجيل.", "info");
      return;
    }
  } catch { /* نكمل التوجيه العادي */ }
  await routeAfterLogin(session.user);
})();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert(messageEl);

  if (!isConfigured) {
    showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js وضع Project URL و anon key.", "warn");
    return;
  }

  const email = form.email.value.trim();
  const password = form.password.value;

  if (!email || !password) {
    showAlert(messageEl, "اكتب البريد الإلكتروني وكلمة المرور.", "warn");
    return;
  }

  setBusy(submitBtn, true, "جارٍ تسجيل الدخول...");
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await routeAfterLogin(data.user);
  } catch (err) {
    showAlert(messageEl, arabicAuthError(err), "bad");
    setBusy(submitBtn, false);
  }
});
