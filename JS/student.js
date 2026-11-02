import { supabase, GRADES, TELEGRAM_BOT_USERNAME, TELEGRAM_CHANNEL_URL } from "../supabase.js";
import { requireUser, bindLogout, STATUS_LABEL } from "./auth.js";
import { $, esc, toast, setBusy, openModal, copyText, downloadText, debounce } from "./ui.js";
import { initReveal } from "./animations.js";
import {
  BUCKET, KIND_LABEL, KIND_ICON, fmtSize, sortContent, applyWatermark, watermarkBackground,
} from "./common.js";

bindLogout();

let ctx;          // { user, profile }
let link = null;  // صف telegram_links
let pollTimer = null;
let contentLoaded = false;
let visibility = { first: true, second: true, private: true };

async function loadLink() {
  const { data } = await supabase.from("telegram_links").select("*").eq("user_id", ctx.user.id).maybeSingle();
  link = data;
}

async function loadProfile() {
  const { data } = await supabase.from("student_profiles").select("*").eq("id", ctx.user.id).maybeSingle();
  if (data) ctx.profile = data;
}

async function loadVisibility() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "grade_visible").maybeSingle();
  if (data?.value) visibility = { first: true, second: true, private: true, ...data.value };
}

// التحقق الفعلي من الاشتراك يتم في الخادم (Edge Function) وليس هنا
async function verifyChannel() {
  if (!link?.telegram_id) return;
  try {
    await supabase.functions.invoke("check-membership");
  } catch { /* نكتفي بما في قاعدة البيانات */ }
  await loadLink();
}

const isActive = () =>
  ctx.profile.status === "approved" && !!link?.telegram_id && !!link?.channel_member && !!link?.phone_verified;

function renderHeader() {
  const p = ctx.profile;
  $("#welcome").textContent = `أهلًا ${p.full_name || ""} 👋`;
  $("#gradeLine").textContent = `الصف: ${GRADES[p.grade] || p.grade}`;
  const badge = $("#statusBadge");
  badge.className = `badge badge-${p.status}`;
  badge.textContent = STATUS_LABEL[p.status] || p.status;
}

function renderSteps() {
  const p = ctx.profile;
  const linked = !!link?.telegram_id;
  const member = !!link?.channel_member;
  const phone = !!link?.phone_verified;
  const approved = p.status === "approved";

  const defs = [
    { done: true, title: "إنشاء الحساب", desc: "تم إنشاء حسابك بنجاح.", action: "" },
    {
      done: linked,
      title: "ربط تيليجرام",
      desc: linked
        ? `مربوط${link.telegram_username ? ` بالحساب @${esc(link.telegram_username)}` : ""}.`
        : "اضغط الزر، وسيفتح البوت — اضغط Start فيه لإتمام الربط.",
      action: linked ? "" : `<button class="btn btn-primary btn-sm" data-act="link">ربط تيليجرام</button>`,
    },
    {
      done: member,
      title: "الاشتراك في القناة",
      desc: member ? "تم التحقق من اشتراكك." : "اشترك في القناة ثم اضغط «تحقق الآن». يتم التحقق من الخادم.",
      action: member ? "" : `
        <a class="btn btn-sm" href="${esc(TELEGRAM_CHANNEL_URL)}" target="_blank" rel="noopener">فتح القناة</a>
        <button class="btn btn-primary btn-sm" data-act="verify" ${linked ? "" : "disabled"}>تحقق الآن</button>`,
    },
    {
      done: phone,
      title: "توثيق رقم الهاتف",
      desc: phone ? "تم توثيق رقمك." : "في البوت اضغط زر «مشاركة رقم الهاتف» (يجب أن يكون رقمك أنت).",
      action: phone ? "" : `<button class="btn btn-sm" data-act="verify" ${linked ? "" : "disabled"}>تحديث الحالة</button>`,
    },
    {
      done: approved,
      title: "موافقة الإدارة",
      desc: approved ? "تمت الموافقة على حسابك." : "يراجع المشرف طلبك. سيُفتح المحتوى فور الموافقة.",
      action: "",
    },
    {
      done: isActive(),
      title: "فتح المحتوى",
      desc: isActive() ? "المحتوى الخاص بصفك متاح لك أدناه." : "يفتح تلقائيًا عند إكمال الخطوات السابقة.",
      action: "",
    },
  ];

  const currentIdx = defs.findIndex((d) => !d.done);
  $("#steps").innerHTML = defs.map((d, i) => `
    <div class="step ${d.done ? "done" : i === currentIdx ? "current" : ""}">
      <div class="step-num">${d.done ? "✓" : i + 1}</div>
      <div class="step-body">
        <h4>${esc(d.title)}</h4>
        <p>${d.desc}</p>
        <div class="row">${d.action}</div>
      </div>
    </div>`).join("");

  $("#activation").hidden = isActive();
}

async function startLink(btn) {
  setBusy(btn, true, "جارٍ التجهيز...");
  const { data: code, error } = await supabase.rpc("create_telegram_link");
  setBusy(btn, false);
  if (error || !code) {
    toast("تعذّر إنشاء رابط الربط. حاول مرة أخرى.", "bad");
    return;
  }
  window.open(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(code)}`, "_blank", "noopener");
  toast("افتح البوت واضغط Start، ثم ارجع هنا.");
  startPolling();
}

async function refreshAll(showToast = false, btn) {
  if (btn) setBusy(btn, true, "جارٍ التحقق...");
  await loadProfile();
  await loadLink();
  await verifyChannel();
  render();
  if (btn) setBusy(btn, false);
  if (showToast) toast(isActive() ? "تم التفعيل ✔" : "لم تكتمل الخطوات بعد.", isActive() ? "ok" : "bad");
}

function startPolling() {
  clearInterval(pollTimer);
  let n = 0;
  pollTimer = setInterval(async () => {
    n++;
    if (document.hidden) return;
    await loadProfile();
    await loadLink();
    if (link?.telegram_id) await verifyChannel();
    render();
    if (isActive() || n > 100) clearInterval(pollTimer);
  }, 6000);
}

function render() {
  renderHeader();
  renderSteps();
  renderContent();
  initReveal();
}

/* ------------------------------ المحتوى ------------------------------ */

function lockedBox() {
  $("#contentBody").innerHTML = `
    <div class="empty" style="margin-top:16px">
      🔒 المحتوى مقفل حتى تكتمل خطوات التفعيل وتوافق الإدارة على حسابك.
    </div>`;
  contentLoaded = false;
}

async function renderContent() {
  if (!isActive()) return lockedBox();
  if (contentLoaded) return;
  contentLoaded = true;

  const box = $("#contentBody");
  box.innerHTML = `<div class="skeleton" style="margin-top:16px"></div>`;

  await loadVisibility();

  const { data: sections, error } = await supabase
    .from("learning_sections").select("*")
    .order("subject").order("position").order("created_at");

  if (error) {
    box.innerHTML = `<div class="alert alert-bad" style="margin-top:16px">تعذّر تحميل الفصول.</div>`;
    contentLoaded = false;
    return;
  }

  const ownHidden = visibility[ctx.profile.grade] === false;
  const note = ownHidden
    ? `<div class="alert alert-warn" style="margin-top:16px">قسم «${esc(GRADES[ctx.profile.grade])}» مخفي مؤقتًا من الإدارة.</div>` : "";

  if (!sections.length) {
    box.innerHTML = note || `<div class="empty" style="margin-top:16px">لا توجد فصول متاحة لك حاليًا.</div>`;
    return;
  }

  // مجموعات: مواد الصف أولًا، ثم «خاصة»
  const groups = {};
  sections.forEach((s) => {
    const key = s.grade === "private" ? "🔒 خاصة" : s.subject;
    (groups[key] ||= []).push(s);
  });
  const names = Object.keys(groups).sort((a, b) => (a.startsWith("🔒") ? 1 : b.startsWith("🔒") ? -1 : a.localeCompare(b)));
  const ico = (n) => n.startsWith("🔒") ? "🔒" : n === "JavaScript" ? "JS" : n === "Python" ? "Py" : n.includes("مالية") ? "💰" : n.slice(0, 2);
  const rtl = (n) => (/[؀-ۿ]|🔒/.test(n) ? 'style="direction:rtl"' : "");
  let active = names[0];
  let query = "";

  const chCard = (s) => `
    <button class="card hover" style="text-align:start;cursor:pointer;font:inherit;color:inherit" data-section="${esc(s.id)}" data-title="${esc((s.grade === "private" ? "خاصة" : s.subject) + " — " + s.title)}">
      <div class="icon-box">${s.grade === "private" ? "🔒" : "📚"}</div>
      <h3>${esc(s.title)}</h3>
      <p>اضغط لعرض المحتوى</p>
    </button>`;

  function paint() {
    $("#chTiles").innerHTML = names.map((n) => `
      <button class="stile ${!query && n === active ? "active" : ""}" data-g="${esc(n)}" type="button">
        <span class="ico">${esc(ico(n))}</span><b ${rtl(n)}>${esc(n)}</b><small>${groups[n].length} فصول</small>
      </button>`).join("");
    const q = query.trim().toLowerCase();
    if (q) {
      // البحث يشمل كل المواد
      const hits = sections.filter((s) => s.title.toLowerCase().includes(q));
      $("#chList").innerHTML = hits.length
        ? `<div class="subject-head"><h3>نتائج البحث</h3><span class="badge badge-neutral">${hits.length}</span></div><div class="grid grid-3">${hits.map(chCard).join("")}</div>`
        : `<div class="empty">لا توجد فصول مطابقة.</div>`;
    } else {
      $("#chList").innerHTML = `
        <div class="subject-head"><h3 ${rtl(active)}>${esc(active)}</h3><span class="badge ${active.startsWith("🔒") ? "badge-private" : "badge-neutral"}">${groups[active].length} فصول</span></div>
        <div class="grid grid-3">${groups[active].map(chCard).join("")}</div>`;
    }
  }

  box.innerHTML = note + `
    <div class="search-row" style="margin-top:16px"><input class="input" id="chSearch" type="search" placeholder="ابحث عن فصل..." /></div>
    <div class="subject-tiles" id="chTiles"></div>
    <div id="chList"></div>`;
  paint();
  $("#chTiles").addEventListener("click", (e) => {
    const t = e.target.closest("[data-g]");
    if (!t) return;
    active = t.dataset.g; query = ""; $("#chSearch").value = ""; paint();
  });
  $("#chSearch").addEventListener("input", debounce((e) => { query = e.target.value; paint(); }, 150));
  initReveal(box);
}

/* ------------------------------ فتح فصل ------------------------------ */

const logAccess = (id, action) => { supabase.rpc("log_access", { p_content: id, p_action: action }).then(() => {}, () => {}); };

async function signedUrl(path, downloadName) {
  const opts = downloadName ? { download: downloadName } : undefined;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120, opts);
  if (error || !data?.signedUrl) throw new Error("signed url failed");
  return data.signedUrl;
}

function itemButtons(c) {
  if (c.kind === "txt" && !c.storage_path) {
    return `<button class="btn btn-primary btn-sm" data-open="${esc(c.id)}" data-name="${esc(c.title)}">فتح</button>`;
  }
  if (c.storage_path) {
    const canView = c.kind === "pdf" || c.kind === "video";
    return `${canView ? `<button class="btn btn-primary btn-sm" data-file="view" data-id="${esc(c.id)}">فتح</button>` : ""}
            <button class="btn ${canView ? "" : "btn-primary"} btn-sm" data-file="download" data-id="${esc(c.id)}">⬇ تنزيل</button>`;
  }
  return `<a class="btn btn-primary btn-sm" href="${esc(c.external_url)}" target="_blank" rel="noopener noreferrer" data-ext="${esc(c.id)}">${c.kind === "video" ? "مشاهدة" : "فتح الملف"}</a>`;
}

function renderItems(list) {
  if (!list.length) return `<div class="empty">لا يوجد محتوى مطابق.</div>`;
  const groups = new Map();
  list.forEach((c) => {
    const k = c.folder || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  return keys.map((k) => (k ? `<div class="folder-head">📁 ${esc(k)}</div>` : "") +
    groups.get(k).map((c) => `
      <div class="item">
        <div class="meta"><b>${KIND_ICON[c.kind] || "📎"} ${esc(c.title)}</b>
          <small>${KIND_LABEL[c.kind]}${c.file_size ? " • " + fmtSize(c.file_size) : ""}</small></div>
        <div class="row" style="gap:6px">${itemButtons(c)}</div>
      </div>`).join("")).join("");
}

async function openSection(id, title) {
  const m = openModal(title);
  m.body.innerHTML = `<div class="skeleton"></div>`;

  // body لا يُحمّل هنا لتخفيف الطلب؛ يُجلب عند فتح ملف النص
  const { data, error } = await supabase
    .from("learning_content")
    .select("id,title,kind,external_url,storage_path,file_size,original_name,chapter_no,folder,position,created_at")
    .eq("section_id", id);

  if (error) { m.body.innerHTML = `<div class="alert alert-bad">ليس لديك صلاحية لعرض هذا المحتوى أو انتهت الجلسة.</div>`; return; }
  if (!data.length) { m.body.innerHTML = `<div class="empty">لا يوجد محتوى في هذا الفصل بعد.</div>`; return; }

  const items = data.sort(sortContent);
  const byId = new Map(items.map((c) => [c.id, c]));

  m.body.innerHTML = `
    <div class="search-row"><input class="input" id="itemSearch" type="search" placeholder="بحث باسم الملف..." /></div>
    <div class="list" id="itemList">${renderItems(items)}</div>`;

  $("#itemSearch", m.body).addEventListener("input", debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    $("#itemList", m.body).innerHTML = renderItems(items.filter((c) =>
      !q || c.title.toLowerCase().includes(q) || (c.original_name || "").toLowerCase().includes(q)));
  }, 150));

  m.body.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-open]");
    if (t) return openTxt(t.dataset.open, t.dataset.name);

    const ext = e.target.closest("[data-ext]");
    if (ext) { logAccess(ext.dataset.ext, "view"); return; }

    const f = e.target.closest("[data-file]");
    if (!f) return;
    const c = byId.get(f.dataset.id);
    if (!c) return;
    const download = f.dataset.file === "download";

    // نفتح التبويب فورًا (قبل أي await) حتى لا يحجبه المتصفح
    const win = download ? null : window.open("about:blank", "_blank");
    setBusy(f, true, "...");
    try {
      const name = c.original_name || c.title;
      const url = await signedUrl(c.storage_path, download ? name : undefined);
      logAccess(c.id, download ? "download" : "view");
      if (download) {
        const a = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
      } else if (win) {
        win.location.href = url;
      } else {
        location.href = url;
      }
    } catch {
      if (win) win.close();
      toast("تعذّر فتح الملف. حاول مرة أخرى.", "bad");
    }
    setBusy(f, false);
  });
}

async function openTxt(id, name) {
  const m = openModal(name, { wide: true });
  m.body.innerHTML = `<div class="skeleton"></div>`;
  const { data, error } = await supabase.from("learning_content").select("body").eq("id", id).maybeSingle();
  if (error || !data) { m.body.innerHTML = `<div class="alert alert-bad">تعذّر تحميل الملف.</div>`; return; }

  logAccess(id, "view");

  const user = { id: ctx.user.id, name: ctx.profile.full_name, email: ctx.user.email };
  const text = data.body ?? "";
  // العلامة المائية لملفات TXT فقط: داخل العرض (خلفية) وفي النسخ والتنزيل (سطر أعلى وأسفل)
  const stamped = applyWatermark(text, user);

  m.body.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <button class="btn btn-primary btn-sm" id="copyBtn">📋 نسخ النص</button>
      <button class="btn btn-sm" id="dlBtn">⬇️ تنزيل الملف</button>
    </div>
    <pre class="viewer wm" id="viewer"></pre>`;
  const viewer = $("#viewer", m.body);
  viewer.textContent = text; // textContent → آمن من حقن HTML
  viewer.style.backgroundImage = watermarkBackground(user);

  $("#copyBtn", m.body).addEventListener("click", async () => {
    const ok = await copyText(stamped);
    if (ok) logAccess(id, "copy");
    toast(ok ? "تم نسخ النص" : "تعذّر النسخ", ok ? "ok" : "bad");
  });
  $("#dlBtn", m.body).addEventListener("click", () => {
    logAccess(id, "download");
    downloadText(name, stamped);
  });
}

document.addEventListener("click", (e) => {
  const sec = e.target.closest("[data-section]");
  if (sec) return openSection(sec.dataset.section, sec.dataset.title);

  const act = e.target.closest("[data-act]");
  if (!act) return;
  if (act.dataset.act === "link") startLink(act);
  if (act.dataset.act === "verify") refreshAll(true, act);
});

/* ------------------------------ تشغيل ------------------------------ */
(async () => {
  try {
    ctx = await requireUser();
  } catch { return; }

  const who = $("#whoami");
  who.textContent = ctx.user.email;
  who.hidden = false;

  await loadLink();
  await verifyChannel();

  $("#loading").hidden = true;
  $("#app").hidden = false;
  render();

  if (!isActive()) startPolling();
})();
