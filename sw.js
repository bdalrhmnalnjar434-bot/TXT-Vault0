// Service Worker — TXT Vault
// غيّر الرقم ده مع أي نشر جديد عشان الكاش يتجدد عند الطلاب
const CACHE = "txtv-v1";

const SHELL = [
  "./index.html",
  "./login.html",
  "./register.html",
  "./student.html",
  "./change-password.html",
  "./calculator.html",
  "./manifest.webmanifest",
  "./CSS/style.css",
  "./CSS/animations.css",
  "./CSS/extra.css",
  "./CSS/login.css",
  "./JS/ui.js",
  "./JS/auth.js",
  "./JS/common.js",
  "./JS/animations.js",
  "./JS/support.js",
  "./JS/maintenance.js",
  "./JS/calculator.js",
  "./supabase.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // نسيب كل حاجة تانية (POST لـ Supabase مثلًا) تعدي عادي
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase وتيليجرام والخطوط: من الإنترنت دايمًا

  // صفحات HTML: نجرب الإنترنت الأول عشان المحتوى يفضل محدّث، ولو مفيش نت نرجّع آخر نسخة محفوظة
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html"))),
    );
    return;
  }

  // ملفات ثابتة (CSS/JS/صور): من الكاش الأول وبسرعة، وتحديث في الخلفية
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || net;
    }),
  );
});
