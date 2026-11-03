// أدوات صلاحيات الفصول للمشرف:
//  - chapterPicker : اختيار فصول بمربعات المواد + بحث + تحديد من–إلى
//  - audienceModal : «لمين تتضاف الفصول؟» (كل الصف / صف معين / أعضاء القناة / طلاب محددين / لا أحد)
//  - approveModal  : عند قبول طالب (كل الفصول أو فصول محددة)
//  - accessToolsModal : منح/سحب/قفل/فتح فصول من رقم إلى رقم أو الكل
// الحماية الفعلية في قاعدة البيانات (admin_grant_sections / admin_approve_student)، هنا واجهة فقط.

import { supabase, GRADES } from "../supabase.js";
import { $, $$, esc, toast, setBusy, openModal, debounce } from "./ui.js";

export const chNo = (s) => {
  const m = /(\d+)/.exec(s.title || "");
  return m ? parseInt(m[1], 10) : (s.position || 0);
};
const groupName = (s) => (s.grade === "private" ? "🔒 خاصة" : s.subject);
const tileIco = (n) => (n.startsWith("🔒") ? "🔒" : n === "JavaScript" ? "JS" : n === "Python" ? "Py" : n.includes("مالية") ? "💰" : n.slice(0, 2));

/* ------------------------------ اختيار فصول ------------------------------ */
// selected: Set من أرقام الفصول. onChange(ids, checked) قد ترجع Promise؛ لو رفضت يُتراجع عن التغيير.
export function chapterPicker(host, secs, selected, onChange) {
  const groups = {};
  secs.forEach((s) => (groups[groupName(s)] ||= []).push(s));
  Object.values(groups).forEach((l) => l.sort((a, b) => chNo(a) - chNo(b)));
  const names = Object.keys(groups).sort((a, b) => (a.startsWith("🔒") ? 1 : b.startsWith("🔒") ? -1 : a.localeCompare(b)));
  let active = names[0];
  let q = "";

  host.innerHTML = `
    <div class="search-row"><input class="input" data-p="search" type="search" placeholder="ابحث عن فصل..." /></div>
    <div class="subject-tiles" data-p="tiles"></div>
    <div class="row" data-p="range" style="gap:8px;margin-bottom:10px;align-items:flex-end">
      <div class="field" style="width:96px;margin:0"><label>من فصل</label><input class="input" data-p="from" type="number" min="0" /></div>
      <div class="field" style="width:96px;margin:0"><label>إلى فصل</label><input class="input" data-p="to" type="number" min="0" /></div>
      <button class="btn btn-sm btn-ok" type="button" data-p="rangeOn">تحديد النطاق</button>
      <button class="btn btn-sm" type="button" data-p="rangeOff">إلغاء النطاق</button>
      <button class="btn btn-sm" type="button" data-p="allOn">تحديد الكل</button>
      <button class="btn btn-sm" type="button" data-p="allOff">إلغاء الكل</button>
    </div>
    <div class="mini" data-p="count" style="margin-bottom:8px"></div>
    <div class="list" data-p="list" style="max-height:340px;overflow:auto"></div>`;
  const el = (k) => $(`[data-p="${k}"]`, host);

  const visible = () => {
    const s = q.trim().toLowerCase();
    return s ? secs.filter((x) => x.title.toLowerCase().includes(s)) : groups[active] || [];
  };

  function paint() {
    el("tiles").innerHTML = names.map((n) => {
      const on = groups[n].filter((s) => selected.has(s.id)).length;
      return `<button class="stile ${!q && n === active ? "active" : ""}" data-g="${esc(n)}" type="button">
        <span class="ico">${esc(tileIco(n))}</span><b ${/[؀-ۿ]|🔒/.test(n) ? 'style="direction:rtl"' : ""}>${esc(n)}</b><small>${on} / ${groups[n].length}</small></button>`;
    }).join("");
    const list = visible();
    el("count").textContent = `المحدد: ${selected.size} من ${secs.length} فصل`;
    el("list").innerHTML = list.length ? list.map((s) => `
      <label class="item" style="cursor:pointer">
        <div class="meta"><b>${esc(s.title)}</b><small>${esc(groupName(s))}${s.is_locked ? " • 🔒 مقفول" : ""}${s.content_deleted ? " • محذوف المحتوى" : ""}</small></div>
        <input type="checkbox" data-id="${esc(s.id)}" ${selected.has(s.id) ? "checked" : ""} style="width:20px;height:20px;accent-color:#2de2e6" />
      </label>`).join("") : `<div class="empty">لا توجد فصول.</div>`;
  }

  async function apply(ids, checked) {
    ids = ids.filter((id) => selected.has(id) !== checked);
    if (!ids.length) return true;
    try { if (onChange) await onChange(ids, checked); } catch { toast("فشل التحديث", "bad"); return false; }
    ids.forEach((id) => (checked ? selected.add(id) : selected.delete(id)));
    paint();
    return true;
  }

  el("tiles").addEventListener("click", (e) => {
    const t = e.target.closest("[data-g]");
    if (!t) return;
    active = t.dataset.g; q = ""; el("search").value = ""; paint();
  });
  el("search").addEventListener("input", debounce((e) => { q = e.target.value; paint(); }, 150));
  el("list").addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-id]");
    if (!cb) return;
    cb.disabled = true;
    const ok = await apply([cb.dataset.id], cb.checked);
    if (!ok) cb.checked = !cb.checked;
    cb.disabled = false;
  });
  const inRange = () => {
    const a = parseInt(el("from").value, 10), b = parseInt(el("to").value, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) { toast("اكتب رقم البداية والنهاية", "bad"); return []; }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return visible().filter((s) => chNo(s) >= lo && chNo(s) <= hi).map((s) => s.id);
  };
  el("rangeOn").addEventListener("click", () => apply(inRange(), true));
  el("rangeOff").addEventListener("click", () => apply(inRange(), false));
  el("allOn").addEventListener("click", () => apply(visible().map((s) => s.id), true));
  el("allOff").addEventListener("click", () => apply(visible().map((s) => s.id), false));
  paint();
}

/* ------------------------------ اختيار الجمهور ------------------------------ */
// يبني نموذج الجمهور داخل host ويرجع دالة get() تُرجع {mode, grade, users}
export function audienceForm(host, students, { allowNone = false, defaultMode = "all" } = {}) {
  const picked = new Set();
  const rname = "aud" + Math.random().toString(36).slice(2, 8);
  const modes = [
    ["all", "كل الطلاب (طلاب الصف المقبولين)"],
    ["grade", "طلاب سنة معينة"],
    ["channel", "أعضاء القناة فقط"],
    ["selected", "طلاب محددين"],
  ];
  if (allowNone) modes.push(["none", "لا أحد الآن (أحدده لاحقًا)"]);

  host.innerHTML = `
    <div class="list" data-a="modes">${modes.map(([k, label]) => `
      <label class="item" style="cursor:pointer"><div class="meta"><b>${label}</b></div>
        <input type="radio" name="${rname}" value="${k}" ${k === defaultMode ? "checked" : ""} style="width:20px;height:20px;accent-color:#2de2e6" /></label>`).join("")}</div>
    <div data-a="gradeBox" hidden style="margin-top:12px"><select data-a="grade">
      ${Object.entries(GRADES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
    <div data-a="selBox" hidden style="margin-top:12px">
      <input class="input" data-a="search" type="search" placeholder="ابحث بالاسم أو البريد..." />
      <div class="list" data-a="list" style="max-height:240px;overflow:auto;margin-top:8px"></div>
      <div class="mini" data-a="cnt" style="margin-top:6px"></div></div>`;
  const el = (k) => $(`[data-a="${k}"]`, host);
  const mode = () => ($$('input[type="radio"]', host).find((r) => r.checked) || {}).value || "all";

  function paintList() {
    const q = el("search").value.trim().toLowerCase();
    const list = students.filter((s) => !q || (s.full_name || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q));
    el("list").innerHTML = list.slice(0, 200).map((s) => `
      <label class="item" style="cursor:pointer"><div class="meta"><b>${esc(s.full_name || "—")}</b><small>${esc(GRADES[s.grade] || "")} • ${esc(s.email || "")}</small></div>
        <input type="checkbox" data-u="${esc(s.id)}" ${picked.has(s.id) ? "checked" : ""} style="width:20px;height:20px;accent-color:#2de2e6" /></label>`).join("")
      || `<div class="empty">لا يوجد طلاب.</div>`;
    el("cnt").textContent = `المحدد: ${picked.size} طالب`;
  }
  host.addEventListener("change", (e) => {
    if (e.target.matches('input[type="radio"]')) {
      el("gradeBox").hidden = mode() !== "grade";
      el("selBox").hidden = mode() !== "selected";
      if (mode() === "selected") paintList();
    }
    const u = e.target.closest("[data-u]");
    if (u) { u.checked ? picked.add(u.dataset.u) : picked.delete(u.dataset.u); el("cnt").textContent = `المحدد: ${picked.size} طالب`; }
  });
  el("search").addEventListener("input", debounce(paintList, 150));
  el("gradeBox").hidden = defaultMode !== "grade";
  el("selBox").hidden = defaultMode !== "selected";
  if (defaultMode === "selected") paintList();

  return () => ({ mode: mode(), grade: el("grade").value, users: [...picked] });
}

// يعيد Promise: {mode, grade, users} أو null عند الإلغاء
export function audienceModal(students, { title = "لمين تتضاف الفصول؟", isPrivate = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal(title);
    m.body.innerHTML = `
      <p class="hint" style="margin:0 0 12px">${isPrivate ? "فصول «خاصة» تفضل مخفية عن الجميع إلا اللي تحدده." : "اختر مين يقدر يفتح الفصول الجديدة. الباقي هيشوفها لكن مكتوب عليها «غير مسموح»."}</p>
      <div id="audHost"></div>
      <div class="row" style="margin-top:16px"><button class="btn btn-primary" id="audOk" type="button">تأكيد</button><button class="btn" id="audNo" type="button">إلغاء</button></div>`;
    const get = audienceForm($("#audHost", m.body), students, { allowNone: true, defaultMode: isPrivate ? "none" : "all" });
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    $("#audOk", m.body).addEventListener("click", () => {
      const a = get();
      if (a.mode === "selected" && !a.users.length) return toast("اختر طالبًا واحدًا على الأقل", "bad");
      finish(a);
    });
    $("#audNo", m.body).addEventListener("click", () => finish(null));
    new MutationObserver((_, ob) => { if (!document.body.contains(m.overlay)) { ob.disconnect(); finish(null); } })
      .observe(document.body, { childList: true });
  });
}

// تطبيق الجمهور على فصول جديدة. «all» لفصول المواد يتم تلقائيًا بالـ trigger (auto_grant)
export const wantsAutoGrant = (grade, aud) => grade !== "private" && aud && aud.mode === "all";
export async function applyAudience(sectionIds, grade, aud) {
  if (!aud || !sectionIds.length || aud.mode === "none" || wantsAutoGrant(grade, aud)) return 0;
  const { data, error } = await supabase.rpc("admin_grant_sections", {
    p_sections: sectionIds, p_mode: aud.mode, p_grade: aud.mode === "grade" ? aud.grade : null,
    p_users: aud.mode === "selected" ? aud.users : null, p_revoke: false,
  });
  if (error) { toast("تعذّر تحديد الجمهور (هل شغّلت sql/migration_10.sql؟)", "bad"); return 0; }
  return data;
}

/* ------------------------------ قبول طالب ------------------------------ */
export async function approveModal(student, onDone) {
  const m = openModal(`قبول الطالب: ${student.full_name || student.email}`);
  m.body.innerHTML = `<div class="skeleton"></div>`;
  const { data: secs, error } = await supabase.from("learning_sections")
    .select("id,grade,subject,title,position,is_locked,content_deleted")
    .in("grade", [student.grade, "private"]).order("subject").order("position");
  if (error) { m.body.innerHTML = `<div class="alert alert-bad">تعذّر تحميل الفصول.</div>`; return; }

  const selected = new Set();
  m.body.innerHTML = `
    <p style="margin:0 0 12px">الصف: <b>${esc(GRADES[student.grade])}</b>. هل تريد فتح <b>كل الفصول</b> له أم <b>تحديد فصول</b>؟</p>
    <div class="row" style="gap:10px;margin-bottom:14px">
      <button class="btn btn-primary" id="apAll" type="button">✅ كل الفصول</button>
      <button class="btn" id="apSome" type="button">🎯 فصول محددة</button>
    </div>
    <div id="apPick" hidden>
      <div id="apHost"></div>
      <div class="row" style="margin-top:14px"><button class="btn btn-ok" id="apOk" type="button">قبول بالفصول المحددة</button></div>
    </div>`;

  const finish = async (all, btn) => {
    setBusy(btn, true, "...");
    const { error: e } = await supabase.rpc("admin_approve_student", {
      p_user: student.id, p_all: all, p_sections: all ? null : [...selected],
    });
    setBusy(btn, false);
    if (e) return toast("فشل القبول (هل شغّلت sql/migration_10.sql؟)", "bad");
    toast("تم قبول الطالب");
    m.close();
    onDone?.();
  };
  $("#apAll", m.body).addEventListener("click", (e) => finish(true, e.currentTarget));
  $("#apSome", m.body).addEventListener("click", () => {
    $("#apPick", m.body).hidden = false;
    chapterPicker($("#apHost", m.body), secs.filter((s) => !s.content_deleted), selected, null);
  });
  $("#apOk", m.body).addEventListener("click", (e) => {
    if (!selected.size && !confirm("لم تحدد أي فصل. يُقبل الطالب بدون فتح أي فصل؟")) return;
    finish(false, e.currentTarget);
  });
}

/* ------------------------------ منح / سحب / قفل / فتح ------------------------------ */
// chapters: فصول المادة (من admin.js)، students: قائمة الطلاب
export function accessToolsModal({ title, chapters, students, onDone }) {
  if (!chapters.length) return toast("لا توجد فصول في هذه المادة", "bad");
  const nos = chapters.map(chNo);
  const lo = Math.min(...nos), hi = Math.max(...nos);
  const m = openModal(title);
  m.body.innerHTML = `
    <div class="field"><label>الإجراء</label>
      <select id="atAct">
        <option value="grant">منح الوصول لجمهور</option>
        <option value="revoke">سحب الوصول من جمهور</option>
        <option value="lock">قفل الفصول (مقفول حاليًا للجميع)</option>
        <option value="unlock">فتح الفصول المقفولة</option>
      </select></div>
    <div class="field"><label>الفصول</label>
      <div class="row" style="gap:8px;align-items:center">
        <label style="display:flex;gap:6px;align-items:center"><input type="radio" name="atScope" value="all" checked /> الكل (${chapters.length})</label>
        <label style="display:flex;gap:6px;align-items:center"><input type="radio" name="atScope" value="range" /> من</label>
        <input class="input" id="atFrom" type="number" style="width:90px" value="${lo}" />
        <span>إلى</span>
        <input class="input" id="atTo" type="number" style="width:90px" value="${hi}" />
      </div></div>
    <div id="atAud"><div class="folder-head" style="margin-top:6px">الجمهور</div><div id="atAudHost"></div></div>
    <div class="mini" id="atInfo" style="margin:10px 0"></div>
    <button class="btn btn-primary" id="atGo" type="button">تنفيذ</button>`;
  const get = audienceForm($("#atAudHost", m.body), students.filter((s) => s.status !== "blocked"), { defaultMode: "all" });

  const act = () => $("#atAct", m.body).value;
  const targets = () => {
    if ($('input[name="atScope"]:checked', m.body).value === "all") return chapters;
    const a = parseInt($("#atFrom", m.body).value, 10), b = parseInt($("#atTo", m.body).value, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return [];
    const [x, y] = a <= b ? [a, b] : [b, a];
    return chapters.filter((s) => chNo(s) >= x && chNo(s) <= y);
  };
  const refresh = () => {
    $("#atAud", m.body).hidden = !["grant", "revoke"].includes(act());
    $("#atInfo", m.body).textContent = `سيُطبَّق على ${targets().length} فصل.`;
  };
  m.body.addEventListener("input", refresh);
  m.body.addEventListener("change", refresh);
  refresh();

  $("#atGo", m.body).addEventListener("click", async (e) => {
    const list = targets();
    if (!list.length) return toast("لا توجد فصول في هذا النطاق", "bad");
    const ids = list.map((s) => s.id);
    const btn = e.currentTarget;
    setBusy(btn, true, "جارٍ التنفيذ...");
    try {
      if (act() === "lock" || act() === "unlock") {
        for (let i = 0; i < ids.length; i += 100) {
          const { error } = await supabase.from("learning_sections").update({ is_locked: act() === "lock" }).in("id", ids.slice(i, i + 100));
          if (error) throw error;
        }
        toast(act() === "lock" ? `تم قفل ${ids.length} فصل` : `تم فتح ${ids.length} فصل`);
      } else {
        const a = get();
        if (a.mode === "selected" && !a.users.length) { setBusy(btn, false); return toast("اختر طالبًا واحدًا على الأقل", "bad"); }
        const { data, error } = await supabase.rpc("admin_grant_sections", {
          p_sections: ids, p_mode: a.mode, p_grade: a.mode === "grade" ? a.grade : null,
          p_users: a.mode === "selected" ? a.users : null, p_revoke: act() === "revoke",
        });
        if (error) throw error;
        toast(act() === "revoke" ? `تم سحب ${data} صلاحية` : `تم منح ${data} صلاحية`);
      }
      m.close();
      onDone?.();
    } catch {
      setBusy(btn, false);
      toast("فشل التنفيذ (هل شغّلت sql/migration_10.sql؟)", "bad");
    }
  });
}
