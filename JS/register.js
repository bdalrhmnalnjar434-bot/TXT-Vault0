import { supabase, isConfigured } from "../supabase.js";
import { arabicAuthError, getSession, getProfile, checkAdmin, routeAfterLogin } from "./auth.js";
import { bindSupport } from "./support.js";
import { showAlert, hideAlert, setBusy, initPasswordToggles } from "./ui.js";

const form = document.getElementById("registerForm");
const messageEl = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");
initPasswordToggles();
bindSupport();

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
  // حماية: لو ملف register.html قديم ولا يحتوي عناصر العداد، لا نوقف باقي الصفحة
  if (!pwInput || !pwInput2 || !barFill || !pwLabel || !pwMatch) return;
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
pwInput?.addEventListener("input", updatePasswordUI);
pwInput2?.addEventListener("input", updatePasswordUI);
updatePasswordUI();

if (!isConfigured) {
  showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js وضع Project URL و anon key.", "warn");
}

// ---------- الخطوة ١: اختيار الحساب من Google ----------
const gStep = document.getElementById("gStep");
const googleBtn = document.getElementById("googleBtn");

googleBtn?.addEventListener("click", async () => {
  hideAlert(messageEl);
  if (!isConfigured) return showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js.", "warn");
  setBusy(googleBtn, true, "جارٍ فتح Google...");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("register.html", location.href).href,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    showAlert(messageEl, "تعذّر فتح Google: فعّل Google من Supabase ← Authentication ← Providers. (" + error.message + ")", "bad");
    setBusy(googleBtn, false);
  }
});

document.getElementById("otherGoogle")?.addEventListener("click", async (e) => {
  e.preventDefault();
  try { await supabase.auth.signOut(); } catch { /* تجاهل */ }
  location.href = "register.html";
});

// بعد العودة من Google: نعرض الخطوة ٢ (الاسم والصف وكلمة المرور)
(async () => {
  if (!isConfigured) return;
  const session = await getSession();
  if (!session) return;
  if (await checkAdmin(session.user.id)) return routeAfterLogin(session.user);
  let profile = null;
  try { profile = await getProfile(session.user.id); } catch { /* تجاهل */ }
  if (profile && profile.profile_completed !== false) return routeAfterLogin(session.user);
  gStep.hidden = true;
  form.hidden = false;
  document.getElementById("email").value = session.user.email || "";
  const guess = (profile?.full_name || "").trim();
  if (guess) document.getElementById("fullName").value = guess;
})();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert(messageEl);

  if (!isConfigured) {
    showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js وضع Project URL و anon key.", "warn");
    return;
  }

  const fullName = document.getElementById("fullName").value.trim();
  const grade = document.getElementById("grade").value;
  const password = document.getElementById("password").value;
  const password2 = document.getElementById("password2").value;

  if (!isTripleName(fullName)) {
    return showAlert(messageEl, "اكتب اسمك ثلاثيًا على الأقل (٣ أجزاء، كل جزء حرفان فأكثر).", "warn");
  }
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
    const { error } = await supabase.auth.updateUser({ password, data: { full_name: fullName, grade } });
    if (error) throw error;
    const { data: res, error: rpcErr } = await supabase.rpc("complete_registration", { p_name: fullName, p_grade: grade });
    if (rpcErr) throw rpcErr;
    if (res !== "ok") throw new Error("تعذّر حفظ البيانات (" + res + "). تأكد من تشغيل sql/migration_7.sql.");
    location.href = "student.html";
  } catch (err) {
    showAlert(messageEl, arabicAuthError(err), "bad");
    setBusy(submitBtn, false);
  }
});
