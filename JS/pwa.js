// تسجيل Service Worker + زر "ثبّت التطبيق" (لو حطيت عنصر #installBtn في الصفحة)

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* تجاهل (مثلًا لو الموقع مش HTTPS محليًا) */ });
  });
}

let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById("installBtn");
  if (btn) btn.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  const btn = document.getElementById("installBtn");
  if (btn) btn.hidden = true;
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#installBtn");
  if (!btn || !deferredPrompt) return;
  btn.hidden = true;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
});
