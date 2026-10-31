import { supabase, isConfigured } from "../supabase.js";
import { arabicAuthError } from "./auth.js";
import { showAlert, hideAlert, setBusy, initPasswordToggles } from "./ui.js";

const form = document.getElementById("registerForm");
const messageEl = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");
initPasswordToggles();

// ---------- الاسم الثلاثي ----------
// ٣ أجزاء على الأقل، كل جزء حرفان فأكثر (عربي أو إنجليزي)
function isTripleName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 3 && parts.every((p) => /^[\p{L}\p{M}'’.-]{2,}$/u.test(p));
}

// ---------- قوة كلمة المرور ----------
function passwordChecks(pw) {
  return {
    len: pw.length >= 8,
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
    special: /[^A-Za-z0-9\s]/.test(pw),
  };
}

const STRENGTH = [
  { label: "ضعيفة جدًا", color: "var(--bad)" },
  { label: "ضعيفة", color: "var(--bad)" },
  { label: "متوسطة", color: "var(--warn)" },
  { label: "جيدة", color: "var(--warn)" },
  { label: "قوية", color: "var(--ok)" },
  { label: "قوية جدًا", color: "var(--ok)" },
];

const pwInput = document.getElementById("password");
const pwInput2 = document.getElementById("password2");
const barFill = document.getElementById("pwBarFill");
const pwLabel = document.getElementById("pwLabel");
const pwMatch = document.getElementById("pwMatch");

function updatePasswordUI() {
  const pw = pwInput.value;
  const checks = passwordChecks(pw);
  const met = Object.values(checks).filter(Boolean).length;

  document.querySelectorAll("#pwRules li").forEach((li) => {
    li.classList.toggle("ok", !!checks[li.dataset.rule]);
  });

  if (!pw) {
    barFill.style.width = "0";
    pwLabel.textContent = "اكتب كلمة المرور";
    pwLabel.style.color = "";
  } else {
    // 5 شروط + نقطة إضافية لطول ١٢ حرفًا فأكثر
    const score = met + (met === 5 && pw.length >= 12 ? 1 : 0);
    const s = STRENGTH[Math.min(score, 5)];
    barFill.style.width = `${Math.max(score, 1) * (100 / 6)}%`;
    barFill.style.background = s.color;
    pwLabel.textContent = met === 5 ? `${s.label} ✓` : `${s.label} — ناقص ${5 - met} من الشروط`;
    pwLabel.style.color = s.color;
  }

  const pw2 = pwInput2.value;
  if (!pw2) pwMatch.textContent = "";
  else if (pw === pw2) { pwMatch.textContent = "✓ كلمتا المرور متطابقتان"; pwMatch.style.color = "var(--ok)"; }
  else { pwMatch.textContent = "✗ كلمتا المرور غير متطابقتين"; pwMatch.style.color = "var(--bad)"; }
}
pwInput.addEventListener("input", updatePasswordUI);
pwInput2.addEventListener("input", updatePasswordUI);
updatePasswordUI();

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

  if (!isTripleName(fullName)) {
    return showAlert(messageEl, "اكتب اسمك ثلاثيًا على الأقل (٣ أجزاء، كل جزء حرفان فأكثر).", "warn");
  }
  if (!email) return showAlert(messageEl, "اكتب بريدك الإلكتروني.", "warn");
  if (!["first", "second"].includes(grade)) return showAlert(messageEl, "اختر الصف الدراسي.", "warn");
  if (!Object.values(passwordChecks(password)).every(Boolean)) {
    return showAlert(
      messageEl,
      "كلمة المرور ضعيفة: لازم ٨ أحرف على الأقل وتحتوي حرفًا صغيرًا وحرفًا كبيرًا ورقمًا ورمزًا خاصًا مثل @.",
      "warn",
    );
  }
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
