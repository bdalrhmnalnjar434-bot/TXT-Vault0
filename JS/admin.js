import { supabase, GRADES, SUBJECTS } from "../supabase.js";
import { requireUser, bindLogout, STATUS_LABEL } from "./auth.js";
import { $, $$, esc, toast, setBusy, openModal, debounce, formatDate } from "./ui.js";
import { initReveal, observeDynamic } from "./animations.js";
import { chapterPicker, audienceModal, applyAudience, wantsAutoGrant, approveModal, accessToolsModal } from "./access-tools.js";
import {
  GRADES_ALL, BUCKET, MAX_FILE_MB, MAX_TXT_DB_MB, KIND_LABEL, KIND_ICON,
  fmtSize, extOf, baseName, kindFromName, chapterNo, chapterTitle, sortContent, dupKey,
} from "./common.js";

bindLogout();

/* كل عمليات الكتابة هنا تمر عبر RLS / دوال RPC التي تتحقق من is_admin() في قاعدة البيانات،
   فلو فتح طالب هذه الصفحة بأي طريقة لن ينجح أي إجراء. */

let students = [];
let selfId = null; // حساب المشرف الحالي: لا يظهر في قائمة الطلاب
let isOwner = false; // المالك فقط يمسح السجلات والسلة (والحماية الفعلية في قاعدة البيانات)
let adminIds = new Set(); // كل المشرفين: لا يظهرون في قائمة الطلاب
let sections = [];
let gradeVisible = { first: true, second: true, private: true };
const CONTENT_COLS = "id,title,kind,external_url,storage_path,file_size,original_name,chapter_no,folder,position,created_at,deleted_at";

/* ------------------------------ تبويبات ------------------------------ */
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  ["students", "content", "messages", "passwords", "trash", "log", "admins"].forEach((n) => { $(`#tab-${n}`).hidden = t.dataset.tab !== n; });
  if (t.dataset.tab === "admins") loadAdmins();
  if (t.dataset.tab === "passwords") loadPwRequests();
  if (t.dataset.tab === "messages") { renderPicker(); loadBroadcasts(); }
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
  students = data.filter((s) => s.id !== selfId && !adminIds.has(s.id));
  renderStats();
  renderStudents();
}

function renderStats() {
  const c = (s) => students.filter((x) => x.status === s).length;
  const items = [
    ["إجمالي الحسابات", students.length],
    ["بانتظار الموافقة", c("pending")],
    ["مفعّلون", c("approved")],
    ["موقوف / مرفوض / محظور", c("suspended") + c("rejected") + c("blocked")],
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
  // المحظور: زر واحد فقط لرفع الحظر أو الحذف النهائي
  if (s.status === "blocked") return `<div class="actions">${b("manage", "🚫 محظور — إدارة", "btn-danger")}</div>`;
  if (s.status === "pending") out.push(b("approved", "قبول", "btn-ok"), b("rejected", "رفض", "btn-danger"));
  if (s.status === "approved") out.push(b("suspended", "إيقاف", "btn-danger"));
  if (s.status === "suspended" || s.status === "rejected") out.push(b("approved", "تفعيل", "btn-ok"));
  out.push(b("access", "الفصول"));
  out.push(b("edit", "تعديل"));
  out.push(b("manage", "🚫 حظر / حذف", "btn-danger"));
  return `<div class="actions">${out.join("")}</div>`;
}

function renderStudents() {
  const q = $("#search").value.trim().toLowerCase();
  const st = $("#statusFilter").value;
  const gr = $("#gradeFilter").value;

  // المحظورون يختفون من القائمة العادية ويظهرون فقط عند اختيار فلتر «محظور»
  const list = students.filter((s) =>
    (st ? s.status === st : s.status !== "blocked") && (!gr || s.grade === gr) &&
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
  if (status === "approved") {
    const st = students.find((x) => x.id === id);
    if (st) return approveModal(st, loadStudents);
  }
  const labels = { approved: "قبول/تفعيل", rejected: "رفض", suspended: "إيقاف" };
  if (status !== "approved" && !confirm(`تأكيد ${labels[status]} هذا الحساب؟`)) return;
  setBusy(btn, true, "...");
  const { error } = await supabase.rpc("admin_set_student_status", { p_user: id, p_status: status });
  setBusy(btn, false);
  if (error) return toast("فشل تنفيذ الإجراء", "bad");
  toast("تم التحديث");
  loadStudents();
}

// تنفيذ إجراء على القناة (ban / unban / kick) عبر دالة moderate-user. تُرجع: done | no_telegram | failed
async function channelAction(userId, action) {
  try {
    const { data, error } = await supabase.functions.invoke("moderate-user", { body: { user_id: userId, action } });
    if (error || data?.error) return "failed";
    return data?.channel || "done";
  } catch { return "failed"; }
}

// نافذة «حظر / حذف»: حظر كامل (يمكن التراجع) أو حذف نهائي (لا رجعة فيه)
function manageStudent(id) {
  const s = students.find((x) => x.id === id);
  if (!s) return;
  const blocked = s.status === "blocked";
  const m = openModal("إدارة الحساب");
  m.body.innerHTML = `
    <p style="margin:0 0 14px"><b>${esc(s.full_name || "—")}</b><br><small class="ltr" style="direction:ltr;display:block;text-align:start;color:var(--muted)">${esc(s.email || "")}</small></p>
    <div class="folder-head" style="direction:rtl">📱💻 الأجهزة (موبايل واحد + كمبيوتر واحد)</div>
    <div class="list" id="devBox" style="margin-bottom:16px"><div class="skeleton"></div></div>
    <div class="list">
      <div class="item">
        <div class="meta">
          <b>${blocked ? "✅ رفع الحظر" : "🚫 حظر كامل"}</b>
          <small>${blocked
            ? "يرجع الحساب «بانتظار الموافقة» وتقدر تقبله من جديد."
            : "يمنع الدخول للمنصة، ويطرده من القناة ويمنعه من الرجوع، ويختفي من القائمة (يظهر في فلتر «محظور»). البريد يفضل مسجّلًا. تقدر ترفع الحظر لاحقًا."}</small>
        </div>
        <button class="btn btn-sm ${blocked ? "btn-ok" : "btn-danger"}" id="mBlock" type="button">${blocked ? "رفع الحظر" : "حظر"}</button>
      </div>
      <div class="item">
        <div class="meta">
          <b>🗑️ حذف نهائي</b>
          <small>يمسح الحساب وكل بياناته من المنصة تمامًا (الصلاحيات وربط تيليجرام وسجل الفتح) ولا يمكن التراجع. لو سجّل بنفس البريد بعدها يكون حسابًا جديدًا.</small>
        </div>
        <button class="btn btn-sm btn-danger" id="mDelete" type="button">حذف نهائي</button>
      </div>
    </div>
    <div id="delBox" hidden style="margin-top:14px">
      <div class="field">
        <label for="delConfirm">للتأكيد اكتب كلمة «حذف» ثم اضغط التأكيد</label>
        <input class="input" id="delConfirm" autocomplete="off" placeholder="حذف" />
      </div>
      <button class="btn btn-danger" id="delGo" type="button" disabled>تأكيد الحذف النهائي</button>
    </div>`;

  // الأجهزة المسجّلة + إعادة الضبط
  async function loadDevices() {
    const { data, error } = await supabase.from("student_devices").select("*").eq("user_id", id);
    const box = $("#devBox", m.body);
    if (error) { box.innerHTML = `<div class="empty" style="padding:12px">تعذّر تحميل الأجهزة (هل شغّلت sql/migration_6.sql؟)</div>`; return; }
    const by = Object.fromEntries((data || []).map((d) => [d.kind, d]));
    const row = (kind, title) => {
      const d = by[kind];
      return `
        <div class="item">
          <div class="meta"><b>${title}</b>
            <small>${d ? `${esc(d.label || "جهاز")} • آخر دخول ${formatDate(d.last_seen)}` : "غير مسجّل بعد"}</small></div>
          ${d ? `<button class="btn btn-sm" type="button" data-reset="${kind}">إعادة ضبط</button>` : ""}
        </div>`;
    };
    box.innerHTML = row("mobile", "📱 الموبايل") + row("desktop", "💻 الكمبيوتر");
  }
  $("#devBox", m.body).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-reset]");
    if (!b) return;
    if (!confirm("إعادة ضبط هذا الجهاز؟ أول جهاز من نفس النوع يدخل بعدها يتسجّل مكانه.")) return;
    setBusy(b, true, "...");
    const { error } = await supabase.rpc("admin_reset_devices", { p_user: id, p_kind: b.dataset.reset });
    if (error) { setBusy(b, false); return toast("تعذّرت إعادة الضبط", "bad"); }
    toast("تمت إعادة ضبط الجهاز");
    loadDevices();
  });
  loadDevices();

  $("#mBlock", m.body).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const next = blocked ? "pending" : "blocked";
    if (!blocked && !confirm("تأكيد حظر هذا الحساب؟")) return;
    setBusy(btn, true, "...");
    const { error } = await supabase.rpc("admin_set_student_status", { p_user: id, p_status: next });
    if (error) { setBusy(btn, false); return toast("فشل التنفيذ — هل شغّلت sql/migration_3.sql؟", "bad"); }
    // الحظر يمتد للقناة: حظر/فك حظر من القناة الخاصة عبر البوت
    const ch = await channelAction(id, blocked ? "unban" : "ban");
    setBusy(btn, false);
    if (ch === "failed") {
      toast(`تم ${blocked ? "رفع الحظر" : "الحظر"} في المنصة، لكن تعذّر تنفيذه في القناة (هل نشرت دالة moderate-user والبوت أدمن بصلاحية الحظر؟)`, "bad");
    } else {
      toast(blocked ? "تم رفع الحظر" : "تم حظر الحساب من المنصة والقناة");
    }
    m.close();
    loadStudents();
  });

  $("#mDelete", m.body).addEventListener("click", () => {
    $("#delBox", m.body).hidden = false;
    $("#delConfirm", m.body).focus();
  });
  $("#delConfirm", m.body).addEventListener("input", (e) => {
    $("#delGo", m.body).disabled = e.target.value.trim() !== "حذف";
  });
  $("#delGo", m.body).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, "جارٍ الحذف...");
    await channelAction(id, "kick"); // نطرده من القناة قبل مسح ربط تيليجرام (لو فشل نكمل الحذف)
    const { error } = await supabase.rpc("admin_delete_student", { p_user: id });
    setBusy(btn, false);
    if (error) return toast("فشل الحذف — هل شغّلت sql/migration_3.sql؟", "bad");
    toast("تم حذف الحساب نهائيًا");
    m.close();
    loadStudents();
  });
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
  const m = openModal(`فصول الطالب: ${s.full_name || s.email}`, { wide: true });
  m.body.innerHTML = `<div class="skeleton"></div>`;

  const [{ data: secs }, { data: acc }] = await Promise.all([
    supabase.from("learning_sections").select("*").in("grade", [s.grade, "private"]).order("grade").order("subject").order("position"),
    supabase.from("student_section_access").select("section_id").eq("student_id", id),
  ]);
  const allowed = new Set((acc || []).map((a) => a.section_id));

  if (!secs?.length) { m.body.innerHTML = `<div class="empty">لا توجد فصول لصف «${GRADES[s.grade]}» أو في «خاصة».</div>`; return; }

  m.body.innerHTML = `
    <p class="hint" style="margin-bottom:12px">الصف الحالي: ${GRADES[s.grade]} — اختر المادة ثم حدّد الفصول المسموح بها لهذا الطالب (كل تغيير يُحفظ فورًا).</p>
    <div id="accHost"></div>`;

  chapterPicker($("#accHost", m.body), secs, allowed, async (ids, checked) => {
    const q = supabase.from("student_section_access");
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const { error } = checked
        ? await q.upsert(part.map((sid) => ({ student_id: id, section_id: sid })), { onConflict: "student_id,section_id", ignoreDuplicates: true })
        : await q.delete().eq("student_id", id).in("section_id", part);
      if (error) throw error;
    }
    toast("تم التحديث");
  });
}

$("#studentsBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case "access": return editAccess(id);
    case "edit": return editStudent(id);
    case "manage": return manageStudent(id);
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
// مادة «الثقافة المالية» تخص ثانية بكالوريا فقط (لا تحتاج تعديلًا في supabase.js)
const FIN_SUBJECT = "الثقافة المالية";
const ALL_SUBJECTS = [...new Set([...SUBJECTS, FIN_SUBJECT])];
// أولى بكالوريا: JavaScript فقط • ثانية بكالوريا: JavaScript + Python + الثقافة المالية
const SECOND_ONLY = ["Python", FIN_SUBJECT];
const subjectsForGrade = (grade) =>
  grade === "first" ? ALL_SUBJECTS.filter((s) => !SECOND_ONLY.includes(s)) : [...ALL_SUBJECTS];

ALL_SUBJECTS.forEach((s) => {
  $("#cSubject").insertAdjacentHTML("beforeend", `<option value="${s}">${s}</option>`);
});
$("#cSubject").insertAdjacentHTML("beforeend", `<option value="خاصة">خاصة</option>`);

// قائمة المواد في نموذج إضافة فصل تتغير حسب الصف
function fillSecSubjects() {
  const grade = $("#secGrade").value;
  const list = subjectsForGrade(grade);
  const sel = $("#secSubject");
  const keep = sel.value;
  sel.innerHTML = list.map((s) => `<option value="${s}">${s}</option>`).join("");
  if (list.includes(keep)) sel.value = keep;
}
fillSecSubjects();

$("#secGrade").addEventListener("change", () => {
  $("#secSubjectBox").hidden = $("#secGrade").value === "private";
  fillSecSubjects();
});

async function loadSections() {
  let { data, error } = await supabase
    .from("learning_sections")
    .select(`*, learning_content(${CONTENT_COLS}), section_shares(grade)`)
    .order("grade").order("subject").order("position").order("created_at");
  if (error) {
    // لو لم تُشغَّل migration_11 بعد: نحمّل بدون المشاركات
    ({ data, error } = await supabase
      .from("learning_sections")
      .select(`*, learning_content(${CONTENT_COLS})`)
      .order("grade").order("subject").order("position").order("created_at"));
  }
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

/* ---- مربعات المواد ---- */
const TILE_ICON = { JavaScript: "JS", Python: "🐍", [FIN_SUBJECT]: "💰", "خاصة": "🔒" };

// المواد المتاحة حسب الصف المختار
function tileSubjects() {
  const g = $("#cGrade").value;
  if (g === "private") return ["خاصة"];
  const subs = subjectsForGrade(g);
  return g === "" ? [...subs, "خاصة"] : subs;
}

// نمرّر المادة والصف المختارين لنموذج «إضافة فصل جديد» ليضيف داخل المربع المفتوح
function syncAddForm() {
  const g = $("#cGrade").value;
  const sub = $("#cSubject").value;
  if (sub === "خاصة" || g === "private") $("#secGrade").value = "private";
  else if (g === "first" || g === "second") $("#secGrade").value = g;
  $("#secSubjectBox").hidden = $("#secGrade").value === "private";
  fillSecSubjects();
  if (sub && sub !== "خاصة") {
    const opt = [...$("#secSubject").options].some((o) => o.value === sub);
    if (opt) $("#secSubject").value = sub;
  }
}

function renderTiles() {
  const g = $("#cGrade").value;
  const subs = tileSubjects();
  // لو المادة الحالية غير متاحة في هذا الصف نختار أول مربع تلقائيًا
  if (!subs.includes($("#cSubject").value)) $("#cSubject").value = subs[0] || "";
  const cur = $("#cSubject").value;

  const count = (sub) => sections.filter((s) =>
    (sub === "خاصة" ? s.grade === "private" : s.subject === sub && s.grade !== "private" && (!g || s.grade === g))).length;

  $("#subjectTiles").innerHTML = subs.map((sub) => `
    <button type="button" class="stile ${sub === cur ? "active" : ""}" data-sub="${esc(sub)}" role="tab" aria-selected="${sub === cur}">
      <span class="ico">${TILE_ICON[sub] || "📘"}</span>
      <b${/[؀-ۿ]/.test(sub) ? "" : ' style="direction:ltr"'}>${esc(sub)}</b>
      <small>${count(sub)} فصول</small>
    </button>`).join("");
  syncAddForm();

  // أدوات الفصول (رفع مرقّم + حذف من–إلى) لمواد أولى/ثانية فقط، وليس «خاصة»
  const priv = cur === "خاصة" || g === "private";
  const tools = ((g === "first" || g === "second") && cur && cur !== "خاصة") || priv;
  $("#chapterTools").hidden = !tools;
  $("#ctUpload").hidden = priv;
  $("#ctDelete").hidden = priv;
  $("#ctShare").hidden = priv;
  if (tools) $("#ctTitle").textContent = priv ? "🔒 خاصة" : `${GRADES[g]} — ${cur}`;
}

$("#subjectTiles").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sub]");
  if (!b) return;
  $("#cSubject").value = b.dataset.sub;
  renderSections();
});

function renderSections() {
  renderTiles();
  const g = $("#cGrade").value;
  const sub = $("#cSubject").value;
  const q = $("#cSearch").value.trim().toLowerCase();

  const list = sections.filter((s) => {
    if (g && s.grade !== g) return false;
    // عند البحث نبحث في كل المواد، وبدونه نعرض المربع المختار فقط
    if (sub && !q && !(sub === "خاصة" ? s.grade === "private" : s.subject === sub && s.grade !== "private")) return false;
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
            ${(s.section_shares || []).map((x) => `<span class="badge badge-approved">🔗 مشترك مع ${esc(GRADES[x.grade] || x.grade)}</span>`).join("")}
            ${s.is_locked ? `<span class="badge badge-pending">🔒 مقفول</span>` : ""}
            ${s.content_deleted ? `<span class="badge badge-rejected">محذوف المحتوى</span>` : ""}
            <span class="badge badge-neutral">${activeItems(s).length} ملف</span>
          </div>
        </div>
        <div class="actions row" style="gap:6px">
          <button class="btn btn-sm btn-primary" data-sact="upload">⬆ رفع ملفات</button>
          <button class="btn btn-sm" data-sact="addc">+ نص / رابط</button>
          ${s.grade !== "private" ? `<button class="btn btn-sm" data-sact="autoname" title="إعادة تسمية كل الملفات حسب رقم الفصل">ترقيم تلقائي</button>` : ""}
          ${s.grade === "private" ? `<button class="btn btn-sm btn-danger" data-sact="bulkdel" title="حذف ملفات من رقم إلى رقم أو حذف الكل">🗑 حذف ملفات</button>` : ""}
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
  const aud = await audienceModal(students, { isPrivate: grade === "private" });
  if (!aud) return;
  const { data: row, error } = await supabase.from("learning_sections").insert({
    grade,
    subject: grade === "private" ? "خاصة" : $("#secSubject").value,
    title,
    position: chapterNo(title) ?? 0, // الترتيب من الرقم الموجود في العنوان تلقائيًا
    auto_grant: wantsAutoGrant(grade, aud),
  }).select("id").single();
  if (error) return toast("فشل إضافة الفصل (هل شغّلت migration_10.sql؟)", "bad");
  await applyAudience([row.id], grade, aud);
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
  if (!confirm(`إعادة تسمية ${items.length} ملف في «${sec.title}» بصيغة Chapter <الرقم> ${sec.grade === "first" ? "F" : "S"}؟`)) return;

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
  if (sact === "bulkdel") return bulkDeleteModal(sec);
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
        if (sec.grade === "private") {
          const t = prompt("اسم الملف:", c.title);
          if (t && t.trim() && t.trim() !== c.title) {
            const { error } = await supabase.from("learning_content").update({ title: t.trim() }).eq("id", cid);
            error ? toast("فشل التعديل", "bad") : (toast("تم التعديل"), loadSections());
          }
          return;
        }
        // الأقسام الثلاثة: الاسم ثابت حسب الرقم فقط
        const cur = c.chapter_no ?? chapterNo(c.title) ?? "";
        const t = prompt("رقم الفصل:", String(cur));
        const n = parseInt(t, 10);
        if (t && n > 0 && n !== cur) {
          const { error } = await supabase.from("learning_content")
            .update({ title: chapterTitle(sec.grade, n), chapter_no: n, position: n }).eq("id", cid);
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
  const fixed = sec.grade !== "private"; // أولى/ثانية: الاسم ثابت حسب الرقم فقط
  m.body.innerHTML = `
    <form id="cForm" novalidate>
      <div class="row">
        ${fixed
          ? `<div class="field" style="width:170px"><label>رقم الفصل</label>
               <input class="input" id="cNum" type="number" min="1" step="1" value="${existing?.chapter_no ?? chapterNo(existing?.title || "") ?? ""}" required />
               <div class="hint">الاسم ثابت: Chapter رقم ${sec.grade === "first" ? "F" : "S"}</div></div>`
          : `<div class="field grow"><label>العنوان</label><input class="input" id="cTitle" maxlength="150" value="${esc(existing?.title || "")}" required /></div>`}
        <div class="field" style="min-width:150px"><label>النوع</label>
          <select id="cKind">
            <option value="txt" ${kind0 === "txt" ? "selected" : ""}>ملف TXT</option>
            <option value="pdf" ${kind0 === "pdf" ? "selected" : ""}>PDF (رابط)</option>
            <option value="video" ${kind0 === "video" ? "selected" : ""}>فيديو (رابط)</option>
          </select>
        </div>
        ${fixed ? "" : `<div class="field" style="width:100px"><label>الترتيب</label><input class="input" id="cPos" type="number" min="0" value="${existing?.position ?? 0}" /></div>`}
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
    if (fixed) {
      const num = $("#cNum", m.body);
      const n = chapterNo(baseName(f.name));
      if (!num.value && n != null) num.value = n;
    } else if (!$("#cTitle", m.body).value.trim()) {
      $("#cTitle", m.body).value = baseName(f.name);
    }
  });

  $("#cForm", m.body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = $("#cKind", m.body).value;
    const body = $("#cBody", m.body).value;
    const url = $("#cUrl", m.body).value.trim();
    let title, position, chNo;
    if (fixed) {
      const n = parseInt($("#cNum", m.body).value, 10);
      if (!(n > 0)) return toast("اكتب رقم الفصل (1 أو أكبر)", "bad");
      title = chapterTitle(sec.grade, n);
      position = n; chNo = n;
    } else {
      title = $("#cTitle", m.body).value.trim();
      position = parseInt($("#cPos", m.body).value, 10) || 0;
      chNo = chapterNo(title);
    }

    if (!title) return toast("اكتب عنوان المحتوى", "bad");
    if (kind === "txt" && !body.trim()) return toast("اكتب نص الملف أو ارفع ملف TXT", "bad");
    if (kind !== "txt" && !/^https:\/\//i.test(url)) return toast("اكتب رابطًا صحيحًا يبدأ بـ https://", "bad");

    const row = {
      section_id: sec.id, title, kind, position,
      chapter_no: chNo,
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

/* ------------------------------ رفع فصول: كل ملف = فصل مرقّم ------------------------------ */
const currentGS = () => ({ grade: $("#cGrade").value, subject: $("#cSubject").value });

$("#ctUpload").addEventListener("click", () => {
  const { grade, subject } = currentGS();
  if ((grade === "first" || grade === "second") && subject) chapterUploadModal(grade, subject);
});
$("#ctDelete").addEventListener("click", () => {
  const { grade, subject } = currentGS();
  if ((grade === "first" || grade === "second") && subject) chapterDeleteModal(grade, subject);
});

// مشاركة فصول المادة المختارة مع الصف الآخر (أو إلغاء المشاركة): من رقم إلى رقم أو الكل
$("#ctShare").addEventListener("click", () => {
  const { grade, subject } = currentGS();
  if (!((grade === "first" || grade === "second") && subject)) return;
  const list = chaptersOf(grade, subject);
  if (!list.length) return toast("لا توجد فصول في هذه المادة", "bad");
  const other = grade === "first" ? "second" : "first";
  const nums = list.map((s) => chapterNo(s.title)).filter((n) => n != null);
  const lo = nums.length ? Math.min(...nums) : 1, hi = nums.length ? Math.max(...nums) : 1;

  const m = openModal(`مشاركة فصول — ${GRADES[grade]} — ${subject}`);
  m.body.innerHTML = `
    <p class="hint" style="margin:0 0 12px">المحتوى بيفضل ملف واحد بدون تكرار، ويظهر عند <b>${GRADES[other]}</b> داخل مربع «${esc(subject)}» بنفس الرقم.</p>
    <div class="field"><label>الإجراء</label>
      <select id="shAct"><option value="add">مشاركة مع ${GRADES[other]}</option><option value="remove">إلغاء المشاركة مع ${GRADES[other]}</option></select></div>
    <div class="row">
      <div class="field" style="width:130px"><label for="shFrom">من فصل</label><input class="input" id="shFrom" type="number" min="1" value="${lo}" /></div>
      <div class="field" style="width:130px"><label for="shTo">إلى فصل</label><input class="input" id="shTo" type="number" min="1" value="${hi}" /></div>
    </div>
    <div class="mini" id="shInfo" style="margin-bottom:12px"></div>
    <div class="row"><button class="btn btn-primary" id="shGo" type="button">تنفيذ على النطاق</button>
      <button class="btn" id="shAll" type="button">تنفيذ على كل الفصول (${list.length})</button></div>`;
  const pick = (all) => {
    if (all) return list;
    const a = parseInt($("#shFrom", m.body).value, 10), b = parseInt($("#shTo", m.body).value, 10);
    if (!(a > 0) || !(b > 0)) return [];
    const [x, y] = a <= b ? [a, b] : [b, a];
    return list.filter((s) => { const n = chapterNo(s.title); return n != null && n >= x && n <= y; });
  };
  const info = () => { $("#shInfo", m.body).textContent = `سيُطبَّق على ${pick(false).length} فصل.`; };
  ["#shFrom", "#shTo"].forEach((q) => $(q, m.body).addEventListener("input", info));
  info();
  async function run(all, btn) {
    const target = pick(all);
    if (!target.length) return toast("لا توجد فصول في هذا النطاق", "bad");
    setBusy(btn, true, "...");
    const remove = $("#shAct", m.body).value === "remove";
    let done = 0, failed = false;
    const ids = target.map((s) => s.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.rpc("admin_share_sections", { p_sections: ids.slice(i, i + 100), p_grade: other, p_remove: remove });
      if (error) { failed = true; break; }
      done += data || 0;
    }
    setBusy(btn, false);
    if (failed) return toast("فشلت المشاركة (هل شغّلت sql/migration_11.sql؟)", "bad");
    toast(remove ? `تم إلغاء مشاركة ${done} فصل` : `تمت مشاركة ${done} فصل مع ${GRADES[other]}`);
    m.close();
    loadSections();
  }
  $("#shGo", m.body).addEventListener("click", (e) => run(false, e.currentTarget));
  $("#shAll", m.body).addEventListener("click", (e) => run(true, e.currentTarget));
});

$("#ctAccess").addEventListener("click", () => {
  const { grade, subject } = currentGS();
  const priv = subject === "خاصة" || grade === "private";
  const chapters = priv ? sections.filter((s) => s.grade === "private") : chaptersOf(grade, subject);
  accessToolsModal({
    title: priv ? "صلاحيات وقفل — خاصة" : `صلاحيات وقفل — ${GRADES[grade]} — ${subject}`,
    chapters, students, onDone: loadSections,
  });
});

// فصول المادة المختارة
const chaptersOf = (grade, subject) => sections.filter((s) => s.grade === grade && s.subject === subject);

function chapterUploadModal(grade, subject) {
  const m = openModal(`رفع فصول — ${GRADES[grade]} — ${subject}`, { wide: true });
  const queue = []; // { file, kind, n, title, state, msg }
  const secIds = new Map(); // رقم الفصل -> id
  const newIds = []; // الفصول التي أُنشئت في هذه العملية
  let aud = null; // الجمهور المختار للفصول الجديدة
  let running = false;
  const letter = grade === "first" ? "F" : "S";

  m.body.innerHTML = `
    <div class="drop" id="drop">
      <p style="margin:0 0 10px">اسحب ملفاتك هنا (مثلًا 1.txt إلى 20.txt)، أو اختر ما تريد:</p>
      <div class="row" style="justify-content:center">
        <button class="btn btn-sm" type="button" id="pickFiles">📄 اختيار ملفات</button>
        <button class="btn btn-sm" type="button" id="pickFolder">📁 اختيار مجلد</button>
      </div>
      <p class="mini" style="margin:10px 0 0">كل ملف يصير فصلًا باسم ثابت: <b dir="ltr">Chapter &lt;رقم&gt; ${letter}</b> ويُؤخذ الرقم من اسم الملف. لو الفصل موجود يُضاف الملف إليه. الملف بلا رقم لا يُرفع. حتى ${MAX_FILE_MB}MB للملف.</p>
      <input type="file" id="fileIn" multiple hidden />
      <input type="file" id="folderIn" webkitdirectory multiple hidden />
    </div>
    <div class="progress" id="prog" hidden><i id="progBar"></i></div>
    <div class="mini" id="progText"></div>
    <div class="queue" id="queue"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn btn-primary" id="startBtn" type="button" disabled>ابدأ الرفع</button>
      <button class="btn" id="retryBtn" type="button" hidden>🔁 إعادة محاولة الفاشلة</button>
      <button class="btn btn-sm" id="clearBtn" type="button" hidden>مسح القائمة</button>
    </div>`;
  const el = (id) => $(`#${id}`, m.body);
  const existingNos = () => new Set(chaptersOf(grade, subject).map((s) => chapterNo(s.title)).filter((n) => n != null));

  function renderQueue() {
    const have = existingNos();
    queue.sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity));
    el("queue").innerHTML = queue.map((it) => `
      <div class="q-row">
        <div class="q-name"><b>${KIND_ICON[it.kind]} ${esc(it.title)}</b>
          ${it.n == null ? `<span class="badge badge-warn">بلا رقم — لن يُرفع</span>` : have.has(it.n) ? `<span class="badge badge-neutral">فصل موجود: يُضاف إليه</span>` : ""}
          <small>${esc(it.file.name)} • ${fmtSize(it.file.size)}${it.state === "bad" ? " • " + esc(it.msg) : ""}</small></div>
        ${{ wait: `<span class="q-state wait">بالانتظار</span>`, run: `<span class="q-state run">جارٍ الرفع…</span>`,
            ok: `<span class="q-state ok">✔ تم</span>`, bad: `<span class="q-state bad">✖ فشل</span>` }[it.state]}
      </div>`).join("");
    el("startBtn").disabled = running || !queue.some((i) => i.state === "wait" && i.n != null);
    el("retryBtn").hidden = running || !queue.some((i) => i.state === "bad" && i.n != null);
    el("clearBtn").hidden = running || !queue.length;
  }

  function addFiles(files) {
    [...files].forEach((f) => {
      if (f.name.startsWith(".")) return;
      const n = chapterNo(baseName(f.name));
      queue.push({
        file: f, kind: kindFromName(f.name), n,
        title: n == null ? baseName(f.name) : chapterTitle(grade, n),
        state: n == null ? "bad" : "wait", msg: n == null ? "اسم الملف لازم يحتوي رقم" : "",
      });
    });
    renderQueue();
  }

  el("pickFiles").addEventListener("click", () => el("fileIn").click());
  el("pickFolder").addEventListener("click", () => el("folderIn").click());
  el("fileIn").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  el("folderIn").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  el("clearBtn").addEventListener("click", () => { queue.length = 0; el("prog").hidden = true; el("progText").textContent = ""; renderQueue(); });
  const drop = el("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

  // ينشئ الفصل لو غير موجود (بالتتابع لتفادي تكرار الفصل نفسه)
  async function ensureChapter(n) {
    if (secIds.has(n)) return secIds.get(n);
    const ex = chaptersOf(grade, subject).find((s) => chapterNo(s.title) === n);
    if (ex) {
      secIds.set(n, ex.id);
      // رفع محتوى جديد لفصل كان «محذوف المحتوى» يرجّعه طبيعيًا
      if (ex.content_deleted) await supabase.from("learning_sections").update({ content_deleted: false }).eq("id", ex.id);
      return ex.id;
    }
    const { data, error } = await supabase.from("learning_sections")
      .insert({ grade, subject, title: chapterTitle(grade, n), position: n, auto_grant: wantsAutoGrant(grade, aud) }).select("id").single();
    if (error) throw new Error(error.message || "فشل إنشاء الفصل");
    secIds.set(n, data.id);
    newIds.push(data.id);
    return data.id;
  }

  async function uploadOne(it) {
    const f = it.file;
    it.state = "run"; it.msg = ""; renderQueue();
    let path = null;
    try {
      const secId = secIds.get(it.n);
      if (!secId) throw new Error("تعذّر إنشاء الفصل");
      const row = {
        section_id: secId, title: it.title, kind: it.kind, chapter_no: it.n, position: it.n,
        original_name: f.name, file_size: f.size,
      };
      if (it.kind === "txt" && f.size <= MAX_TXT_DB_MB * 1024 * 1024) {
        row.body = await f.text();
      } else {
        if (f.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`أكبر من ${MAX_FILE_MB}MB`);
        path = `${secId}/${crypto.randomUUID()}.${extOf(f.name) || "bin"}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, {
          contentType: f.type || "application/octet-stream", upsert: false,
        });
        if (upErr) throw new Error(upErr.message || "فشل رفع الملف");
        row.storage_path = path;
        if (it.kind === "txt") row.kind = "file";
      }
      const { error } = await supabase.from("learning_content").insert(row);
      if (error) throw new Error(error.message || "فشل الحفظ");
      it.state = "ok";
    } catch (err) {
      if (path) await supabase.storage.from(BUCKET).remove([path]);
      it.state = "bad"; it.msg = String(err.message || err);
    }
  }

  async function run() {
    if (running) return;
    const todo = queue.filter((i) => (i.state === "wait" || i.state === "bad") && i.n != null);
    if (!todo.length) return;
    todo.forEach((i) => { i.state = "wait"; i.msg = ""; });
    // لو فيه فصول جديدة: نسأل لمين تتضاف (مرة واحدة لكل عملية رفع)
    const have0 = existingNos();
    if (todo.some((i) => !have0.has(i.n))) {
      aud = await audienceModal(students, { isPrivate: grade === "private" });
      if (!aud) return;
    } else {
      aud = { mode: "none" };
    }
    newIds.length = 0;
    running = true;
    el("prog").hidden = false;
    renderQueue();

    // 1) إنشاء الفصول الناقصة أولًا بالتتابع
    for (const n of [...new Set(todo.map((i) => i.n))].sort((a, b) => a - b)) {
      try { await ensureChapter(n); } catch (err) {
        todo.filter((i) => i.n === n).forEach((i) => { i.state = "bad"; i.msg = String(err.message || err); });
      }
    }

    if (newIds.length) await applyAudience(newIds, grade, aud);

    // 2) رفع الملفات 3 في نفس الوقت
    const work = todo.filter((i) => i.state === "wait");
    let done = 0, idx = 0;
    const tick = () => {
      el("progBar").style.width = `${Math.round((done / Math.max(work.length, 1)) * 100)}%`;
      el("progText").textContent = `تم ${done} من ${work.length}`;
    };
    tick();
    await Promise.all(Array.from({ length: Math.min(3, work.length) }, async () => {
      while (idx < work.length) {
        const it = work[idx++];
        await uploadOne(it);
        done++; tick(); renderQueue();
      }
    }));

    running = false;
    renderQueue();
    const ok = todo.filter((i) => i.state === "ok").length;
    const bad = todo.filter((i) => i.state === "bad").length;
    toast(bad ? `تم رفع ${ok} وفشل ${bad}` : `تم رفع ${ok} فصل ✔`, bad ? "bad" : "ok");
    await loadSections();
  }

  el("startBtn").addEventListener("click", run);
  el("retryBtn").addEventListener("click", run);
  renderQueue();
}

/* ------------------------------ حذف فصول: من رقم إلى رقم أو الكل ------------------------------ */
// يحذف الفصل بملفاته نهائيًا (بما فيها ملفات التخزين)
function chapterDeleteModal(grade, subject) {
  const list = chaptersOf(grade, subject);
  if (!list.length) return toast("لا توجد فصول في هذه المادة", "bad");
  const nums = list.map((s) => chapterNo(s.title)).filter((n) => n != null);
  const lo = nums.length ? Math.min(...nums) : 1;
  const hi = nums.length ? Math.max(...nums) : 1;

  const m = openModal(`حذف فصول — ${GRADES[grade]} — ${subject}`);
  m.body.innerHTML = `
    <p class="hint" style="margin:0 0 14px">⚠️ حذف الفصل ينقل ملفاته لسلة المحذوفات، والطالب يشوف الفصل مكتوب عليه «تم حذف المحتوى». الحذف النهائي من السلة للمالك فقط.</p>
    <div class="row">
      <div class="field" style="width:130px"><label for="cdFrom">من فصل</label><input class="input" id="cdFrom" type="number" min="1" value="${lo}" /></div>
      <div class="field" style="width:130px"><label for="cdTo">إلى فصل</label><input class="input" id="cdTo" type="number" min="1" value="${hi}" /></div>
    </div>
    <div class="mini" id="cdInfo" style="margin-bottom:12px"></div>
    ${isOwner ? `<label style="display:flex;gap:8px;align-items:center;margin-bottom:12px;cursor:pointer">
      <input type="checkbox" id="cdHard" style="width:18px;height:18px;accent-color:#fb7185" />
      <span>حذف نهائي (الفصل وملفاته يختفوا تمامًا، ولا يظهر «تم حذف المحتوى» للطالب) — للمالك فقط</span></label>` : ""}
    <button class="btn btn-danger" id="cdRange" type="button">🗑 حذف محتوى هذا النطاق</button>
    <hr style="border:none;border-top:1px solid var(--border);margin:18px 0" />
    <button class="btn btn-danger" id="cdAll" type="button">🗑 حذف كل الفصول (${list.length})</button>`;

  const inRange = () => {
    const a = parseInt($("#cdFrom", m.body).value, 10);
    const b = parseInt($("#cdTo", m.body).value, 10);
    if (!(a > 0) || !(b > 0)) return [];
    const [from, to] = a <= b ? [a, b] : [b, a];
    return list.filter((s) => { const n = chapterNo(s.title); return n != null && n >= from && n <= to; });
  };
  const refresh = () => {
    const n = inRange().length;
    $("#cdInfo", m.body).textContent = n ? `سيتم حذف ${n} فصل.` : "لا توجد فصول في هذا النطاق.";
    $("#cdRange", m.body).disabled = !n;
  };
  ["#cdFrom", "#cdTo"].forEach((s) => $(s, m.body).addEventListener("input", refresh));
  refresh();

  async function hardWipe(target, btn) {
    if (prompt(`سيتم حذف ${target.length} فصل بملفاته نهائيًا ولا يمكن التراجع.\nللتأكيد اكتب كلمة: حذف`) !== "حذف") return;
    setBusy(btn, true, "جارٍ الحذف...");
    await removeFiles(target.flatMap((s) => (s.learning_content || []).map((c) => c.storage_path)));
    const ids = target.map((s) => s.id);
    let failed = false;
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabase.from("learning_sections").delete().in("id", ids.slice(i, i + 100));
      if (error) failed = true;
    }
    setBusy(btn, false);
    if (failed) return toast("فشل حذف بعض الفصول", "bad");
    toast(`تم حذف ${ids.length} فصل نهائيًا`);
    m.close();
    loadSections();
  }

  async function wipe(target, btn) {
    if (isOwner && $("#cdHard", m.body)?.checked) return hardWipe(target, btn);
    if (prompt(`سيتم حذف محتوى ${target.length} فصل (ينتقل لسلة المحذوفات).\nالطالب هيشوف الفصل مكتوب عليه «تم حذف المحتوى».\nللتأكيد اكتب كلمة: حذف`) !== "حذف") return;
    setBusy(btn, true, "جارٍ الحذف...");
    const ids = target.map((s) => s.id);
    let failed = false;
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const r1 = await supabase.from("learning_content").update({ deleted_at: new Date().toISOString() }).in("section_id", part).is("deleted_at", null);
      const r2 = await supabase.from("learning_sections").update({ content_deleted: true }).in("id", part);
      if (r1.error || r2.error) failed = true;
    }
    setBusy(btn, false);
    if (failed) return toast("فشل حذف بعض الفصول", "bad");
    toast(`تم حذف ${ids.length} فصل`);
    m.close();
    loadSections();
  }
  $("#cdRange", m.body).addEventListener("click", (e) => { const t = inRange(); if (t.length) wipe(t, e.currentTarget); });
  $("#cdAll", m.body).addEventListener("click", (e) => wipe(list, e.currentTarget));
}

/* ------------------------------ حذف ملفات داخل فصل (خاصة) ------------------------------ */
// الحذف هنا ينقل الملفات إلى سلة المحذوفات (يمكن استرجاعها منها)
function bulkDeleteModal(sec) {
  const items = activeItems(sec);
  if (!items.length) return toast("لا يوجد محتوى في هذا الفصل", "bad");
  const numbered = sec.grade !== "private";
  const nums = items.map((c) => c.chapter_no).filter((n) => n != null);
  const lo = nums.length ? Math.min(...nums) : 1;
  const hi = nums.length ? Math.max(...nums) : 1;

  const m = openModal(`حذف ملفات — ${sec.title}`);
  m.body.innerHTML = `
    <p class="hint" style="margin:0 0 14px">الملفات المحذوفة تُنقل إلى «السلة» ويمكنك استرجاعها منها.</p>
    ${numbered ? `
      <div class="row">
        <div class="field" style="width:130px"><label for="bdFrom">من رقم</label><input class="input" id="bdFrom" type="number" min="1" value="${lo}" /></div>
        <div class="field" style="width:130px"><label for="bdTo">إلى رقم</label><input class="input" id="bdTo" type="number" min="1" value="${hi}" /></div>
      </div>
      <div class="mini" id="bdInfo" style="margin-bottom:12px"></div>
      <button class="btn btn-danger" id="bdRange" type="button">🗑 حذف هذا النطاق</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:18px 0" />` : ""}
    <button class="btn btn-danger" id="bdAll" type="button">🗑 حذف الكل (${items.length} ملف)</button>`;

  const inRange = () => {
    const a = parseInt($("#bdFrom", m.body).value, 10);
    const b = parseInt($("#bdTo", m.body).value, 10);
    if (!(a > 0) || !(b > 0)) return [];
    const [from, to] = a <= b ? [a, b] : [b, a];
    return items.filter((c) => c.chapter_no != null && c.chapter_no >= from && c.chapter_no <= to);
  };
  const refresh = () => {
    if (!numbered) return;
    const n = inRange().length;
    $("#bdInfo", m.body).textContent = n ? `سيتم حذف ${n} ملف.` : "لا توجد ملفات في هذا النطاق.";
    $("#bdRange", m.body).disabled = !n;
  };
  if (numbered) {
    ["#bdFrom", "#bdTo"].forEach((s) => $(s, m.body).addEventListener("input", refresh));
    refresh();
  }

  async function trash(list, btn) {
    setBusy(btn, true, "جارٍ الحذف...");
    const ids = list.map((c) => c.id);
    let failed = false;
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabase.from("learning_content")
        .update({ deleted_at: new Date().toISOString() }).in("id", ids.slice(i, i + 100));
      if (error) failed = true;
    }
    setBusy(btn, false);
    if (failed) return toast("فشل حذف بعض الملفات", "bad");
    toast(`نُقل ${ids.length} ملف إلى السلة`);
    m.close();
    loadSections();
  }

  if (numbered) {
    $("#bdRange", m.body).addEventListener("click", (e) => {
      const list = inRange();
      if (!list.length) return;
      if (!confirm(`نقل ${list.length} ملف (من الرقم ${Math.min(...list.map((c) => c.chapter_no))} إلى ${Math.max(...list.map((c) => c.chapter_no))}) إلى السلة؟`)) return;
      trash(list, e.currentTarget);
    });
  }
  $("#bdAll", m.body).addEventListener("click", (e) => {
    if (!confirm(`نقل كل الملفات (${items.length}) في «${sec.title}» إلى السلة؟`)) return;
    trash(items, e.currentTarget);
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
      <input type="checkbox" id="autoName" hidden ${autoDefault ? "checked" : ""} />
      <div class="mini" style="flex:1;min-width:240px">
        ${isPrivate
          ? "قسم «خاصة»: يبقى اسم الملف الأصلي كما هو."
          : `الاسم ثابت حسب الرقم: <b dir="ltr">Chapter &lt;رقم&gt; ${sec.grade === "first" ? "F" : "S"}</b> — سمّ ملفاتك 1 و 2 و 3 ... وسيُؤخذ الرقم من الاسم. الملف بلا رقم لا يُرفع.`}
      </div>
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
      if (!isPrivate && it.n == null) throw new Error("اسم الملف لازم يحتوي رقم الفصل (مثل 1.txt)");
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

/* ------------------------------ الرسائل عبر البوت ------------------------------ */
const AUD_LABEL = {
  all: "كل الطلاب المفعّلين", first: "أولى بكالوريا", second: "ثانية بكالوريا",
  selected: "طلاب محددون", channel: "القناة",
};
const picked = new Set();

// قائمة اختيار الطلاب: المربوطون بتيليجرام وغير المحظورين فقط
function renderPicker() {
  const q = $("#msgSearch").value.trim().toLowerCase();
  const list = students.filter((s) =>
    s.status !== "blocked" && s.telegram_links?.telegram_id &&
    (!q || (s.full_name || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q))).slice(0, 200);
  $("#msgList").innerHTML = list.length ? list.map((s) => `
    <label class="item" style="cursor:pointer">
      <div class="meta"><b>${esc(s.full_name || "—")}</b><small>${esc(s.email || "")} • ${esc(GRADES[s.grade] || "")}</small></div>
      <input type="checkbox" data-pick="${esc(s.id)}" ${picked.has(s.id) ? "checked" : ""} style="width:20px;height:20px;accent-color:#2de2e6" />
    </label>`).join("") : `<div class="empty" style="padding:14px">لا يوجد طلاب مربوطون بتيليجرام.</div>`;
  $("#msgPicked").textContent = `تم اختيار ${picked.size} طالب`;
}

$("#msgAudience").addEventListener("change", () => {
  $("#msgPicker").hidden = $("#msgAudience").value !== "selected";
  if (!$("#msgPicker").hidden) renderPicker();
});
$("#msgSearch").addEventListener("input", debounce(renderPicker, 200));
$("#msgList").addEventListener("change", (e) => {
  const cb = e.target.closest("[data-pick]");
  if (!cb) return;
  cb.checked ? picked.add(cb.dataset.pick) : picked.delete(cb.dataset.pick);
  $("#msgPicked").textContent = `تم اختيار ${picked.size} طالب`;
});
$("#msgText").addEventListener("input", () => { $("#msgCount").textContent = String($("#msgText").value.length); });

$("#msgSend").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const audience = $("#msgAudience").value;
  const text = $("#msgText").value.trim();
  if (!text) return toast("اكتب نص الرسالة", "bad");
  if (audience === "selected" && !picked.size) return toast("اختر طالبًا واحدًا على الأقل", "bad");
  if (!confirm(`إرسال الرسالة إلى «${AUD_LABEL[audience]}»؟`)) return;

  setBusy(btn, true, "جارٍ الإرسال...");
  const { data, error } = await supabase.functions.invoke("send-message", {
    body: { audience, text, user_ids: audience === "selected" ? [...picked] : undefined },
  });
  setBusy(btn, false);
  if (error || data?.error) {
    return toast(`تعذّر الإرسال${data?.error ? " (" + data.error + ")" : ""} — هل نشرت دالة send-message؟`, "bad");
  }
  toast(`تم الإرسال: وصلت ${data.sent} • فشلت ${data.failed}`, data.failed ? "bad" : "ok");
  $("#msgText").value = ""; $("#msgCount").textContent = "0";
  loadBroadcasts();
});

async function loadBroadcasts() {
  const { data, error } = await supabase.from("broadcasts")
    .select("*").order("created_at", { ascending: false }).limit(50);
  if (error) {
    $("#msgHistory").innerHTML = `<tr><td colspan="5"><div class="empty" style="border:none">تعذّر تحميل السجل (هل شغّلت sql/migration_4.sql؟)</div></td></tr>`;
    return;
  }
  $("#msgHistory").innerHTML = data.length ? data.map((b) => `
    <tr>
      <td>${formatDate(b.created_at)}</td>
      <td>${esc(AUD_LABEL[b.audience] || b.audience)}</td>
      <td>${b.sent}</td>
      <td>${b.failed ? `<span class="badge badge-rejected">${b.failed}</span>` : "0"}</td>
      <td style="max-width:420px;white-space:pre-wrap">${esc(b.body.length > 160 ? b.body.slice(0, 160) + "…" : b.body)}</td>
      <td>${b.deleted_at
        ? `<span class="badge badge-neutral">حُذفت من عند الطلاب</span>`
        : (Array.isArray(b.deliveries) && b.deliveries.length ? `<button class="btn btn-sm btn-danger" data-delbc="${esc(b.id)}">🗑 حذف من البوت</button>` : "")}</td>
    </tr>`).join("")
    : `<tr><td colspan="6"><div class="empty" style="border:none">لم تُرسل رسائل بعد.</div></td></tr>`;
}

$("#msgHistory").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-delbc]");
  if (!btn) return;
  if (!confirm("هتتحذف الرسالة من عند كل اللي استلموها في البوت (خلال ٤٨ ساعة من إرسالها فقط). متأكد؟")) return;
  setBusy(btn, true, "...");
  const { data, error } = await supabase.functions.invoke("delete-broadcast", { body: { broadcast_id: btn.dataset.delbc } });
  if (error || data?.error) { setBusy(btn, false); return toast("تعذّر الحذف. تأكد من نشر دالة delete-broadcast.", "bad"); }
  toast(`تم حذف ${data.deleted} رسالة` + (data.failed ? ` (تعذّر ${data.failed}: غالبًا مر عليها أكثر من ٤٨ ساعة)` : ""), data.failed ? "bad" : "ok");
  loadBroadcasts();
});

// ---- المسح الكامل: للمالك فقط (الدوال في قاعدة البيانات ترفض غيره)
async function ownerClear(rpc, msg, reload) {
  if (!isOwner || !confirm(msg)) return;
  const { error } = await supabase.rpc(rpc);
  if (error) return toast("تعذّر المسح. تأكد من تشغيل sql/migration_9.sql وإنك المالك.", "bad");
  toast("تم المسح");
  reload();
}
// نسخة احتياطية JSON لكل الجداول المهمة (للمالك فقط). ملفات التخزين (PDF/فيديو) لا تدخل فيها.
$("#backupBtn").addEventListener("click", async (e) => {
  if (!isOwner) return;
  const btn = e.currentTarget;
  setBusy(btn, true, "جارٍ التجهيز...");
  const out = { exported_at: new Date().toISOString(), tables: {} };
  const tables = ["student_profiles", "telegram_links", "student_section_access", "learning_sections", "section_shares", "learning_content", "broadcasts", "password_requests", "app_settings"];
  let failed = [];
  for (const t of tables) {
    const rows = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase.from(t).select("*").range(from, from + 499);
      if (error) { if (t !== "section_shares" && t !== "password_requests") failed.push(t); break; }
      rows.push(...data);
      if (data.length < 500) break;
    }
    out.tables[t] = rows;
  }
  setBusy(btn, false);
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `txt-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(failed.length ? `تم التصدير لكن تعذّر: ${failed.join("، ")}` : "تم تنزيل النسخة الاحتياطية", failed.length ? "bad" : "ok");
});

$("#clearIncomplete").addEventListener("click", async () => {
  if (!isOwner || !confirm("حذف الحسابات اللي بدأت التسجيل بـ Google ولم تكمله من أكثر من يومين؟")) return;
  const { data, error } = await supabase.rpc("owner_clear_incomplete_accounts");
  if (error) return toast("تعذّر التنظيف. تأكد من تشغيل sql/migration_12.sql وإنك المالك.", "bad");
  toast(`تم حذف ${data} حساب غير مكتمل`);
  loadStudents();
});
$("#clearBroadcasts").addEventListener("click", () => ownerClear("owner_clear_broadcasts", "مسح كل سجل الرسائل نهائيًا؟ (الرسائل نفسها عند الطلاب لا تتأثر)", loadBroadcasts));
$("#clearPw").addEventListener("click", () => ownerClear("owner_clear_password_requests", "مسح الطلبات المنتهية (المنفّذة والمرفوضة)؟", loadPwRequests));
$("#clearLog").addEventListener("click", () => ownerClear("owner_clear_log", "مسح سجل الفتح والتنزيل بالكامل نهائيًا؟", loadLog));

/* ------------------------------ طلبات كلمة المرور ------------------------------ */
// القائمة من دالة محمية في قاعدة البيانات (للمشرفين فقط)، والموافقة تتم في Edge Function reset-password
async function loadPwRequests() {
  const box = $("#pwList");
  const { data, error } = await supabase.rpc("admin_list_password_requests");
  if (error) {
    box.innerHTML = `<div class="empty">تعذّر التحميل. تأكد من تشغيل sql/migration_8.sql.</div>`;
    return;
  }
  const badge = $("#pwCount");
  badge.textContent = data.length;
  badge.hidden = data.length === 0;
  if (!data.length) { box.innerHTML = `<div class="empty">لا توجد طلبات حاليًا.</div>`; return; }
  box.innerHTML = data.map((r) => `
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <b>${esc(r.full_name || "—")}</b> <span class="badge badge-neutral">${esc(GRADES[r.grade] || r.grade)}</span>
          <div class="mini ltr" style="direction:ltr;text-align:start">${esc(r.email || "")}</div>
          <div class="mini">الهاتف: <b class="ltr" style="direction:ltr;display:inline-block">${esc(r.phone || "غير متوفر")}</b>
            ${r.telegram_username ? ` • تيليجرام: <a href="https://t.me/${esc(r.telegram_username)}" target="_blank" rel="noopener">@${esc(r.telegram_username)}</a>` : ""}</div>
          <div class="mini">وصل: ${formatDate(r.created_at)}</div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn btn-sm btn-ok" data-pwok="${esc(r.id)}">✓ موافقة وإرسال كلمة مؤقتة</button>
          <button class="btn btn-sm btn-danger" data-pwno="${esc(r.id)}">✕ رفض</button>
        </div>
      </div>
    </div>`).join("");
}
$("#reloadPw").addEventListener("click", loadPwRequests);
$("#pwList").addEventListener("click", async (e) => {
  const ok = e.target.closest("[data-pwok]");
  const no = e.target.closest("[data-pwno]");
  const btn = ok || no;
  if (!btn) return;
  const id = ok ? ok.dataset.pwok : no.dataset.pwno;
  if (ok && !confirm("هل كلمت الطالب وتأكدت منه؟ هيتولّد له كلمة مؤقتة وتتبعت له في البوت.")) return;
  setBusy(btn, true, "...");
  const { data, error } = await supabase.functions.invoke("reset-password", { body: { request_id: id, action: ok ? "approve" : "reject" } });
  if (error || data?.error) {
    setBusy(btn, false);
    return toast("تعذّر التنفيذ. تأكد من نشر دالة reset-password.", "bad");
  }
  if (ok && data.sent === false) {
    prompt("الرسالة ما وصلت للطالب في البوت. ابعتله الكلمة المؤقتة دي بنفسك:", data.temp_password);
  } else toast(ok ? "تمت الموافقة وأُرسلت الكلمة للطالب" : "تم الرفض");
  loadPwRequests();
});

/* ------------------------------ المشرفون (للمالك فقط) ------------------------------ */
// الحماية الحقيقية في قاعدة البيانات (admin_is_owner / owner_*)؛ إخفاء التبويب هنا للتنظيم فقط.
async function initOwner() {
  const { data: ids } = await supabase.rpc("admin_ids");
  if (Array.isArray(ids)) adminIds = new Set(ids);
  const { data: owner } = await supabase.rpc("admin_is_owner");
  isOwner = owner === true;
  if (isOwner) $("#tabAdminsBtn").hidden = false;
  $$(".owner-only").forEach((b) => { b.hidden = !isOwner; });
}

async function loadAdmins() {
  const { data, error } = await supabase.rpc("owner_list_admins");
  if (error) {
    $("#adminsBody").innerHTML = `<tr><td colspan="4"><div class="empty" style="border:none">غير متاح.</div></td></tr>`;
    return;
  }
  $("#adminsBody").innerHTML = data.map((a) => `
    <tr>
      <td class="ltr" style="direction:ltr;text-align:start">${esc(a.email)}</td>
      <td><span class="badge ${a.is_owner ? "badge-approved" : "badge-neutral"}">${a.is_owner ? "المالك" : "مشرف"}</span></td>
      <td>${formatDate(a.created_at)}</td>
      <td>${a.is_owner || a.user_id === selfId ? "" : `<button class="btn btn-sm btn-danger" data-rmadmin="${esc(a.user_id)}" data-email="${esc(a.email)}">إزالة</button>`}</td>
    </tr>`).join("");
}

$("#adminAddForm").addEventListener("submit", async () => {
  const email = $("#adminEmail").value.trim();
  if (!email) return toast("اكتب إيميل المشرف", "bad");
  const btn = $("#adminAddBtn");
  setBusy(btn, true, "...");
  const { error } = await supabase.rpc("owner_add_admin", { p_email: email });
  setBusy(btn, false);
  if (error) {
    return toast(/user_not_found/.test(error.message) ? "لا يوجد حساب بهذا الإيميل. اطلب منه التسجيل أولًا." : "تعذّرت الإضافة", "bad");
  }
  $("#adminEmail").value = "";
  toast("تمت إضافة المشرف");
  await initOwner(); // يحدّث قائمة المشرفين المخفيين من الطلاب
  loadAdmins();
  loadStudents();
});

$("#adminsBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-rmadmin]");
  if (!b) return;
  if (!confirm(`إزالة «${b.dataset.email}» من المشرفين؟ يرجع حسابًا عاديًا.`)) return;
  setBusy(b, true, "...");
  const { error } = await supabase.rpc("owner_remove_admin", { p_user: b.dataset.rmadmin });
  setBusy(b, false);
  if (error) return toast("تعذّرت الإزالة", "bad");
  toast("تمت إزالة المشرف");
  await initOwner();
  loadAdmins();
  loadStudents();
});

/* ------------------------------ سلة المحذوفات ------------------------------ */
function trashedItems() {
  const out = [];
  sections.forEach((s) => (s.learning_content || []).forEach((c) => { if (c.deleted_at) out.push({ ...c, section: s }); }));
  return out.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
}

function renderTrash() {
  const items = trashedItems();
  $("#emptyTrash").disabled = !items.length || !isOwner;
  $("#trashList").innerHTML = items.length ? items.map((c) => `
    <div class="item" data-tid="${esc(c.id)}">
      <div class="meta">
        <b>${KIND_ICON[c.kind] || "📎"} ${esc(c.title)}</b>
        <small>${esc(c.section.grade === "private" ? "خاصة" : GRADES[c.section.grade] + " — " + c.section.subject)} • ${esc(c.section.title)} • حُذف ${formatDate(c.deleted_at)}</small>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn btn-sm btn-ok" data-tact="restore">استرجاع</button>
        ${isOwner ? `<button class="btn btn-sm btn-danger" data-tact="purge">حذف نهائي</button>` : ""}
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
    // استرجاع ملف يرجّع فصله «غير محذوف المحتوى»
    await supabase.from("learning_sections").update({ content_deleted: false }).eq("id", c.section.id).eq("content_deleted", true);
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

  selfId = ctx.user.id;
  const who = $("#whoami");
  who.textContent = ctx.user.email;
  who.hidden = false;

  $("#loading").hidden = true;
  $("#app").hidden = false;
  observeDynamic($("#sectionsList"));
  await initOwner();
  await loadStudents();
  loadPwRequests();
})();
