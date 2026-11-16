/* ==========================================================================
   שכבת תנועה – "האולפן נדלק"
   בנוי על Web Animations API (המנוע ש-Motion.dev רץ עליו) עם פיזיקת קפיץ אמיתית.
   בלי ספריות חיצוניות: נטען מהר, לא נחסם בסינונים, עובד גם בטלפונים חלשים.
   כל התנועה מכבדת "הפחתת תנועה" בהגדרות הנגישות של המכשיר.
   ========================================================================== */
(function () {
  "use strict";
  if (!Element.prototype.animate) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FINE = window.matchMedia && matchMedia("(pointer: fine)").matches;

  // ---------- פיזיקת קפיץ → עקומת linear() ----------
  // פותרים קפיץ מרוסן ודוגמים אותו ל-easing שהדפדפן מריץ בכרטיס המסך.
  function spring(stiffness, damping, mass) {
    var w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
    var wd = w0 * Math.sqrt(Math.max(1 - zeta * zeta, 1e-6));
    var x = function (t) {
      return zeta < 1
        ? 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t))
        : 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    };
    // משך: עד שהקפיץ נרגע ל-0.1%
    var dur = 0; for (var t = 0; t < 4; t += 0.01) { if (Math.abs(1 - x(t)) > 0.001) dur = t; }
    dur = Math.max(dur, 0.2);
    var pts = []; for (var i = 0; i <= 48; i++) pts.push(+x(dur * i / 48).toFixed(4));
    return { easing: "linear(" + pts.join(", ") + ")", duration: Math.round(dur * 1000) };
  }
  var LINEAR_OK = window.CSS && CSS.supports && CSS.supports("transition-timing-function", "linear(0, 1)");
  function S(stiff, damp, fallbackMs) {
    var s = spring(stiff, damp, 1);
    return LINEAR_OK ? s : { easing: "cubic-bezier(.22,1.2,.36,1)", duration: fallbackMs || 600 };
  }
  var SNAPPY = S(420, 26, 450);   // כפתורים, לשוניות
  var SOFT = S(170, 22, 800);     // כניסות
  var BOUNCY = S(260, 14, 700);   // "פופ" של תגיות
  var OUT = "cubic-bezier(.16,1,.3,1)";

  function anim(el, kf, o) {
    if (!el) return null;
    o = o || {};
    if (REDUCE) o = { duration: 1, fill: o.fill };
    try { return el.animate(kf, o); } catch (e) { return null; }
  }
  function enter(el, delay, spr, from) {
    spr = spr || SOFT;
    return anim(el, [
      { opacity: 0, transform: from || "translateY(14px) scale(.98)" },
      { opacity: 1, transform: "none" }
    ], { duration: spr.duration, easing: spr.easing, delay: delay || 0, fill: "backwards" });
  }
  function stagger(els, step, base, spr, from) {
    els.forEach(function (el, i) { enter(el, (base || 0) + i * (step || 45), spr, from); });
  }

  // ---------- 1. הדלקת האולפן (כניסה ראשונה) ----------
  function powerOn() {
    document.documentElement.classList.add("motion-ready");
    var deck = $(".deck");
    stagger($$(".topbar > *"), 90, 0, SOFT, "translateY(-10px)");
    anim(deck, [
      { opacity: 0, transform: "perspective(1200px) rotateX(8deg) translateY(28px) scale(.96)" },
      { opacity: 1, transform: "none" }
    ], { duration: SOFT.duration + 200, easing: SOFT.easing, delay: 80, fill: "backwards" });

    // ברגים מסתובבים למקום
    $$(".screw").forEach(function (s, i) {
      anim(s, [{ transform: "rotate(-180deg) scale(.4)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 700, easing: OUT, delay: 250 + i * 70, fill: "backwards" });
    });

    // הצג נדלק: הבהוב קצר + קו סריקה שעובר מלמעלה למטה
    var lcd = $(".lcd");
    if (lcd) {
      anim(lcd, [
        { filter: "brightness(0)" }, { filter: "brightness(0)", offset: .3 },
        { filter: "brightness(1.9)", offset: .42 }, { filter: "brightness(.5)", offset: .5 },
        { filter: "brightness(1.35)", offset: .62 }, { filter: "brightness(1)" }
      ], { duration: 1100, delay: 350, easing: "linear", fill: "backwards" });
      var sweep = document.createElement("i"); sweep.className = "lcd-sweep"; lcd.appendChild(sweep);
      var a = anim(sweep, [{ transform: "translateY(-30%)", opacity: 0 }, { opacity: 1, offset: .15 }, { transform: "translateY(520%)", opacity: 0 }],
        { duration: 900, delay: 700, easing: "cubic-bezier(.5,0,.5,1)" });
      if (a) a.onfinish = function () { sweep.remove(); }; else sweep.remove();
      stagger($$(".lcd-row, .lcd-title, .lcd-sub", lcd), 70, 900, SOFT, "translateY(6px)");
    }

    // מחוגי VU: בדיקת מערכת – קפיצה לסוף הסקאלה וחזרה (כמו בציוד אנלוגי)
    $$(".vu .needle").forEach(function (n, i) {
      anim(n, [
        { transform: "rotate(-50deg)" }, { transform: "rotate(50deg)", offset: .45 },
        { transform: "rotate(38deg)", offset: .58 }, { transform: "rotate(-50deg)" }
      ], { duration: 1500, delay: 600 + i * 90, easing: "cubic-bezier(.45,0,.2,1)" });
    });

    stagger($$(".meters .vu, .transport > *, .fader"), 60, 500, SOFT);
    stagger($$(".seg, .panel:not([hidden]) > *"), 70, 650, SOFT);
  }

  // ---------- 2. לשוניות: גלולה שמחליקה בקפיץ ----------
  function tabs() {
    var seg = $(".seg"); if (!seg) return;
    var pill = document.createElement("span"); pill.className = "seg-pill"; pill.setAttribute("aria-hidden", "true");
    seg.insertBefore(pill, seg.firstChild);
    var last = null;
    function place(animate) {
      var b = $('[aria-selected="true"]', seg); if (!b) return;
      var rect = { x: b.offsetLeft, w: b.offsetWidth };
      if (last && animate && (last.x !== rect.x || last.w !== rect.w)) {
        anim(pill, [
          { transform: "translateX(" + last.x + "px)", width: last.w + "px" },
          { transform: "translateX(" + rect.x + "px)", width: rect.w + "px" }
        ], { duration: SNAPPY.duration, easing: SNAPPY.easing });
      }
      pill.style.transform = "translateX(" + rect.x + "px)"; pill.style.width = rect.w + "px";
      last = rect;
    }
    place(false);
    new MutationObserver(function () { place(true); }).observe(seg, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    window.addEventListener("resize", function () { place(false); });

    // פאנל שנפתח: מחליק פנימה, והתוכן שלו נכנס במדורג
    $$(".panel").forEach(function (p) {
      new MutationObserver(function () {
        if (p.hidden) return;
        anim(p, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: OUT });
        stagger($$(".now-card, .sec-h, .sched-row, .search, .chip, .track", p).slice(0, 18), 28, 60, SOFT);
      }).observe(p, { attributes: true, attributeFilter: ["hidden"] });
    });
  }

  // ---------- 3. רשימות: פריטים חדשים נכנסים במדורג ----------
  function lists() {
    ["trackList", "favList", "schedList", "chips"].forEach(function (id) {
      var list = document.getElementById(id); if (!list) return;
      var prev = 0;
      new MutationObserver(function () {
        var items = $$(":scope > *", list), from = items.length > prev && prev > 0 && list.id === "trackList" ? prev : 0;
        var fresh = items.slice(from, from + 20);
        if (!list.closest(".panel[hidden]")) stagger(fresh, 26, 0, SOFT, "translateY(10px)");
        prev = items.length;
      }).observe(list, { childList: true });
    });
  }

  // ---------- 4. כפתורים: לחיצת קפיץ + גל אור ----------
  function buttons() {
    var SEL = ".play, .tbtn, .cta, .chip, .icon-btn, .more, .seg button, .onair";
    document.addEventListener("pointerdown", function (e) {
      var b = e.target.closest && e.target.closest(SEL); if (!b || b.disabled) return;
      var small = b.matches(".play") ? .93 : .95;
      anim(b, [{ transform: "scale(1)" }, { transform: "scale(" + small + ")" }], { duration: 120, easing: "ease-out", fill: "forwards" });
      var up = function () {
        document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
        anim(b, [{ transform: "scale(" + small + ")" }, { transform: "scale(1)" }], { duration: BOUNCY.duration, easing: BOUNCY.easing, fill: "forwards" });
      };
      document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
      if (b.matches(".cta, .more")) ripple(b, e);
    }, { passive: true });
  }
  function ripple(b, e) {
    var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2;
    var s = document.createElement("span"); s.className = "ripple";
    s.style.width = s.style.height = d + "px";
    s.style.left = (e.clientX - r.left - d / 2) + "px"; s.style.top = (e.clientY - r.top - d / 2) + "px";
    b.appendChild(s);
    var a = anim(s, [{ transform: "scale(0)", opacity: .45 }, { transform: "scale(1)", opacity: 0 }], { duration: 650, easing: OUT });
    if (a) a.onfinish = function () { s.remove(); }; else s.remove();
  }

  // ---------- 5. מצב הנגן: פעימת אור, תגית LIVE, כותרת מתחלפת ----------
  function playerState() {
    var play = $("#btnPlay"), ring = $(".play-ring");
    if (play) new MutationObserver(function () {
      if (play.classList.contains("is-playing")) {
        anim(ring, [{ boxShadow: "0 0 0 0 rgba(62,230,255,.7)" }, { boxShadow: "0 0 0 22px rgba(62,230,255,0)" }], { duration: 900, easing: OUT });
      }
    }).observe(play, { attributes: true, attributeFilter: ["class"] });

    var tag = $("#lcdTag"), lastTag = tag && tag.textContent;
    if (tag) new MutationObserver(function () {
      if (tag.textContent === lastTag) return; lastTag = tag.textContent;
      anim(tag, [{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: BOUNCY.duration, easing: BOUNCY.easing });
      if (lastTag === "LIVE") onAir();
    }).observe(tag, { childList: true, characterData: true, subtree: true });

    var title = $("#lcdTitle");
    if (title) new MutationObserver(function () {
      var span = title.firstElementChild; if (!span) return;
      anim(span, [{ opacity: 0, transform: "translateY(60%)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
        { duration: 520, easing: OUT });
    }).observe(title, { childList: true });

    var badge = $("#nowBadge"), lastBadge = badge && badge.className;
    if (badge) new MutationObserver(function () {
      if (badge.className === lastBadge) return; lastBadge = badge.className;
      anim(badge, [{ transform: "scale(.85)", opacity: .2 }, { transform: "scale(1)", opacity: 1 }], { duration: BOUNCY.duration, easing: BOUNCY.easing });
    }).observe(badge, { attributes: true, attributeFilter: ["class"] });
  }
  // מעבר לשידור חי: חותמת "ON AIR" שנוחתת על הצג
  function onAir() {
    var lcd = $(".lcd"); if (!lcd || REDUCE) return;
    var st = document.createElement("span"); st.className = "onair-stamp"; st.textContent = "ON AIR"; lcd.appendChild(st);
    var a = anim(st, [
      { opacity: 0, transform: "translate(-50%,-50%) scale(1.8) rotate(-8deg)" },
      { opacity: 1, transform: "translate(-50%,-50%) scale(1) rotate(-4deg)", offset: .25 },
      { opacity: 1, transform: "translate(-50%,-50%) scale(1) rotate(-4deg)", offset: .75 },
      { opacity: 0, transform: "translate(-50%,-50%) scale(.96) rotate(-4deg)" }
    ], { duration: 1800, easing: OUT });
    if (a) a.onfinish = function () { st.remove(); }; else st.remove();
  }

  // ---------- 6. הילה חיה: אור ניאון שנושם עם המוזיקה ----------
  function aura() {
    var deck = $(".deck"); if (!deck || REDUCE) return;
    var needles = $$(".vu .needle"), lvl = 0, shown = -1;
    function angle(n) { var m = /rotate\((-?[\d.]+)deg\)/.exec(n.style.transform || ""); return m ? +m[1] : -50; }
    (function loop() {
      var a = needles.length ? (angle(needles[0]) + angle(needles[needles.length - 1])) / 2 : -50;
      var target = Math.max(0, Math.min(1, (a + 50) / 100));
      lvl += (target - lvl) * .12;
      var q = Math.round(lvl * 20) / 20;           // מדרגות של 5% – מעט ציורים מחדש
      if (q !== shown) { shown = q; deck.style.setProperty("--lvl", q); }
      requestAnimationFrame(loop);
    })();
  }

  // ---------- 7. הטיה תלת-ממדית עדינה של הקונסולה (עכבר בלבד) ----------
  function tilt() {
    var deck = $(".deck"); if (!deck || !FINE || REDUCE) return;
    var raf = 0;
    deck.addEventListener("pointermove", function (e) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        var r = deck.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        deck.style.transform = "perspective(1400px) rotateX(" + (-y * 4).toFixed(2) + "deg) rotateY(" + (x * 5).toFixed(2) + "deg)";
        deck.style.setProperty("--gx", (x * 100 + 50).toFixed(1) + "%");
        deck.style.setProperty("--gy", (y * 100 + 50).toFixed(1) + "%");
      });
    });
    deck.addEventListener("pointerleave", function () {
      var from = deck.style.transform || "none"; deck.style.transform = "";
      anim(deck, [{ transform: from }, { transform: "none" }], { duration: SOFT.duration, easing: SOFT.easing });
    });
  }

  // ---------- 8. כותרת עליונה מזכוכית כשגוללים ----------
  function header() {
    var top = $(".topbar"); if (!top) return;
    var on = false;
    function chk() { var s = window.scrollY > 12; if (s !== on) { on = s; top.classList.toggle("is-glass", s); } }
    window.addEventListener("scroll", chk, { passive: true }); chk();
  }

  // ---------- 9. ספירה לאחור: הספרות "מתגלגלות" ----------
  function ticker() {
    var box = $("#nowNext"); if (!box) return;
    var last = "";
    new MutationObserver(function () {
      var c = $(".count", box); if (!c || c.textContent === last) return;
      if (last) anim(c, [{ transform: "translateY(-70%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: OUT });
      last = c.textContent;
    }).observe(box, { childList: true, subtree: true });
  }

  function start() {
    powerOn(); tabs(); lists(); buttons(); playerState(); aura(); tilt(); header(); ticker();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
