import { supabase, GRADES, SUBJECTS } from "../supabase.js";
import { requireUser, bindLogout, STATUS_LABEL } from "./auth.js";
import { $, $$, esc, toast, setBusy, openModal, debounce, formatDate } from "./ui.js";
import { initReveal, observeDynamic } from "./animations.js";
import {
  GRADES_ALL, BUCKET, MAX_FILE_MB, MAX_TXT_DB_MB, KIND_LABEL, KIND_ICON,
  fmtSize, extOf, baseName, kindFromName, chapterNo, chapterTitle, sortContent, dupKey,
} from "./common.js";

bindLogout();

/* كل عمليات الكتابة هنا تمر عبر RLS / دوال RPC التي تتحقق من is_admin() في قاعدة البيانات،
   فلو فتح طالب هذه الصفحة بأي طريقة لن ينجح أي إجراء. */

let students = [];
let sections = [];
let gradeVisible = { first: true, second: true, private: true };
const CONTENT_COLS = "id,title,kind,external_url,storage_path,file_size,original_name,chapter_no,folder,position,created_at,deleted_at";

/* ------------------------------ تبويبات ------------------------------ */
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  ["students", "content", "trash", "log"].forEach((n) => { $(`#tab-${n}`).hidden = t.dataset.tab !== n; });
  if (t.dataset.tab === "content") { loadSections(); loadVisibility(); }
  if (t.dataset.tab === "trash") loadSections().then(renderTrash);
  if (t.dataset.tab === "log") loadLog();
}));

/* ------------------------------ الطلاب ------------------------------ */
async function loadStudents() {
  const { data, error } = await supabase
    .from("student_profiles")
    .select("*, telegram_links(telegram_username, telegram_id, channel_member, phone_verified, phone)")
    .order("created_at", { ascending: false });
  if (error) { toast("تعذّر تحميل الطلاب", "bad"); return; }
  students = data;
  renderStats();
  renderStudents();
}

function renderStats() {
  const c = (s) => students.filter((x) => x.status === s).length;
  const items = [
    ["إجمالي الحسابات", students.length],
    ["بانتظار الموافقة", c("pending")],
    ["مفعّلون", c("approved")],
    ["موقوف / مرفوض", c("suspended") + c("rejected")],
  ];
  $("#stats").innerHTML = items.map(([label, n]) =>
    `<div class="card stat reveal"><b>${n}</b><span>${label}</span></div>`).join("");
  initReveal($("#stats"));
}

function tgCell(s) {
  const t = s.telegram_links;
  if (!t || !t.telegram_id) return `<span class="badge badge-neutral">غير مربوط</span>`;
  return `
    <small>${t.telegram_username ? "@" + esc(t.telegram_username) : "مربوط"}</small>
    <span class="badge ${t.channel_member ? "badge-approved" : "badge-pending"}">${t.channel_member ? "مشترك" : "غير مشترك"}</span>
    <span class="badge ${t.phone_verified ? "badge-approved" : "badge-pending"}">${t.phone_verified ? "هاتف موثّق" : "بدون هاتف"}</span>`;
}

function actionsCell(s) {
  const b = (act, label, cls = "") =>
    `<button class="btn btn-sm ${cls}" data-act="${act}" data-id="${esc(s.id)}">${label}</button>`;
  const out = [];
  if (s.status === "pending") out.push(b("approved", "قبول", "btn-ok"), b("rejected", "رفض", "btn-danger"));
  if (s.status === "approved") out.push(b("suspended", "إيقاف", "btn-danger"));
  if (s.status === "suspended" || s.status === "rejected") out.push(b("approved", "تفعيل", "btn-ok"));
  out.push(b("access", "الفصول"));
  out.push(b("edit", "تعديل"));
  return `<div class="actions">${out.join("")}</div>`;
}

function renderStudents() {
  const q = $("#search").value.trim().toLowerCase();
  const st = $("#statusFilter").value;
  const gr = $("#gradeFilter").value;

  const list = students.filter((s) =>
    (!st || s.status === st) && (!gr || s.grade === gr) &&
    (!q || (s.full_name || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q)));

  $("#studentsBody").innerHTML = list.length ? list.map((s) => `
    <tr>
      <td><b>${esc(s.full_name || "—")}</b><small class="ltr" style="direction:ltr;text-align:start">${esc(s.email || "")}</small></td>
      <td>
        <select data-grade="${esc(s.id)}" aria-label="الصف" style="min-width:140px;padding:6px 10px">
          ${Object.entries(GRADES).map(([k, v]) => `<option value="${k}" ${s.grade === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </td>
      <td><span class="badge badge-${s.status}">${STATUS_LABEL[s.status]}</span></td>
      <td>${tgCell(s)}</td>
      <td>${formatDate(s.created_at)}</td>
      <td>${actionsCell(s)}</td>
    </tr>`).join("")
    : `<tr><td colspan="6"><div class="empty" style="border:none">لا توجد نتائج.</div></td></tr>`;
}

async function setStatus(id, status, btn) {
  const labels = { approved: "قبول/تفعيل", rejected: "رفض", suspended: "إيقاف" };
  if (status !== "approved" && !confirm(`تأكيد ${labels[status]} هذا الحساب؟`)) return;
  setBusy(btn, true, "...");
  const { error } = await supabase.rpc("admin_set_student_status", { p_user: id, p_status: status });
  setBusy(btn, false);
  if (error) return toast("فشل تنفيذ الإجراء", "bad");
  toast("تم التحديث");
  loadStudents();
}

async function changeGrade(id, grade, selectEl) {
  const s = students.find((x) => x.id === id);
  if (!s || s.grade === grade) return;
  if (!confirm(`نقل الطالب إلى «${GRADES[grade]}»؟ ستُعاد صلاحيات الفصول حسب الصف الجديد (فصول «خاصة» تبقى كما هي).`)) {
    selectEl.value = s.grade;
    return;
  }
  const { error } = await supabase.rpc("admin_set_student_grade", { p_user: id, p_grade: grade });
  if (error) { toast("فشل نقل الطالب", "bad"); selectEl.value = s.grade; return; }
  toast("تم نقل الطالب وتحديث صلاحياته");
  loadStudents();
}

function editStudent(id) {
  const s = students.find((x) => x.id === id);
  if (!s) return;
  const m = openModal("تعديل بيانات الطالب");
  m.body.innerHTML = `
    <form id="editForm" novalidate>
      <div class="field"><label>الاسم</label><input class="input" id="eName" value="${esc(s.full_name)}" maxlength="100" /></div>
      <div class="field"><label>البريد (للعرض فقط)</label><input class="input ltr" value="${esc(s.email || "")}" disabled /></div>
      <button class="btn btn-primary" type="submit">حفظ</button>
    </form>`;
  $("#editForm", m.body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#eName", m.body).value.trim();
    if (name.length < 3) return toast("الاسم قصير", "bad");
    const { error } = await supabase.from("student_profiles").update({ full_name: name }).eq("id", id);
    if (error) return toast("فشل الحفظ", "bad");
    toast("تم الحفظ");
    m.close();
    loadStudents();
  });
}

// صلاحيات الفصول لطالب: فصول صفه + فصول «خاصة» (تُمنح يدويًا لكل طالب)
async function editAccess(id) {
  const s = students.find((x) => x.id === id);
  if (!s) return;
  const m = openModal(`فصول الطالب: ${s.full_name || s.email}`);
  m.body.innerHTML = `<div class="skeleton"></div>`;

  const [{ data: secs }, { data: acc }] = await Promise.all([
    supabase.from("learning_sections").select("*").in("grade", [s.grade, "private"]).order("grade").order("subject").order("position"),
    supabase.from("student_section_access").select("section_id").eq("student_id", id),
  ]);
  const allowed = new Set((acc || []).map((a) => a.section_id));

  if (!secs?.length) { m.body.innerHTML = `<div class="empty">لا توجد فصول لصف «${GRADES[s.grade]}» أو في «خاصة».</div>`; return; }

  const row = (sec) => `
    <label class="item" style="cursor:pointer">
      <div class="meta"><b>${esc(sec.title)}</b><small>${sec.grade === "private" ? "خاصة" : esc(sec.subject)}</small></div>
      <input type="checkbox" data-sec="${esc(sec.id)}" ${allowed.has(sec.id) ? "checked" : ""} style="width:20px;height:20px;accent-color:#2de2e6" />
    </label>`;
  const normal = secs.filter((x) => x.grade !== "private");
  const priv = secs.filter((x) => x.grade === "private");

  m.body.innerHTML = `
    <p class="hint" style="margin-bottom:12px">الصف الحالي: ${GRADES[s.grade]} — حدّد الفصول المسموح بها لهذا الطالب.</p>
    ${normal.length ? `<div class="list">${normal.map(row).join("")}</div>` : ""}
    ${priv.length ? `<div class="folder-head" style="direction:rtl">🔒 قسم «خاصة»</div><div class="list">${priv.map(row).join("")}</div>` : ""}`;

  m.body.addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-sec]");
    if (!cb) return;
    cb.disabled = true;
    const q = supabase.from("student_section_access");
    const { error } = cb.checked
      ? await q.insert({ student_id: id, section_id: cb.dataset.sec })
      : await q.delete().eq("student_id", id).eq("section_id", cb.dataset.sec);
    cb.disabled = false;
    if (error) { cb.checked = !cb.checked; toast("فشل التحديث", "bad"); } else { toast("تم التحديث"); }
  });
}

$("#studentsBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case "access": return editAccess(id);
    case "edit": return editStudent(id);
    default: return setStatus(id, b.dataset.act, b);
  }
});
$("#studentsBody").addEventListener("change", (e) => {
  const sel = e.target.closest("[data-grade]");
  if (sel) changeGrade(sel.dataset.grade, sel.value, sel);
});
$("#search").addEventListener("input", debounce(renderStudents, 200));
$("#statusFilter").addEventListener("change", renderStudents);
$("#gradeFilter").addEventListener("change", renderStudents);
$("#reloadStudents").addEventListener("click", loadStudents);

/* ------------------------------ إظهار/إخفاء الأقسام الثلاثة ------------------------------ */
async function loadVisibility() {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "grade_visible").maybeSingle();
  if (data?.value) gradeVisible = { first: true, second: true, private: true, ...data.value };
  renderVisibility();
}

function renderVisibility() {
  $("#visBar").innerHTML = `<span class="vis-title">ظهور الأقسام للطلاب:</span>` +
    ["first", "second", "private"].map((g) => `
      <label class="switch ${gradeVisible[g] ? "on" : ""}">
        <input type="checkbox" data-vis="${g}" ${gradeVisible[g] ? "checked" : ""} />
        ${GRADES_ALL[g]}
      </label>`).join("");
}

$("#visBar").addEventListener("change", async (e) => {
  const cb = e.target.closest("[data-vis]");
  if (!cb) return;
  const next = { ...gradeVisible, [cb.dataset.vis]: cb.checked };
  cb.disabled = true;
  const { error } = await supabase.from("app_settings")
    .upsert({ key: "grade_visible", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  cb.disabled = false;
  if (error) { cb.checked = !cb.checked; return toast("فشل تحديث الظهور", "bad"); }
  gradeVisible = next;
  renderVisibility();
  toast(cb.checked ? `تم إظهار «${GRADES_ALL[cb.dataset.vis]}»` : `تم إخفاء «${GRADES_ALL[cb.dataset.vis]}»`);
});

/* ------------------------------ الفصول والمحتوى ------------------------------ */
[...SUBJECTS].forEach((s) => {
  $("#secSubject").insertAdjacentHTML("beforeend", `<option value="${s}">${s}</option>`);
  $("#cSubject").insertAdjacentHTML("beforeend", `<option value="${s}">${s}</option>`);
});
$("#cSubject").insertAdjacentHTML("beforeend", `<option value="خاصة">خاصة</option>`);

$("#secGrade").addEventListener("change", () => {
  $("#secSubjectBox").hidden = $("#secGrade").value === "private";
});

async function loadSections() {
  const { data, error } = await supabase
    .from("learning_sections")
    .select(`*, learning_content(${CONTENT_COLS})`)
    .order("grade").order("subject").order("position").order("created_at");
  if (error) { toast("تعذّر تحميل الفصول", "bad"); return; }
  sections = data;
  renderSections();
}

const activeItems = (s) => (s.learning_content || []).filter((c) => !c.deleted_at).sort(sortContent);

function renderItem(c, dupSet) {
  const dup = dupSet.has(dupKey(c));
  return `
    <div class="item" data-cid="${esc(c.id)}">
      <div class="meta">
        <b>${KIND_ICON[c.kind] || "📎"} ${esc(c.title)}
          ${dup ? `<span class="badge badge-warn" title="يوجد ملف آخر بنفس الاسم والنوع">اسم مكرر</span>` : ""}</b>
        <small>${KIND_LABEL[c.kind]}${c.file_size ? " • " + fmtSize(c.file_size) : ""}${c.external_url ? " • رابط خارجي" : ""}${c.original_name ? " • " + esc(c.original_name) : ""}</small>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn btn-sm" data-cact="edit">تعديل</button>
        <button class="btn btn-sm btn-danger" data-cact="delete">حذف</button>
      </div>
    </div>`;
}

function renderSectionItems(items) {
  if (!items.length) return `<div class="empty" style="padding:14px">لا يوجد محتوى بعد.</div>`;
  const counts = {};
  items.forEach((c) => { counts[dupKey(c)] = (counts[dupKey(c)] || 0) + 1; });
  const dupSet = new Set(Object.keys(counts).filter((k) => counts[k] > 1));

  // التجميع بالمجلدات (الملفات بلا مجلد أولًا)
  const groups = new Map();
  items.forEach((c) => {
    const k = c.folder || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  return keys.map((k) =>
    (k ? `<div class="folder-head">📁 ${esc(k)}</div>` : "") + groups.get(k).map((c) => renderItem(c, dupSet)).join("")
  ).join("");
}

function renderSections() {
  const g = $("#cGrade").value;
  const sub = $("#cSubject").value;
  const q = $("#cSearch").value.trim().toLowerCase();

  const list = sections.filter((s) => {
    if (g && s.grade !== g) return false;
    if (sub && !(sub === "خاصة" ? s.grade === "private" : s.subject === sub)) return false;
    if (!q) return true;
    return s.title.toLowerCase().includes(q) || activeItems(s).some((c) => c.title.toLowerCase().includes(q) || (c.original_name || "").toLowerCase().includes(q));
  });
  const box = $("#sectionsList");

  if (!list.length) { box.innerHTML = `<div class="empty">لا توجد فصول مطابقة.</div>`; return; }

  box.innerHTML = list.map((s) => {
    let items = activeItems(s);
    if (q && !s.title.toLowerCase().includes(q)) {
      items = items.filter((c) => c.title.toLowerCase().includes(q) || (c.original_name || "").toLowerCase().includes(q));
    }
    return `
    <article class="card reveal" data-secid="${esc(s.id)}">
      <div class="row" style="justify-content:space-between">
        <div>
          <h3 style="margin:0">${esc(s.title)}</h3>
          <div class="tags" style="margin-top:6px">
            ${s.grade === "private" ? `<span class="badge badge-private">🔒 خاصة</span>` : `<span class="tag">${esc(s.subject)}</span><span class="badge badge-neutral">${GRADES[s.grade]}</span>`}
            <span class="badge ${s.is_published ? "badge-approved" : "badge-pending"}">${s.is_published ? "منشور" : "مخفي"}</span>
            <span class="badge badge-neutral">${activeItems(s).length} ملف</span>
          </div>
        </div>
        <div class="actions row" style="gap:6px">
          <button class="btn btn-sm btn-primary" data-sact="upload">⬆ رفع ملفات</button>
          <button class="btn btn-sm" data-sact="addc">+ نص / رابط</button>
          ${s.grade !== "private" ? `<button class="btn btn-sm" data-sact="autoname" title="إعادة تسمية كل الملفات حسب رقم الفصل">ترقيم تلقائي</button>` : ""}
          <button class="btn btn-sm" data-sact="rename">تعديل</button>
          <button class="btn btn-sm" data-sact="toggle">${s.is_published ? "إخفاء" : "نشر"}</button>
          <button class="btn btn-sm btn-danger" data-sact="delete">حذف</button>
        </div>
      </div>
      <div class="list" style="margin-top:14px">${renderSectionItems(items)}</div>
    </article>`;
  }).join("");
  initReveal(box);
}

$("#sectionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#secTitle").value.trim();
  if (!title) return toast("اكتب عنوان الفصل", "bad");
  const grade = $("#secGrade").value;
  const { error } = await supabase.from("learning_sections").insert({
    grade,
    subject: grade === "private" ? "خاصة" : $("#secSubject").value,
    title,
    position: parseInt($("#secPos").value, 10) || 0,
  });
  if (error) return toast("فشل إضافة الفصل (هل شغّلت migration_2.sql؟)", "bad");
  $("#secTitle").value = "";
  toast("تمت إضافة الفصل");
  loadSections();
});
$("#cGrade").addEventListener("change", renderSections);
$("#cSubject").addEventListener("change", renderSections);
$("#cSearch").addEventListener("input", debounce(renderSections, 200));

// حذف ملفات التخزين (مصفوفة مسارات)
async function removeFiles(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 100) {
    await supabase.storage.from(BUCKET).remove(list.slice(i, i + 100));
  }
}

// ترقيم تلقائي: يعيد تسمية كل الملفات في الفصل حسب الرقم المستخرج من اسمها
async function autoRename(sec) {
  const items = activeItems(sec);
  if (!items.length) return toast("لا يوجد محتوى", "bad");
  if (!confirm(`إعادة تسمية ${items.length} ملف في «${sec.title}» بصيغة ${sec.grade === "first" ? "F" : "S"} <الرقم> Chapter؟`)) return;

  let changed = 0, skipped = 0;
  for (const c of items) {
    const n = c.chapter_no ?? chapterNo(c.original_name || c.title);
    if (n == null) { skipped++; continue; }
    const title = chapterTitle(sec.grade, n, c.title);
    if (title === c.title && c.chapter_no === n) continue;
    const { error } = await supabase.from("learning_content").update({ title, chapter_no: n, position: n }).eq("id", c.id);
    if (!error) changed++;
  }
  toast(`تمت إعادة تسمية ${changed} ملف${skipped ? ` • ${skipped} بلا رقم تُركت كما هي` : ""}`);
  loadSections();
}

$("#sectionsList").addEventListener("click", async (e) => {
  const card = e.target.closest("[data-secid]");
  if (!card) return;
  const sec = sections.find((s) => s.id === card.dataset.secid);
  if (!sec) return;

  const sact = e.target.closest("[data-sact]")?.dataset.sact;
  const cact = e.target.closest("[data-cact]")?.dataset.cact;

  if (sact === "upload") return uploadModal(sec);
  if (sact === "addc") return contentModal(sec);
  if (sact === "autoname") return autoRename(sec);
  if (sact === "rename") {
    const t = prompt("عنوان الفصل:", sec.title);
    if (t && t.trim() && t.trim() !== sec.title) {
      const { error } = await supabase.from("learning_sections").update({ title: t.trim() }).eq("id", sec.id);
      error ? toast("فشل التعديل", "bad") : (toast("تم التعديل"), loadSections());
    }
    return;
  }
  if (sact === "toggle") {
    const { error } = await supabase.from("learning_sections").update({ is_published: !sec.is_published }).eq("id", sec.id);
    error ? toast("فشل التحديث", "bad") : loadSections();
    return;
  }
  if (sact === "delete") {
    const n = (sec.learning_content || []).length;
    if (!confirm(`حذف «${sec.title}» نهائيًا مع ${n} ملف (بما فيها المحذوفة في السلة)؟ لا يمكن التراجع.`)) return;
    await removeFiles((sec.learning_content || []).map((c) => c.storage_path));
    const { error } = await supabase.from("learning_sections").delete().eq("id", sec.id);
    error ? toast("فشل الحذف", "bad") : (toast("تم الحذف"), loadSections());
    return;
  }

  if (cact) {
    const cid = e.target.closest("[data-cid]").dataset.cid;
    const c = (sec.learning_content || []).find((x) => x.id === cid);
    if (cact === "edit") {
      if (c?.storage_path) {
        const t = prompt("اسم الملف:", c.title);
        if (t && t.trim() && t.trim() !== c.title) {
          const { error } = await supabase.from("learning_content").update({ title: t.trim() }).eq("id", cid);
          error ? toast("فشل التعديل", "bad") : (toast("تم التعديل"), loadSections());
        }
        return;
      }
      return contentModal(sec, cid);
    }
    if (cact === "delete") {
      if (!confirm("نقل هذا الملف إلى سلة المحذوفات؟ (يمكن استرجاعه)")) return;
      const { error } = await supabase.from("learning_content").update({ deleted_at: new Date().toISOString() }).eq("id", cid);
      error ? toast("فشل الحذف", "bad") : (toast("نُقل إلى السلة"), loadSections());
    }
  }
});

/* ------------------------------ إضافة نص / رابط (الطريقة القديمة) ------------------------------ */
async function contentModal(sec, contentId = null) {
  const m = openModal(contentId ? "تعديل المحتوى" : `إضافة محتوى — ${sec.title}`, { wide: true });
  let existing = null;

  if (contentId) {
    m.body.innerHTML = `<div class="skeleton"></div>`;
    const { data } = await supabase.from("learning_content").select("*").eq("id", contentId).maybeSingle();
    existing = data;
    if (!existing) { m.body.innerHTML = `<div class="alert alert-bad">تعذّر تحميل المحتوى.</div>`; return; }
  }

  const kind0 = existing?.kind === "pdf" || existing?.kind === "video" ? existing.kind : "txt";
  m.body.innerHTML = `
    <form id="cForm" novalidate>
      <div class="row">
        <div class="field grow"><label>العنوان</label><input class="input" id="cTitle" maxlength="150" value="${esc(existing?.title || "")}" required /></div>
        <div class="field" style="min-width:150px"><label>النوع</label>
          <select id="cKind">
            <option value="txt" ${kind0 === "txt" ? "selected" : ""}>ملف TXT</option>
            <option value="pdf" ${kind0 === "pdf" ? "selected" : ""}>PDF (رابط)</option>
            <option value="video" ${kind0 === "video" ? "selected" : ""}>فيديو (رابط)</option>
          </select>
        </div>
        <div class="field" style="width:100px"><label>الترتيب</label><input class="input" id="cPos" type="number" min="0" value="${existing?.position ?? 0}" /></div>
      </div>

      <div id="txtBox">
        <div class="field">
          <label>رفع ملف .txt (اختياري — يملأ الحقل أدناه)</label>
          <input class="input" id="cFile" type="file" accept=".txt,text/plain" />
        </div>
        <div class="field"><label>نص الملف</label><textarea id="cBody" style="min-height:220px">${esc(existing?.body || "")}</textarea></div>
      </div>

      <div id="urlBox" hidden>
        <div class="field">
          <label>الرابط (تيليجرام أو تخزين خارجي)</label>
          <input class="input ltr" id="cUrl" type="url" placeholder="https://t.me/..." value="${esc(existing?.external_url || "")}" />
          <div class="hint">يجب أن يبدأ بـ https://</div>
        </div>
      </div>

      <button class="btn btn-primary" type="submit" id="cSave">${contentId ? "حفظ التعديلات" : "إضافة"}</button>
    </form>`;

  const sync = () => {
    const isTxt = $("#cKind", m.body).value === "txt";
    $("#txtBox", m.body).hidden = !isTxt;
    $("#urlBox", m.body).hidden = isTxt;
  };
  $("#cKind", m.body).addEventListener("change", sync);
  sync();

  $("#cFile", m.body).addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_TXT_DB_MB * 1024 * 1024) return toast(`الملف كبير (الحد ${MAX_TXT_DB_MB}MB). استخدم «رفع ملفات».`, "bad");
    $("#cBody", m.body).value = await f.text();
    if (!$("#cTitle", m.body).value.trim()) $("#cTitle", m.body).value = baseName(f.name);
  });

  $("#cForm", m.body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = $("#cKind", m.body).value;
    const title = $("#cTitle", m.body).value.trim();
    const body = $("#cBody", m.body).value;
    const url = $("#cUrl", m.body).value.trim();
    const position = parseInt($("#cPos", m.body).value, 10) || 0;

    if (!title) return toast("اكتب عنوان المحتوى", "bad");
    if (kind === "txt" && !body.trim()) return toast("اكتب نص الملف أو ارفع ملف TXT", "bad");
    if (kind !== "txt" && !/^https:\/\//i.test(url)) return toast("اكتب رابطًا صحيحًا يبدأ بـ https://", "bad");

    const row = {
      section_id: sec.id, title, kind, position,
      chapter_no: chapterNo(title),
      body: kind === "txt" ? body : null,
      external_url: kind === "txt" ? null : url,
    };

    const btn = $("#cSave", m.body);
    setBusy(btn, true, "جارٍ الحفظ...");
    const { error } = contentId
      ? await supabase.from("learning_content").update(row).eq("id", contentId)
      : await supabase.from("learning_content").insert(row);
    setBusy(btn, false);

    if (error) return toast("فشل الحفظ", "bad");
    toast("تم الحفظ");
    m.close();
    loadSections();
  });
}

/* ------------------------------ رفع ملفات بالكميات ------------------------------ */
function uploadModal(sec) {
  const m = openModal(`رفع ملفات — ${sec.title}`, { wide: true });
  const isPrivate = sec.grade === "private";
  const autoDefault = !isPrivate;
  const queue = []; // { file, rel, title, kind, n, dup, state, msg }
  let running = false;

  m.body.innerHTML = `
    <div class="drop" id="drop">
      <p style="margin:0 0 10px">اسحب الملفات هنا، أو اختر ما تريد:</p>
      <div class="row" style="justify-content:center">
        <button class="btn btn-sm" type="button" id="pickFiles">📄 اختيار ملفات</button>
        <button class="btn btn-sm" type="button" id="pickFolder">📁 اختيار مجلد</button>
      </div>
      <p class="mini" style="margin:10px 0 0">PDF و TXT و ZIP وغيرها • حتى ${MAX_FILE_MB}MB للملف الواحد (الخطة المجانية). الأكبر من ذلك ارفعه خارجيًا وأضف رابطه من «+ نص / رابط».</p>
      <input type="file" id="fileIn" multiple hidden />
      <input type="file" id="folderIn" webkitdirectory multiple hidden />
    </div>

    <div class="row" style="margin-top:14px">
      <label class="switch" style="${isPrivate ? "opacity:.5" : ""}">
        <input type="checkbox" id="autoName" ${autoDefault ? "checked" : ""} ${isPrivate ? "disabled" : ""} />
        تسمية تلقائية ${isPrivate ? "(غير متاحة في «خاصة»)" : `(${sec.grade === "first" ? "F" : "S"} &lt;رقم&gt; Chapter)`}
      </label>
      <div style="min-width:240px">
        <select id="notifyMode" aria-label="إشعار الطلاب">
          <option value="">بدون إشعار</option>
          <option value="grade">إشعار في البوت لطلاب ${isPrivate ? "هذا الفصل" : "هذا الصف"}</option>
          ${isPrivate ? "" : `<option value="channel">إشعار في القناة (للكل)</option>`}
        </select>
      </div>
    </div>

    <div class="progress" id="prog" hidden><i id="progBar"></i></div>
    <div class="mini" id="progText"></div>
    <div class="queue" id="queue"></div>
    <div id="dupBox"></div>

    <div class="row">
      <button class="btn btn-primary" id="startBtn" type="button" disabled>ابدأ الرفع</button>
      <button class="btn" id="retryBtn" type="button" hidden>🔁 إعادة محاولة الفاشلة</button>
      <button class="btn btn-sm" id="clearBtn" type="button" hidden>مسح القائمة</button>
    </div>`;

  const el = (id) => $(`#${id}`, m.body);
  const existingKeys = () => new Set(activeItems(sec).map(dupKey));

  function buildItem(file) {
    const rel = file.webkitRelativePath || "";
    const folder = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "";
    const kind = kindFromName(file.name);
    const n = chapterNo(baseName(file.name));
    return { file, folder, kind, n, state: "wait", msg: "" };
  }

  // حساب العناوين والتكرار حسب خيار التسمية الحالي
  function recompute() {
    const auto = el("autoName").checked;
    const seen = existingKeys();
    const batch = new Map();
    queue.forEach((it) => {
      it.title = auto ? chapterTitle(sec.grade, it.n, baseName(it.file.name)) : baseName(it.file.name);
      const k = dupKey({ kind: it.kind, title: it.title });
      it.dup = seen.has(k) || batch.has(k);
      batch.set(k, true);
    });
  }

  function stateLabel(it) {
    return {
      wait: `<span class="q-state wait">بالانتظار</span>`,
      run: `<span class="q-state run">جارٍ الرفع…</span>`,
      ok: `<span class="q-state ok">✔ تم</span>`,
      bad: `<span class="q-state bad" title="${esc(it.msg)}">✖ فشل</span>`,
    }[it.state];
  }

  function renderQueue() {
    recompute();
    el("queue").innerHTML = queue.map((it) => `
      <div class="q-row">
        <div class="q-name"><b>${KIND_ICON[it.kind]} ${esc(it.title)}</b>
          ${it.dup ? `<span class="badge badge-warn">اسم مكرر</span>` : ""}
          ${it.n == null && el("autoName").checked && !isPrivate ? `<span class="badge badge-neutral">بلا رقم</span>` : ""}
          <small>${esc(it.folder ? it.folder + "/" : "")}${esc(it.file.name)} • ${fmtSize(it.file.size)}${it.state === "bad" ? " • " + esc(it.msg) : ""}</small></div>
        ${stateLabel(it)}
      </div>`).join("");

    const failed = queue.filter((i) => i.state === "bad").length;
    el("startBtn").disabled = running || !queue.some((i) => i.state === "wait");
    el("retryBtn").hidden = running || !failed;
    el("clearBtn").hidden = running || !queue.length;

    const dups = queue.filter((i) => i.dup);
    el("dupBox").innerHTML = dups.length
      ? `<div class="alert alert-warn">⚠️ يوجد ${dups.length} ملف باسم مكرر (نفس الاسم والنوع). سيتم رفعها عادي، لكن راجعها بعد الرفع.</div>` : "";
  }

  function addFiles(files) {
    [...files].forEach((f) => {
      if (f.name.startsWith(".")) return; // ملفات النظام المخفية
      queue.push(buildItem(f));
    });
    renderQueue();
  }

  el("pickFiles").addEventListener("click", () => el("fileIn").click());
  el("pickFolder").addEventListener("click", () => el("folderIn").click());
  el("fileIn").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  el("folderIn").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  el("autoName").addEventListener("change", renderQueue);
  el("clearBtn").addEventListener("click", () => { queue.length = 0; el("prog").hidden = true; el("progText").textContent = ""; renderQueue(); });

  const drop = el("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

  async function uploadOne(it) {
    const f = it.file;
    it.state = "run"; it.msg = ""; renderQueue();
    const row = {
      section_id: sec.id,
      title: it.title,
      kind: it.kind,
      chapter_no: it.n,
      position: it.n ?? 0,
      folder: it.folder || null,
      original_name: f.name,
      file_size: f.size,
    };
    let path = null;
    try {
      if (it.kind === "txt" && f.size <= MAX_TXT_DB_MB * 1024 * 1024) {
        row.body = await f.text();
      } else {
        if (f.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`أكبر من ${MAX_FILE_MB}MB`);
        const ext = extOf(f.name) || "bin";
        path = `${sec.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, {
          contentType: f.type || "application/octet-stream", upsert: false,
        });
        if (upErr) throw new Error(upErr.message || "فشل رفع الملف");
        row.storage_path = path;
        if (it.kind === "txt") row.kind = "file"; // TXT كبير: يُخزَّن ملفًا ويُنزَّل
      }
      const { error } = await supabase.from("learning_content").insert(row);
      if (error) throw new Error(error.message || "فشل الحفظ");
      it.state = "ok";
    } catch (err) {
      if (path) await supabase.storage.from(BUCKET).remove([path]);
      it.state = "bad";
      it.msg = String(err.message || err);
    }
  }

  async function run() {
    if (running) return;
    const todo = queue.filter((i) => i.state === "wait" || i.state === "bad");
    if (!todo.length) return;
    todo.forEach((i) => { i.state = "wait"; });
    running = true;
    el("prog").hidden = false;
    renderQueue();

    let done = 0;
    const total = todo.length;
    const tick = () => {
      el("progBar").style.width = `${Math.round((done / total) * 100)}%`;
      el("progText").textContent = `تم ${done} من ${total}`;
    };
    tick();

    const pool = 3;
    let idx = 0;
    await Promise.all(Array.from({ length: Math.min(pool, total) }, async () => {
      while (idx < total) {
        const it = todo[idx++];
        await uploadOne(it);
        done++; tick(); renderQueue();
      }
    }));

    running = false;
    renderQueue();

    const ok = todo.filter((i) => i.state === "ok");
    const bad = todo.filter((i) => i.state === "bad");
    toast(bad.length ? `تم رفع ${ok.length} وفشل ${bad.length}` : `تم رفع ${ok.length} ملف ✔`, bad.length ? "bad" : "ok");
    await loadSections();

    // إشعار واحد مجمّع للدفعة
    const mode = el("notifyMode").value;
    if (mode && ok.length) {
      const titles = [...new Set(ok.map((i) => i.title))];
      const { data, error } = await supabase.functions.invoke("notify-content", {
        body: { section_id: sec.id, titles, mode },
      });
      if (error || data?.error) toast("تعذّر إرسال الإشعار (هل نشرت دالة notify-content؟)", "bad");
      else toast(mode === "channel" ? "تم الإشعار في القناة" : `تم إشعار ${data.sent} طالب في البوت`);
    }
  }

  el("startBtn").addEventListener("click", run);
  el("retryBtn").addEventListener("click", run);
  renderQueue();
}

/* ------------------------------ سلة المحذوفات ------------------------------ */
function trashedItems() {
  const out = [];
  sections.forEach((s) => (s.learning_content || []).forEach((c) => { if (c.deleted_at) out.push({ ...c, section: s }); }));
  return out.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
}

function renderTrash() {
  const items = trashedItems();
  $("#emptyTrash").disabled = !items.length;
  $("#trashList").innerHTML = items.length ? items.map((c) => `
    <div class="item" data-tid="${esc(c.id)}">
      <div class="meta">
        <b>${KIND_ICON[c.kind] || "📎"} ${esc(c.title)}</b>
        <small>${esc(c.section.grade === "private" ? "خاصة" : GRADES[c.section.grade] + " — " + c.section.subject)} • ${esc(c.section.title)} • حُذف ${formatDate(c.deleted_at)}</small>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn btn-sm btn-ok" data-tact="restore">استرجاع</button>
        <button class="btn btn-sm btn-danger" data-tact="purge">حذف نهائي</button>
      </div>
    </div>`).join("") : `<div class="empty">السلة فارغة.</div>`;
}

async function purge(items) {
  await removeFiles(items.map((c) => c.storage_path));
  const ids = items.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("learning_content").delete().in("id", ids.slice(i, i + 100));
    if (error) return false;
  }
  return true;
}

$("#trashList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-tact]");
  if (!b) return;
  const id = b.closest("[data-tid]").dataset.tid;
  const c = trashedItems().find((x) => x.id === id);
  if (!c) return;

  if (b.dataset.tact === "restore") {
    const { error } = await supabase.from("learning_content").update({ deleted_at: null }).eq("id", id);
    if (error) return toast("فشل الاسترجاع", "bad");
    toast("تم الاسترجاع");
  } else {
    if (!confirm("حذف هذا الملف نهائيًا؟ لا يمكن التراجع.")) return;
    if (!(await purge([c]))) return toast("فشل الحذف", "bad");
    toast("تم الحذف نهائيًا");
  }
  await loadSections();
  renderTrash();
});

$("#emptyTrash").addEventListener("click", async () => {
  const items = trashedItems();
  if (!items.length || !confirm(`حذف ${items.length} ملف نهائيًا؟ لا يمكن التراجع.`)) return;
  if (!(await purge(items))) return toast("فشل إفراغ السلة", "bad");
  toast("تم إفراغ السلة");
  await loadSections();
  renderTrash();
});

/* ------------------------------ السجل ------------------------------ */
let logRows = [];
const ACTION_LABEL = { view: "فتح", download: "تنزيل", copy: "نسخ" };

async function loadLog() {
  const { data, error } = await supabase
    .from("access_log")
    .select("*, student_profiles(full_name,email)")
    .order("created_at", { ascending: false }).limit(200);
  if (error) { toast("تعذّر تحميل السجل (هل شغّلت migration_2.sql؟)", "bad"); return; }
  logRows = data;
  renderLog();
}

function renderLog() {
  const q = $("#logSearch").value.trim().toLowerCase();
  const rows = logRows.filter((r) => !q ||
    (r.content_title || "").toLowerCase().includes(q) ||
    (r.student_profiles?.full_name || "").toLowerCase().includes(q) ||
    (r.student_profiles?.email || "").toLowerCase().includes(q));
  $("#logBody").innerHTML = rows.length ? rows.map((r) => `
    <tr>
      <td>${new Date(r.created_at).toLocaleString("ar-EG")}</td>
      <td><b>${esc(r.student_profiles?.full_name || "—")}</b><small style="direction:ltr;text-align:start">${esc(r.student_profiles?.email || "")}</small></td>
      <td><span class="badge badge-neutral">${ACTION_LABEL[r.action] || esc(r.action)}</span></td>
      <td>${esc(r.content_title || "—")}</td>
    </tr>`).join("") : `<tr><td colspan="4"><div class="empty" style="border:none">لا توجد عمليات.</div></td></tr>`;
}
$("#logSearch").addEventListener("input", debounce(renderLog, 200));
$("#reloadLog").addEventListener("click", loadLog);

/* ------------------------------ تشغيل ------------------------------ */
(async () => {
  let ctx;
  try { ctx = await requireUser({ admin: true }); } catch { return; }

  const who = $("#whoami");
  who.textContent = ctx.user.email;
  who.hidden = false;

  $("#loading").hidden = true;
  $("#app").hidden = false;
  observeDynamic($("#sectionsList"));
  await loadStudents();
})();
