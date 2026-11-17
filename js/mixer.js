/* ==========================================================================
   מיקסר השידור – פיידרים, פדים מוארים, מדי לדים ושעון דיגיטלי
   ---------------------------------------------------------------------------
   • פיידר ערוץ (שידור חי / מאסטר פליי / לילה מנצח): גוררים למעלה = מדליקים את הערוץ,
     גוררים עד למטה = מכבים. כשערוץ נדלק מכל מקום אחר – הפיידר שלו "ממונע" ועולה לבד.
   • פיידר MASTER: עוצמת השמע.
   • פדים: ON מדליק ערוץ, AUTO = רדיו אוטומטי (חי בזמן התוכנית, ארכיון בשאר הזמן),
     NEXT = הפרק הבא באותו ערוץ.
   מדבר עם הנגן דרך window.RadioApp (ב-app.js).
   ========================================================================== */
(function () {
  "use strict";
  var R = window.RadioApp; if (!R) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ON_LEVEL = 0.76;           // מיקום "0dB" – לשם עולה פיידר של ערוץ פעיל
  var SEGS = 14;

  // ---------- סקאלת dB ליד כל פיידר ----------
  var MARKS = [[1, "+10"], [.88, "+5"], [ON_LEVEL, "0"], [.62, "5"], [.48, "10"], [.34, "20"], [.2, "30"], [.08, "50"], [0, "∞"]];
  $$(".scale").forEach(function (sc) {
    var html = "";
    MARKS.forEach(function (m) { html += '<i class="major" style="top:calc(12px + (100% - 24px) * ' + (1 - m[0]) + ')"></i><em style="top:calc(12px + (100% - 24px) * ' + (1 - m[0]) + ')">' + m[1] + "</em>"; });
    for (var k = 0; k < 20; k++) html += '<i style="top:calc(12px + (100% - 24px) * ' + (k / 20 + .025) + ')"></i>';
    sc.innerHTML = html;
  });
  $$(".ladder").forEach(function (l) {
    var h = ""; for (var i = 0; i < SEGS; i++) h += "<i class='" + (i >= SEGS - 2 ? "hot" : i >= SEGS - 4 ? "amber" : "") + "'></i>";
    l.innerHTML = h;
  });

  // ---------- פיידר ----------
  function Fader(strip, onRelease, onInput) {
    var track = $(".ftrack", strip), cap = $(".fcap", strip);
    var self = { v: 0, target: 0, vel: 0, dragging: false, strip: strip };
    function range() { return track.clientHeight - cap.offsetHeight; }
    function render() {
      cap.style.transform = "translateY(" + ((1 - self.v) * range()).toFixed(1) + "px)";
      cap.setAttribute("aria-valuenow", Math.round(self.v * 100));
    }
    function fromY(y) { var r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, 1 - (y - r.top - cap.offsetHeight / 2) / range())); }
    var grabOffset = 0;
    cap.setAttribute("aria-valuemin", "0"); cap.setAttribute("aria-valuemax", "100"); cap.setAttribute("aria-orientation", "vertical");
    track.addEventListener("pointerdown", function (e) {
      self.dragging = true; cap.classList.add("grab");
      var onCap = e.target === cap;
      var capMid = cap.getBoundingClientRect().top + cap.offsetHeight / 2;
      grabOffset = onCap ? e.clientY - capMid : 0;
      try { track.setPointerCapture(e.pointerId); } catch (x) {}
      self.v = self.target = fromY(e.clientY - grabOffset); render(); if (onInput) onInput(self.v);
      e.preventDefault();
    });
    track.addEventListener("pointermove", function (e) {
      if (!self.dragging) return;
      self.v = self.target = fromY(e.clientY - grabOffset); self.vel = 0; render(); if (onInput) onInput(self.v);
    });
    function end() { if (!self.dragging) return; self.dragging = false; cap.classList.remove("grab"); if (onRelease) onRelease(self.v); }
    track.addEventListener("pointerup", end); track.addEventListener("pointercancel", end);
    cap.addEventListener("keydown", function (e) {
      var d = { ArrowUp: .05, ArrowRight: .05, ArrowDown: -.05, ArrowLeft: -.05, PageUp: .2, PageDown: -.2 }[e.key];
      if (e.key === "Enter" || e.key === " ") { if (onRelease) onRelease(self.v > .5 ? 0 : ON_LEVEL); e.preventDefault(); return; }
      if (d === undefined) return;
      self.v = self.target = Math.max(0, Math.min(1, self.v + d)); render();
      if (onInput) onInput(self.v); if (onRelease) onRelease(self.v);
      e.preventDefault(); e.stopPropagation();
    });
    // "מנוע": קפיץ שמזיז את הפיידר ליעד כשהוא לא נגרר
    self.step = function () {
      if (self.dragging) return;
      if (REDUCE) { if (self.v !== self.target) { self.v = self.target; render(); } return; }
      var f = (self.target - self.v) * 0.16 - self.vel * 0.42;   // קפיץ עם ריסון
      self.vel += f; self.v += self.vel;
      if (Math.abs(self.target - self.v) < 0.001 && Math.abs(self.vel) < 0.001) { self.v = self.target; self.vel = 0; }
      render();
    };
    self.set = function (v, now) { self.target = v; if (now) { self.v = v; self.vel = 0; render(); } };
    self.render = render;
    window.addEventListener("resize", render);
    render();
    return self;
  }

  // ---------- הערוצים ----------
  var strips = $$(".strip");
  var chans = {};
  strips.forEach(function (st) {
    var ch = st.getAttribute("data-ch");
    if (ch === "master") return;
    chans[ch] = {
      strip: st,
      fader: Fader(st, function (v) {
        // שחרור פיידר: למעלה = הדלקה, למטה = כיבוי
        if (v > 0.5 && !isActive(ch)) activate(ch);
        else if (v < 0.12 && isActive(ch)) { R.stop(); }
        sync();
      })
    };
  });
  var masterStrip = $(".strip.master");
  var master = Fader(masterStrip, null, function (v) { R.setVolume(v * 100); });
  master.set(R.getVolume() / 100, true);

  function playing() { return !R.audio.paused || $("#btnPlay").classList.contains("is-loading"); }
  function activeChannel() {
    var s = R.state;
    if (!s.item || !playing()) return null;
    if (s.mode === "live") return "live";
    if (s.item.category && chans[s.item.category]) return s.item.category;
    return null;
  }
  function isActive(ch) { return activeChannel() === ch; }
  // AUTO דולק רק ברדיו האוטומטי המלא (לא כשנבחר ערוץ ארכיון מסוים או שידור חי ידני)
  function autoOn() { var s = R.state; return !!(s.auto && !s.channel && !s.manualLive && playing()); }

  function activate(ch) {
    if (ch === "live") R.playLive();
    else R.playChannel(ch);
  }

  // ---------- פדים ----------
  // לחיצה = לחיצה ושחרור על אותו פד (אמין גם כשהפד "שוקע" באנימציה), ומקלדת דרך click רגיל
  function padAction(pad) {
    var ch = pad.closest(".strip").getAttribute("data-ch"), act = pad.getAttribute("data-act");
    if (act === "on") { if (isActive(ch)) R.stop(); else activate(ch); }
    else if (act === "auto") { if (autoOn()) R.stop(); else R.playRadio(); }
    else if (act === "next") { if (isActive(ch)) R.next(); else activate(ch); }
    flash(pad);
    setTimeout(sync, 60);
  }
  var down = null;
  document.addEventListener("pointerdown", function (e) {
    var pad = e.target.closest && e.target.closest(".strip .pad[data-act]");
    down = pad ? { pad: pad, x: e.clientX, y: e.clientY } : null;
    if (pad) pad.classList.add("press");
  }, true);
  document.addEventListener("pointerup", function (e) {
    if (!down) return;
    var d = down; down = null; d.pad.classList.remove("press");
    if (Math.abs(e.clientX - d.x) < 24 && Math.abs(e.clientY - d.y) < 24) { d.pad.dataset.tapped = "1"; padAction(d.pad); }
  }, true);
  document.addEventListener("pointercancel", function () { if (down) down.pad.classList.remove("press"); down = null; }, true);
  document.addEventListener("click", function (e) {
    var pad = e.target.closest && e.target.closest(".strip .pad[data-act]"); if (!pad) return;
    if (pad.dataset.tapped) { delete pad.dataset.tapped; return; }   // כבר טופל בשחרור
    padAction(pad);                                                     // מקלדת / Enter
  });
  function flash(pad) {
    if (REDUCE || !pad.animate) return;
    pad.animate([{ filter: "brightness(1.6)" }, { filter: "brightness(1)" }], { duration: 380, easing: "ease-out" });
  }

  // ---------- סנכרון אורות, פיידרים ומסכים למצב הנגן ----------
  function sync() {
    var act = activeChannel(), s = R.state, st = R.schedStatus();
    Object.keys(chans).forEach(function (ch) {
      var c = chans[ch], on = act === ch;
      c.strip.classList.toggle("is-on", on);
      $('[data-act="on"]', c.strip).classList.toggle("lit", on);
      if (!c.fader.dragging) c.fader.set(on ? ON_LEVEL : 0);
      $(".knob", c.strip).style.setProperty("--rot", on ? "35deg" : "-40deg");
      var status = $("[data-status]", c.strip);
      if (ch === "live") status.textContent = on ? "ON AIR" : st.live ? "חי עכשיו" : nextLive(st);
      else status.textContent = on ? "PLAY" : count(ch) + " פרקים";
    });
    var auto = $('[data-act="auto"]'); if (auto) auto.classList.toggle("lit", autoOn());
    $("#onairLamp").classList.toggle("on", act === "live");
    $(".knob", masterStrip).style.setProperty("--rot", (-130 + R.getVolume() * 2.6) + "deg");
  }
  function count(cat) { return (R.state.episodes || []).filter(function (e) { return e.category === cat; }).length; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function nextLive(st) {
    if (!st.next) return "—";
    var m = st.next.start % 1440;
    return "חי ב-" + pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
  }
  document.addEventListener("radio:update", sync);
  setInterval(sync, 2000);

  // ---------- מדי לדים: לפי המחוגים של ה-VU במסך ----------
  var needles = $$(".vu .needle");
  function angle(n) { var m = /rotate\((-?[\d.]+)deg\)/.exec(n.style.transform || ""); return m ? +m[1] : -50; }
  var ladders = strips.map(function (st) { return { strip: st, segs: $$(".ladder i", st), shown: -1, peak: 0, peakT: 0 }; });
  function meters(t) {
    var lvl = needles.length ? Math.max(0, Math.min(1, ((angle(needles[0]) + angle(needles[needles.length - 1])) / 2 + 50) / 100)) : 0;
    var act = activeChannel();
    ladders.forEach(function (L, idx) {
      var ch = L.strip.getAttribute("data-ch");
      var live = ch === "master" ? lvl : (ch === act ? lvl : 0);
      // ריצוד קטן לכל ערוץ, כדי שהמדים "ינשמו" כמו במיקסר אמיתי
      if (live > 0) live = Math.max(0, Math.min(1, live + Math.sin(t / 90 + idx * 1.7) * 0.04));
      var n = Math.round(live * SEGS);
      if (n >= L.peak) { L.peak = n; L.peakT = t; } else if (t - L.peakT > 700) { L.peak = Math.max(n, L.peak - 1); L.peakT = t - 550; }
      var key = n * 100 + L.peak;
      if (key === L.shown) return; L.shown = key;
      for (var i = 0; i < SEGS; i++) L.segs[i].classList.toggle("on", i < n || (i === L.peak - 1 && L.peak > 0));
    });
  }

  // ---------- שעון דיגיטלי עם שניות (שעון ישראל) ----------
  var clockFmt = null;
  try { clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); } catch (e) {}
  var digits = $("#bigClock .digits"), lastClock = "";
  function clock() {
    var d = new Date();
    var txt = clockFmt ? clockFmt.format(d) : pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    if (txt === lastClock) return; lastClock = txt;
    digits.innerHTML = txt.replace(/:/g, '<span class="colon">:</span>');
  }

  // ---------- לולאה אחת לכל התנועה ----------
  var faders = Object.keys(chans).map(function (k) { return chans[k].fader; }).concat([master]);
  (function loop(t) {
    faders.forEach(function (f) { f.step(); });
    meters(t || 0);
    requestAnimationFrame(loop);
  })();
  clock(); setInterval(clock, 250);

  // פתיחה: הפיידרים "עושים בדיקת מנוע" – עולים יחד ויורדים למקום, כמו מיקסר שנדלק
  function bootFaders() {
    faders.forEach(function (f, i) { f.set(0, true); });
    setTimeout(function () {
      faders.forEach(function (f, i) { setTimeout(function () { f.set(1); }, i * 90); });
      setTimeout(function () { master.set(R.getVolume() / 100); sync(); }, 900);
    }, 700);
  }
  if (REDUCE) sync(); else bootFaders();

  // פד "מוזיקה": הכנה לרשימת השירים שמתנגנים – בינתיים הודעה קצרה
  var music = $("#btnMusic");
  if (music) music.addEventListener("click", function () {
    flash(music);
    if (R.toast) R.toast("רשימת השירים – בקרוב");
  });

  // מקלדת: 1/3/7 = ערוצים (טלפונים כשרים)
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") return;
    var map = { "1": "live", "3": "מאסטר פליי", "7": "לילה מנצח" };
    if (map[e.key]) { var ch = map[e.key]; if (isActive(ch)) R.stop(); else activate(ch); setTimeout(sync, 60); }
  });
})();
