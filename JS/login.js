import { supabase, isConfigured } from "../supabase.js";
import { getSession, routeAfterLogin, arabicAuthError, STATUS_MESSAGE } from "./auth.js";
import { showAlert, hideAlert, setBusy } from "./ui.js";

const form = document.getElementById("loginForm");
const messageEl = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");
const pwInput = document.getElementById("password");
const pwToggle = document.getElementById("pwToggle");

pwToggle.addEventListener("click", () => {
  const show = pwInput.type === "password";
  pwInput.type = show ? "text" : "password";
  pwToggle.textContent = show ? "إخفاء" : "إظهار";
});

// رسالة قادمة من إعادة توجيه (حساب موقوف/مرفوض)
const reason = new URLSearchParams(location.search).get("reason");
if (reason && STATUS_MESSAGE[reason]) showAlert(messageEl, STATUS_MESSAGE[reason], "warn");
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
  if (session) await routeAfterLogin(session.user);
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
