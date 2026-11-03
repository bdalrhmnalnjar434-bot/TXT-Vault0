// وضع الصيانة: يقرأ الحالة (حتى بدون تسجيل دخول) ويعرض شاشة تغطي الموقع
import { supabase, isConfigured } from "../supabase.js";

const DEFAULT_MSG = "الموقع تحت الصيانة حاليًا. هنرجع قريبًا ✨";

export async function getMaintenance() {
  if (!isConfigured) return { on: false, message: "" };
  try {
    const { data, error } = await supabase.rpc("get_maintenance");
    if (error || !data) return { on: false, message: "" };
    return { on: !!data.on, message: data.message || "" };
  } catch { return { on: false, message: "" }; }
}

export function showMaintenance(m, { loginLink = true } = {}) {
  document.documentElement.classList.add("under-maintenance");
  const el = document.createElement("div");
  el.className = "maintenance-screen";
  el.innerHTML = `
    <div class="card" style="max-width:520px;text-align:center">
      <div style="font-size:48px">🛠️</div>
      <h2 style="margin:8px 0">الموقع مقفول مؤقتًا</h2>
      <p class="maint-msg" style="white-space:pre-wrap;color:var(--muted)"></p>
      <p class="hint">الصفحة هتتحدّث لوحدها أول ما الموقع يرجع.</p>
      ${loginLink ? `<a href="login.html" class="hint">دخول المشرفين</a>` : ""}
    </div>`;
  el.querySelector(".maint-msg").textContent = m.message || DEFAULT_MSG;
  document.body.appendChild(el);
  // إعادة فحص كل 20 ثانية؛ لو رجع الموقع نحدّث الصفحة
  setInterval(async () => { if (!(await getMaintenance()).on) location.reload(); }, 20000);
}

// للصفحات العامة (الرئيسية/التسجيل): لو الصيانة شغالة نغطي الصفحة
export async function guardPublicPage(opts) {
  const m = await getMaintenance();
  if (m.on) showMaintenance(m, opts);
  return m;
}
