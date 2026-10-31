import { supabase, isConfigured } from "../supabase.js";
import { arabicAuthError } from "./auth.js";
import { showAlert, hideAlert, setBusy } from "./ui.js";

const form = document.getElementById("registerForm");
const messageEl = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");

if (!isConfigured) {
  showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js وضع Project URL و anon key.", "warn");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert(messageEl);

  if (!isConfigured) {
    showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js وضع Project URL و anon key.", "warn");
    return;
  }

  const fullName = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim();
  const grade = document.getElementById("grade").value;
  const password = document.getElementById("password").value;
  const password2 = document.getElementById("password2").value;

  if (fullName.length < 3) return showAlert(messageEl, "اكتب اسمك الكامل.", "warn");
  if (!email) return showAlert(messageEl, "اكتب بريدك الإلكتروني.", "warn");
  if (!["first", "second"].includes(grade)) return showAlert(messageEl, "اختر الصف الدراسي.", "warn");
  if (password.length < 8) return showAlert(messageEl, "كلمة المرور يجب ألا تقل عن ٨ أحرف.", "warn");
  if (password !== password2) return showAlert(messageEl, "كلمتا المرور غير متطابقتين.", "warn");

  setBusy(submitBtn, true, "جارٍ إنشاء الحساب...");
  try {
    // الحالة تُحدَّد دائمًا pending من الـ trigger في قاعدة البيانات، ولا يستطيع المستخدم تغييرها
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, grade },
        emailRedirectTo: new URL("login.html?registered=1", location.href).href,
      },
    });
    if (error) throw error;

    // Supabase يُرجع user بدون identities إذا كان البريد مسجلًا مسبقًا
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error("already registered");
    }

    if (data.session) {
      location.href = "student.html";
    } else {
      form.hidden = true;
      showAlert(
        messageEl,
        "تم إنشاء الحساب. أرسلنا رسالة تأكيد إلى بريدك — افتحها ثم سجّل الدخول لإكمال خطوات التفعيل.",
        "ok",
      );
    }
  } catch (err) {
    showAlert(messageEl, arabicAuthError(err), "bad");
    setBusy(submitBtn, false);
  }
});
