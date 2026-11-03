// ثوابت ودوال مشتركة بين لوحة الإدارة وصفحة الطالب

export const GRADES_ALL = { first: "أولى بكالوريا", second: "ثانية بكالوريا", private: "خاصة" };
export const BUCKET = "vault";
export const MAX_FILE_MB = 50;            // حد الخطة المجانية لملف واحد في Supabase Storage
export const MAX_TXT_DB_MB = 2;           // ملفات TXT الأصغر من هذا تُخزَّن نصًّا داخل الجدول

export const KIND_LABEL = { txt: "نص", pdf: "PDF", video: "فيديو", zip: "ZIP", file: "ملف" };
export const KIND_ICON = { txt: "📄", pdf: "📕", video: "🎬", zip: "🗜️", file: "📎" };

export function fmtSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function extOf(name) {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : "";
}

export function baseName(name) {
  return String(name).replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();
}

export function kindFromName(name) {
  const e = extOf(name);
  if (e === "txt") return "txt";
  if (e === "pdf") return "pdf";
  if (["zip", "rar", "7z", "tar", "gz"].includes(e)) return "zip";
  if (["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(e)) return "video";
  return "file";
}

// أول رقم يظهر في اسم الملف = رقم الفصل (أو null لو لا يوجد)
export function chapterNo(name) {
  const m = String(name).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// الاسم الموحّد: أولى = F ، ثانية = S ، خاصة = يبقى الاسم الأصلي
export function chapterTitle(grade, n, fallback) {
  if (n == null || grade === "private") return fallback;
  return `Chapter ${n} ${grade === "first" ? "F" : "S"}`;
}

// ترتيب: رقم الفصل ثم الاسم (ترتيب طبيعي: 2 قبل 10)
export function sortContent(a, b) {
  const an = a.chapter_no ?? Infinity;
  const bn = b.chapter_no ?? Infinity;
  if (an !== bn) return an - bn;
  return String(a.title).localeCompare(String(b.title), "en", { numeric: true });
}

export function dupKey(c) {
  return `${c.kind}|${String(c.title).trim().toLowerCase()}`;
}

/* ------------------------- العلامة المائية ------------------------- */

// تُضاف لملفات TXT فقط (عند النسخ والتنزيل)؛ الـ PDF بدون علامة
export function applyWatermark(text, user) {
  const tag = `${user.name || "—"} | ${user.email || ""} | ${String(user.id || "").slice(0, 8)}`;
  const day = new Date().toISOString().slice(0, 10);
  const line = `----- TXT Vault • ${tag} • ${day} -----`;
  return `${line}\n\n${text}\n\n${line}\n`;
}

// خلفية مكررة بالاسم داخل نافذة عرض النص
export function watermarkBackground(user) {
  const label = `${user.name || ""} ${user.email || ""}`.trim().replace(/[<>&"']/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="190">` +
    `<text x="20" y="110" fill="rgba(255,255,255,0.075)" font-size="15" font-family="Arial,sans-serif" ` +
    `transform="rotate(-22 180 95)">${label}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
