// أدوات واجهة مشتركة: تهريب HTML، إشعارات، نوافذ منبثقة، حالة التحميل

// وضع خفيف تلقائي على الأجهزة الضعيفة/الموبايل لتسريع الصفحات (يمكن إلغاؤه: localStorage.txtv_lite = "0")
(() => {
  try {
    const pref = localStorage.getItem("txtv_lite");
    const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    if (pref === "1" || (pref !== "0" && weak)) document.documentElement.classList.add("lite");
  } catch { /* تجاهل */ }
})();

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function toast(message, type = "ok", ms = 3800) {
  let box = $(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function showAlert(el, message, type = "bad") {
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.hidden = false;
  // الرسالة في أعلى البطاقة؛ نمرّر الصفحة إليها حتى لا تضيع خارج الشاشة
  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* تجاهل */ }
}
export function hideAlert(el) { if (el) el.hidden = true; }

export function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${esc(busyText || "جارٍ التنفيذ...")}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

// نافذة منبثقة: تُرجع { body, close } — اكتب المحتوى داخل body
export function openModal(title, { wide = false } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="width:min(980px,100%)"' : ""}>
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" type="button" aria-label="إغلاق">✕</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  $(".icon-btn", overlay).addEventListener("click", close);

  return { body: $(".modal-body", overlay), close, overlay };
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = /\.txt$/i.test(filename) ? filename : `${filename}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

const SVG = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const EYE_ON = `<svg class="eye-on" ${SVG}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg class="eye-off" ${SVG}><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function initPasswordToggles() {
  $$('input[type="password"]').forEach((input) => {
    let wrap = input.parentElement;
    if (!wrap.classList.contains("pw-field")) {
      wrap = document.createElement("div");
      wrap.className = "pw-field";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle";
    btn.setAttribute("aria-label", "إظهار كلمة المرور");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = EYE_ON + EYE_OFF;
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.classList.toggle("on", show);
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
    });
    wrap.appendChild(btn);
  });
}
