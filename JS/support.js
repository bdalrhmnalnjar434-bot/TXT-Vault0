// زر «التواصل مع المشرف»: يفتح البوت برابط يحمل المكان (register | login | chapters | general)
// فيسأل البوت الطالب عن مشكلته حسب المكان ويحوّلها للمشرف.
import { TELEGRAM_BOT_USERNAME } from "../supabase.js";

export function supportUrl(source = "general") {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=help_${encodeURIComponent(source)}`;
}

export function vipUrl(source = "site") {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=vip_${encodeURIComponent(source)}`;
}

export function bindSupport(root = document) {
  root.querySelectorAll("[data-vip]").forEach((a) => {
    a.href = vipUrl(a.dataset.vip);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  root.querySelectorAll("[data-support]").forEach((a) => {
    a.href = supportUrl(a.dataset.support);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
}
