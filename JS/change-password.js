// صفحة اختيار كلمة مرور جديدة بعد الدخول بكلمة مؤقتة من المشرف
import { supabase, isConfigured } from "../supabase.js";
import { getSession, getProfile, arabicAuthError } from "./auth.js";
import { showAlert, hideAlert, setBusy, initPasswordToggles } from "./ui.js";

const form = document.getElementById("pwForm");
const messageEl = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");
initPasswordToggles();

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
  { label: "ضعيفة جدًا", color: "var(--bad)" }, { label: "ضعيفة", color: "var(--bad)" },
  { label: "متوسطة", color: "var(--warn)" }, { label: "جيدة", color: "var(--warn)" },
  { label: "قوية", color: "var(--ok)" }, { label: "قوية جدًا", color: "var(--ok)" },
];
const pwInput = document.getElementById("password");
const pwInput2 = document.getElementById("password2");
const barFill = document.getElementById("pwBarFill");
const pwLabel = document.getElementById("pwLabel");
const pwMatch = document.getElementById("pwMatch");

function updateUI() {
  const pw = pwInput.value;
  const checks = passwordChecks(pw);
  const met = Object.values(checks).filter(Boolean).length;
  document.querySelectorAll("#pwRules li").forEach((li) => li.classList.toggle("ok", !!checks[li.dataset.rule]));
  if (!pw) {
    barFill.style.width = "0"; pwLabel.textContent = "اكتب كلمة المرور"; pwLabel.style.color = "";
  } else {
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
pwInput.addEventListener("input", updateUI);
pwInput2.addEventListener("input", updateUI);

// لازم يكون داخل بحساب ومطلوب منه تغيير الكلمة، وإلا نرجعه
(async () => {
  if (!isConfigured) return showAlert(messageEl, "الإعداد غير مكتمل: افتح supabase.js.", "warn");
  const session = await getSession();
  if (!session) return location.replace("login.html");
  try {
    const profile = await getProfile(session.user.id);
    if (!profile?.must_change_password) location.replace("student.html");
  } catch { /* تجاهل */ }
})();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert(messageEl);
  const password = pwInput.value;
  if (!Object.values(passwordChecks(password)).every(Boolean)) {
    return showAlert(messageEl, "كلمة المرور ضعيفة: لازم ٨ أحرف على الأقل وتحتوي حرفًا صغيرًا وحرفًا كبيرًا ورقمًا ورمزًا خاصًا مثل @.", "warn");
  }
  if (password !== pwInput2.value) return showAlert(messageEl, "كلمتا المرور غير متطابقتين.", "warn");

  setBusy(submitBtn, true, "جارٍ الحفظ...");
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    const { error: rpcErr } = await supabase.rpc("clear_must_change_password");
    if (rpcErr) throw rpcErr;
    location.href = "student.html";
  } catch (err) {
    showAlert(messageEl, arabicAuthError(err), "bad");
    setBusy(submitBtn, false);
  }
});
