// آلة حاسبة علمية — محلل رياضي آمن (بدون eval)
const $ = (s, r = document) => r.querySelector(s);

/* ---------------- المحلل ---------------- */
const FUNCS = {
  sin: (x, d) => Math.sin(d ? x * Math.PI / 180 : x),
  cos: (x, d) => Math.cos(d ? x * Math.PI / 180 : x),
  tan: (x, d) => Math.tan(d ? x * Math.PI / 180 : x),
  asin: (x, d) => (d ? Math.asin(x) * 180 / Math.PI : Math.asin(x)),
  acos: (x, d) => (d ? Math.acos(x) * 180 / Math.PI : Math.acos(x)),
  atan: (x, d) => (d ? Math.atan(x) * 180 / Math.PI : Math.atan(x)),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
  exp: (x) => Math.exp(x),
};

function fact(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("المضروب للأعداد الصحيحة الموجبة فقط");
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function tokenize(src) {
  const t = [];
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi").replace(/√/g, "sqrt").replace(/\s+/g, "");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if ((s[j] === "e" || s[j] === "E") && /[0-9+-]/.test(s[j + 1] || "") && /[0-9]/.test((s[j + 1] === "+" || s[j + 1] === "-" ? s[j + 2] : s[j + 1]) || "")) {
        j++;
        if (s[j] === "+" || s[j] === "-") j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      const num = Number(s.slice(i, j));
      if (Number.isNaN(num)) throw new Error("رقم غير صالح");
      t.push({ k: "n", v: num });
      i = j;
    } else if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      t.push({ k: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
    } else if ("+-*/^%!()".includes(c)) {
      t.push({ k: c });
      i++;
    } else throw new Error("رمز غير مدعوم: " + c);
  }
  return t;
}

export function evaluate(src, { deg = true, ans = 0 } = {}) {
  const t = tokenize(src);
  let p = 0;
  const peek = () => t[p];
  const eat = (k) => (t[p] && t[p].k === k ? t[p++] : null);

  function expr() {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  }
  function term() {
    let v = unary();
    for (;;) {
      if (eat("*")) v *= unary();
      else if (eat("/")) v /= unary();
      else if (peek() && (peek().k === "n" || peek().k === "id" || peek().k === "(")) v *= unary(); // ضرب ضمني: 2π ، 3(4+1)
      else return v;
    }
  }
  function unary() {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    return power();
  }
  function power() {
    const base = postfix();
    if (eat("^")) return Math.pow(base, unary()); // يمين لليسار
    return base;
  }
  function postfix() {
    let v = primary();
    for (;;) {
      if (eat("!")) v = fact(v);
      else if (eat("%")) v = v / 100;
      else return v;
    }
  }
  function primary() {
    const tk = peek();
    if (!tk) throw new Error("العملية ناقصة");
    if (tk.k === "n") { p++; return tk.v; }
    if (tk.k === "(") {
      p++;
      const v = expr();
      if (!eat(")")) throw new Error("قوس ناقص");
      return v;
    }
    if (tk.k === "id") {
      p++;
      if (tk.v === "pi") return Math.PI;
      if (tk.v === "e") return Math.E;
      if (tk.v === "ans") return ans;
      const f = FUNCS[tk.v];
      if (!f) throw new Error("دالة غير معروفة: " + tk.v);
      let arg;
      if (eat("(")) {
        arg = expr();
        if (!eat(")")) throw new Error("قوس ناقص");
      } else arg = power();
      return f(arg, deg);
    }
    throw new Error("عملية غير صحيحة");
  }

  const v = expr();
  if (p < t.length) throw new Error("عملية غير صحيحة");
  if (typeof v !== "number" || Number.isNaN(v)) throw new Error("النتيجة غير معرّفة");
  return v;
}

export function fmt(v) {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : v < 0 ? "-∞" : "غير معرّف";
  const r = Math.round(v * 1e12) / 1e12; // يتخلص من 0.1+0.2
  if (Math.abs(r) >= 1e15 || (r !== 0 && Math.abs(r) < 1e-9)) return r.toExponential(8).replace(/\.?0+e/, "e");
  return String(r);
}

/* ---------------- الواجهة ---------------- */
if (typeof document !== "undefined" && $("#calc")) {
  const exprEl = $("#expr");
  const resEl = $("#result");
  const histEl = $("#history");
  const degBtn = $("#degBtn");
  const memTag = $("#memTag");

  let expr = "";
  let ans = 0;
  let mem = 0;
  let deg = true;
  let justEvaluated = false;
  let history = [];

  try { history = JSON.parse(localStorage.getItem("txtv_calc_hist") || "[]").slice(0, 30); } catch { history = []; }
  const saveHist = () => { try { localStorage.setItem("txtv_calc_hist", JSON.stringify(history.slice(0, 30))); } catch { /* تجاهل */ } };

  function render() {
    exprEl.textContent = expr || "0";
    let live = "";
    if (expr) {
      try { live = fmt(evaluate(expr, { deg, ans })); } catch { live = ""; }
    }
    resEl.textContent = live;
    degBtn.textContent = deg ? "DEG" : "RAD";
    memTag.hidden = mem === 0;
    histEl.innerHTML = history.length
      ? history.map((h, i) => `<button type="button" class="h-item" data-i="${i}"><span>${h.e}</span><b>= ${h.r}</b></button>`).join("")
      : `<p class="muted" style="text-align:center">لسه مفيش عمليات</p>`;
  }

  function add(s) {
    if (justEvaluated) {
      // بعد النتيجة: الرقم يبدأ عملية جديدة، والعامل يكمّل على النتيجة
      expr = /^[0-9.(a-z]/i.test(s) ? "" : "ans";
      justEvaluated = false;
    }
    expr += s;
    render();
  }

  function equals() {
    if (!expr) return;
    try {
      const v = evaluate(expr, { deg, ans });
      const r = fmt(v);
      history.unshift({ e: expr, r });
      history = history.slice(0, 30);
      saveHist();
      ans = v;
      exprEl.textContent = expr;
      resEl.textContent = r;
      resEl.classList.remove("err");
      justEvaluated = true;
      expr = r === "∞" || r === "-∞" || r === "غير معرّف" ? "" : r;
      render2();
    } catch (e) {
      resEl.textContent = e.message;
      resEl.classList.add("err");
    }
  }
  function render2() {
    const keepE = exprEl.textContent, keepR = resEl.textContent;
    render();
    exprEl.textContent = keepE;
    resEl.textContent = keepR;
  }

  function currentValue() {
    try { return evaluate(expr || "0", { deg, ans }); } catch { return null; }
  }

  function action(a) {
    if (a === "C") { expr = ""; justEvaluated = false; resEl.classList.remove("err"); }
    else if (a === "DEL") { if (justEvaluated) { expr = ""; justEvaluated = false; } else expr = expr.replace(/(sqrt|asin|acos|atan|sin|cos|tan|ln|log|abs|cbrt|exp|ans|pi)\($|(sqrt|asin|acos|atan|sin|cos|tan|ln|log|abs|cbrt|exp|ans|pi)$|.$/, ""); }
    else if (a === "=") return equals();
    else if (a === "deg") deg = !deg;
    else if (a === "neg") { expr = expr ? `-(${expr})` : "-"; justEvaluated = false; }
    else if (a === "MC") mem = 0;
    else if (a === "MR") return add(String(mem));
    else if (a === "M+" || a === "M-") {
      const v = currentValue();
      if (v === null) { resEl.textContent = "اكتب عملية صحيحة الأول"; resEl.classList.add("err"); return; }
      mem += a === "M+" ? v : -v;
    } else if (a === "clearHist") { history = []; saveHist(); }
    else if (a === "copy") {
      const v = resEl.textContent || exprEl.textContent;
      navigator.clipboard?.writeText(v).then(() => { resEl.dataset.copied = "1"; setTimeout(() => delete resEl.dataset.copied, 900); }, () => {});
      return;
    }
    render();
  }

  $(".calc-wrap").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.i !== undefined) { // من السجل: نعيد استخدام النتيجة
      const h = history[Number(b.dataset.i)];
      if (h) { expr = h.e; justEvaluated = false; render(); }
      return;
    }
    if (b.dataset.a) return action(b.dataset.a);
    if (b.dataset.t) return add(b.dataset.t);
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9.+\-*/^()%!]$/.test(k)) { e.preventDefault(); add(k); }
    else if (k === "Enter" || k === "=") { e.preventDefault(); equals(); }
    else if (k === "Backspace") { e.preventDefault(); action("DEL"); }
    else if (k === "Escape" || k === "Delete") { e.preventDefault(); action("C"); }
    else if (/^[a-z]$/i.test(k)) { /* حروف الدوال: نتجاهلها من الكيبورد */ }
  });

  render();
}
