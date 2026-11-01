// حركات الظهور عند التمرير + تتابع (stagger) للعناصر داخل الشبكات

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function revealAll(root = document) {
  root.querySelectorAll(".reveal:not(.in)").forEach((el) => el.classList.add("in"));
}

export function initReveal(root = document) {
  const items = [...root.querySelectorAll(".reveal:not([data-seen])")];
  if (!items.length) return;

  // تأخير متدرّج لأبناء الشبكات
  root.querySelectorAll(".grid").forEach((grid) => {
    [...grid.children].forEach((child, i) => {
      if (child.classList.contains("reveal")) child.style.setProperty("--d", `${Math.min(i, 8) * 0.08}s`);
    });
  });

  if (reduce || !("IntersectionObserver" in window)) { revealAll(root); return; }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

  items.forEach((el) => { el.dataset.seen = "1"; io.observe(el); });
}

// مراقبة العناصر التي تُضاف ديناميكيًا (قوائم الطلاب/المحتوى)
export function observeDynamic(container) {
  if (!container) return;
  new MutationObserver(() => initReveal(container)).observe(container, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initReveal());
} else {
  initReveal();
}
