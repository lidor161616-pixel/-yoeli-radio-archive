/* ==========================================================================
   DIKMAN FM – לוגיקת האפליקציה
   JavaScript רגיל, בלי פריימוורק ובלי בנייה: עובד גם בדפדפנים ישנים
   של טלפונים כשרים ומסוננים (Android WebView 60+, iOS Safari 12+).
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.RADIO_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var audio = $("audio");

  // ---------- אחסון מקומי (עמיד לשגיאות) ----------
  function load(key, def) { try { var v = localStorage.getItem("ngn." + key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function save(key, val) { try { localStorage.setItem("ngn." + key, JSON.stringify(val)); } catch (e) {} }

  var state = {
    mode: null,          // "live" | "ep"
    item: null,
    queue: [],           // הרשימה שממנה מנגנים (למעבר הבא/הקודם)
    episodes: [],
    cat: "הכל",
    q: "",
    tab: "live",
    favs: load("favs", []),
    pos: load("pos", {}),
    auto: false,         // הרדיו האוטומטי שולט (חי / שידורים חוזרים)
    bag: load("bag", []),
    liveDownUntil: 0,
    wasLive: false,
    liveTitle: "",
    pendingRadio: false,
    channel: null,       // ערוץ ארכיון שנבחר במיקסר (קטגוריה) או null = הכול
    manualLive: false,   // שידור חי שהופעל ידנית מהמיקסר – לא מנתקים אותו אוטומטית
    stopping: false,
    retries: 0,
    closed: null
  };

  // ---------- עזרים ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }
  function fmtDuration(sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return m + " דק׳";
    return Math.floor(m / 60) + ":" + pad(m % 60) + " שע׳";
  }
  // תאריך: "12 בנוב׳" לשנה הנוכחית, "12.11.19" לשנים קודמות (הארכיון מ-2017)
  var dateFmt = null, thisYear = new Date().getFullYear();
  try { dateFmt = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }); } catch (e) {}
  function fmtDate(s) {
    var p = s.split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (+p[0] !== thisYear) return (+p[2]) + "." + p[1] + "." + p[0].slice(2);
    return dateFmt ? dateFmt.format(d) : d.getDate() + "/" + (d.getMonth() + 1);
  }
  function gematria(n) {
    if (n === 15) return "ט״ו"; if (n === 16) return "ט״ז";
    var tens = ["", "י", "כ", "ל"], ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
    var s = tens[Math.floor(n / 10)] + ones[n % 10];
    return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳";
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2800);
  }

  // ---------- שעון ותאריך עברי ----------
  // השעון והתאריך תמיד בשעון ישראל, כמו לוח השידורים
  var hebFmt = null, clockFmt = null;
  try { hebFmt = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" }); } catch (e) {}
  try { clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); } catch (e) {}
  function tickClock() {
    var now = new Date();
    $("lcdClock").textContent = clockFmt ? clockFmt.format(now) : pad(now.getHours()) + ":" + pad(now.getMinutes());
    if (hebFmt && hebFmt.formatToParts) {
      var out = hebFmt.formatToParts(now).map(function (p) { return p.type === "day" ? gematria(+p.value) : p.value; }).join("");
      $("lcdDate").textContent = out;
    }
  }

  // ---------- מדי VU ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  var CX = 80, CY = 88, R = 66, SPAN = 50; // מעלות לכל צד
  function polar(frac, r) { var a = (-SPAN + frac * SPAN * 2) * Math.PI / 180; return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; }
  function arcPath(f0, f1, r) { var a = polar(f0, r), b = polar(f1, r); return "M" + a[0] + " " + a[1] + " A" + r + " " + r + " 0 0 1 " + b[0] + " " + b[1]; }

  function buildVU(svg) {
    var HOT = 0.74;
    el("path", { d: arcPath(0, HOT, R), "class": "arc" }, svg);
    el("path", { d: arcPath(HOT, 1, R + 2), "class": "arc hot" }, svg);
    var marks = [[0, "20"], [0.24, "10"], [0.37, "7"], [0.47, "5"], [0.58, "3"], [0.66, "2"], [HOT, "0"], [0.87, "+2"], [1, "+3"]];
    marks.forEach(function (m) {
      var hot = m[0] > HOT - 0.01 && m[1] !== "0";
      var a = polar(m[0], R + 1), b = polar(m[0], R + 8), t = polar(m[0], R + 15);
      el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "class": "tick major" + (hot ? " hot" : "") }, svg);
      var tx = el("text", { x: t[0], y: t[1] + 3, "text-anchor": "middle", "class": "lbl" + (hot ? " hot" : "") }, svg);
      tx.textContent = m[1];
    });
    for (var f = 0.04; f < 1; f += 0.06) {
      var a = polar(f, R + 1), b = polar(f, R + 4);
      el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "class": "tick" + (f > 0.74 ? " hot" : "") }, svg);
    }
    var name = el("text", { x: CX, y: 64, "text-anchor": "middle", "class": "name" }, svg); name.textContent = "VU";
    var needle = el("line", { x1: CX, y1: CY, x2: CX, y2: CY - R - 6, "class": "needle" }, svg);
    el("circle", { cx: CX, cy: CY, r: 5, "class": "hub" }, svg);
    return needle;
  }
  var needles = [buildVU($("vuL")), buildVU($("vuR"))];
  var meterVal = [0, 0];
  var analysers = null, actx = null;

  function setupAnalysers() {
    if (analysers || !(window.AudioContext || window.webkitAudioContext)) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var src = actx.createMediaElementSource(audio);
      var split = actx.createChannelSplitter(2);
      var l = actx.createAnalyser(), r = actx.createAnalyser();
      l.fftSize = r.fftSize = 1024;
      src.connect(split); split.connect(l, 0); split.connect(r, 1);
      src.connect(actx.destination);
      analysers = [l, r];
    } catch (e) { analysers = null; }
  }
  var buf = new Float32Array(1024);
  function rms(an) {
    if (an.getFloatTimeDomainData) an.getFloatTimeDomainData(buf);
    var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function meterLoop(t) {
    var playing = !audio.paused && !audio.ended && audio.readyState > 2;
    for (var ch = 0; ch < 2; ch++) {
      var target = 0;
      if (playing) {
        if (analysers) {
          // RMS → dB → מיקום בסקאלה (−20dB..+3dB)
          var db = 20 * Math.log(Math.max(rms(analysers[ch]), 1e-5)) / Math.LN10 + 18;
          target = Math.max(0, Math.min(1, (db + 20) / 23));
        } else {
          // תנועה מדומה (אין גישה לנתוני השמע בלי CORS)
          var x = t / 1000 + ch * 1.7;
          target = 0.52 + 0.14 * Math.sin(x * 2.3) + 0.08 * Math.sin(x * 5.1 + ch) + (Math.random() - 0.5) * 0.12;
        }
      }
      // בליסטיקה של מחוג: עולה מהר, יורד לאט
      var k = target > meterVal[ch] ? 0.35 : 0.08;
      meterVal[ch] += (target - meterVal[ch]) * k;
      needles[ch].style.transform = "rotate(" + (-SPAN + meterVal[ch] * SPAN * 2).toFixed(2) + "deg)";
    }
    requestAnimationFrame(meterLoop);
  }

  // ---------- תצוגת הקונסולה ----------
  function setTitle(text) {
    var box = $("lcdTitle");
    box.classList.remove("scroll");
    box.innerHTML = "<span>" + esc(text) + "</span>";
    requestAnimationFrame(function () {
      var span = box.firstChild, diff = span.scrollWidth - box.clientWidth;
      if (diff > 4) { box.style.setProperty("--shift", (diff + 48) + "px"); box.classList.add("scroll"); }
    });
  }

  var TAGS = { live: "LIVE", replay: "REPLAY", ep: "REC" };
  function updateDeck() {
    var it = state.item, m = state.mode;
    var tag = $("lcdTag");
    tag.textContent = TAGS[m] || (schedStatus().live ? "LIVE" : "REPLAY");
    tag.className = "lcd-tag" + (m === "live" || (!m && schedStatus().live) ? "" : " rec");
    if (!it) {
      var st = schedStatus();
      setTitle(st.live ? CFG.live.program : "הקישו על נגן כדי להאזין");
      $("lcdSub").textContent = st.live ? CFG.live.stationLabel + " · שידור חי עכשיו" : CFG.stationName + " · שידורים חוזרים";
    } else if (m === "live") {
      setTitle(state.liveTitle || CFG.live.program);
      $("lcdSub").textContent = CFG.live.stationLabel + " · שידור חי";
    } else {
      setTitle(it.title);
      $("lcdSub").textContent = (m === "replay" ? "שידור חוזר · " : "") + it.category + " · " + fmtDate(it.date);
    }
    $("progress").hidden = m === "live" || !it;
    $("btnBack").disabled = $("btnFwd").disabled = m === "live" || !it;
    markActive();
    setMediaSession();
    setPlayUI();
  }

  function setPlayUI() {
    var b = $("btnPlay"), playing = !audio.paused;
    b.classList.toggle("is-playing", playing);
    b.setAttribute("aria-label", playing ? "השהה" : "נגן");
    document.body.classList.toggle("paused", !playing);
    var oa = $("onair"), m = state.mode, liveNow = schedStatus().live;
    var liveOn = playing && m === "live";
    oa.classList.toggle("is-live", liveOn || (!playing && liveNow));
    $("onairText").textContent = liveOn ? "משדר חי" :
      playing ? (m === "replay" ? "שידור חוזר" : "מנגן") :
      liveNow ? "חי עכשיו" : "מוכן";
    var r = $("btnRadio");
    if (r) r.textContent = playing && state.auto ? "מאזינים עכשיו" : (liveNow ? "האזנה לשידור החי" : "האזנה לרדיו");
    if (r) r.classList.toggle("is-on", playing && state.auto);
    try { document.dispatchEvent(new CustomEvent("radio:update")); } catch (e) {}
  }
  function setLoading(on) { $("btnPlay").classList.toggle("is-loading", !!on); }

  function updateProgress() {
    if (state.mode === "live" || !state.item) return;
    var d = audio.duration, c = audio.currentTime;
    var p = isFinite(d) && d > 0 ? c / d * 100 : 0;
    $("progressFill").style.width = p + "%";
    $("progressHead").style.right = p + "%";
    $("progressTrack").setAttribute("aria-valuenow", Math.round(p));
    $("tCur").textContent = fmtTime(c);
    $("tDur").textContent = fmtTime(d);
  }

  // ---------- לוח שידורים ----------
  function schedStatus() {
    var st = window.Schedule.status(CFG);
    if (location.hash === "#live-preview") { st.live = true; st.endsInMin = 45; }
    return st;
  }
  function liveAvailable() { return !!(CFG.live.url || CFG.demo) && Date.now() > state.liveDownUntil; }

  // ---------- השמעה ----------
  function srcFor(ep) { return ep.url || (CFG.demo ? window.DemoAudio.url(ep.id, 44) : ""); }

  function start(src, opts) {
    state.stopping = false;
    audio.loop = !!(opts && opts.loop);
    audio.src = src;
    setLoading(true);
    if (CFG.realMeters || src.indexOf("blob:") === 0) setupAnalysers();
    if (actx && actx.state === "suspended") actx.resume();
    var p = audio.play();
    if (p && p.catch) p.catch(function (err) {
      setLoading(false);
      if (err && err.name === "NotAllowedError") toast("הקישו על נגן כדי להתחיל");
      else if (err && err.name !== "AbortError") toast("לא ניתן לנגן כרגע");
    });
  }

  function liveSrc() {
    if (!CFG.live.url) return window.DemoAudio.url("live-demo", 32);
    var u = CFG.live.url;
    if (/\.m3u8(\?|$)/.test(u) && !audio.canPlayType("application/vnd.apple.mpegurl")) {
      toast("פורמט HLS דורש תמיכה נוספת במכשיר זה");
    }
    // פרמטר ייחודי: חיבור טרי לקצה השידור, בלי באפר ישן
    return u + (u.indexOf("?") > -1 ? "&" : "?") + "_=" + Date.now();
  }

  // מקור הרדיו האוטומטי: שידור חי בזמן החלון, אחרת שידורים חוזרים
  function playRadio() {
    if (guardClosed()) return;
    state.channel = null; state.manualLive = false;
    if (schedStatus().live && liveAvailable()) playLiveNow();
    else playReplayNext();
  }

  function playLiveNow(manual) {
    if (guardClosed()) return;
    state.mode = "live"; state.auto = !manual; state.retries = 0; state.manualLive = !!manual;
    state.item = { id: "live", title: CFG.live.program };
    updateDeck();
    start(liveSrc(), { loop: !CFG.live.url });
  }

  // שקית ערבוב: כל ההקלטות מתנגנות לפני שמשהו חוזר
  function rotationPool() {
    var c = state.channel || CFG.rotation.category;
    return state.episodes.filter(function (ep) { return !c || ep.category === c; });
  }
  function nextFromBag() {
    var pool = rotationPool();
    if (!pool.length) return null;
    var ids = pool.map(function (e) { return e.id; });
    state.bag = state.bag.filter(function (id) { return ids.indexOf(id) > -1; });
    if (!state.bag.length) {
      state.bag = ids.slice();
      if (CFG.rotation.shuffle) for (var i = state.bag.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = state.bag[i]; state.bag[i] = state.bag[j]; state.bag[j] = t; }
      // לא להתחיל סבב חדש עם אותה הקלטה שהסתיימה הרגע
      if (state.bag.length > 1 && state.item && state.bag[0] === state.item.id) state.bag.push(state.bag.shift());
    }
    var id = state.bag.shift(); save("bag", state.bag);
    return pool.filter(function (e) { return e.id === id; })[0];
  }

  function playReplayNext(tries) {
    if (guardClosed()) return;
    tries = typeof tries === "number" ? tries : 0;
    var ep = nextFromBag();
    if (!ep) { toast("הארכיון עדיין נטען…"); state.pendingRadio = true; return; }
    var src = srcFor(ep);
    if (!src) {
      // הקלטה בלי קובץ שמע – מדלגים לבאה, אבל לא יותר מסבב שלם (בלי לולאה אינסופית)
      state.item = ep;
      if (tries < rotationPool().length) playReplayNext(tries + 1);
      else { setLoading(false); toast("אין כרגע הקלטות זמינות להשמעה"); }
      return;
    }
    state.mode = "replay"; state.auto = true; state.item = ep; state.queue = rotationPool();
    updateDeck();
    start(src);
  }

  // בחירה ידנית מהארכיון
  function playEpisode(ep, queue) {
    if (guardClosed()) return;
    var src = srcFor(ep);
    if (!src) { toast("הקובץ עדיין לא זמין"); return; }
    state.mode = "ep"; state.auto = false; state.item = ep; state.queue = queue || state.episodes;
    updateDeck();
    var resume = state.pos[ep.id] || 0;
    var once = function () {
      audio.removeEventListener("loadedmetadata", once);
      if (resume > 5 && isFinite(audio.duration) && resume < audio.duration - 10) audio.currentTime = resume;
    };
    audio.addEventListener("loadedmetadata", once);
    start(src);
  }

  function stopAudio() {
    state.stopping = true;
    audio.pause();
    // בשידור חי: מנתקים כדי לא לצרוך נתונים ברקע
    if (state.mode === "live" && CFG.live.url) { audio.removeAttribute("src"); audio.load(); }
  }

  function togglePlay() {
    if (!audio.paused) { stopAudio(); return; }
    if (guardClosed()) return;
    var st = schedStatus();
    // אין כלום / חזרה לשידור חי / לוח השידורים השתנה בזמן ההשהיה → הרדיו מחליט מחדש
    if (!state.item || state.mode === "live" || (state.auto && st.live && liveAvailable())) { playRadio(); return; }
    if (actx && actx.state === "suspended") actx.resume();
    var p = audio.play(); if (p && p.catch) p.catch(function () {});
  }

  function seek(delta) {
    if (state.mode === "live" || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration - 0.5, audio.currentTime + delta));
  }

  function step(dir) {
    if (state.mode === "live") return;
    if (state.mode === "replay" && dir > 0) { playReplayNext(); return; }
    var q = state.queue, i = q.indexOf(state.item);
    if (i < 0 || !q.length) return;
    playEpisode(q[(i + dir + q.length) % q.length], q);
  }

  // מעבר אוטומטי בין שידור חי לשידורים חוזרים – נבדק כל 10 שניות
  function tickSchedule() {
    var st = schedStatus(), playing = !audio.paused || $("btnPlay").classList.contains("is-loading");
    var liveNow = st.live && liveAvailable();
    if (playing) {
      if (liveNow && state.mode !== "live" && (state.auto || !state.wasLive)) {
        // התחיל שידור חי (או חזר לפעול אחרי תקלה)
        toast("עוברים לשידור החי");
        playLiveNow();
      } else if (!st.live && state.mode === "live" && !state.manualLive) {
        toast("השידור החי הסתיים – ממשיכים בשידורים חוזרים");
        playReplayNext();
      }
    }
    state.wasLive = st.live;
    renderNow(st);
    setPlayUI();
  }

  // אירועי נגן
  audio.addEventListener("playing", function () { setLoading(false); state.retries = 0; setPlayUI(); });
  audio.addEventListener("pause", setPlayUI);
  audio.addEventListener("waiting", function () { setLoading(true); });
  audio.addEventListener("canplay", function () { setLoading(false); });
  var lastSave = 0;
  audio.addEventListener("timeupdate", function () {
    updateProgress();
    if (state.mode === "ep" && Date.now() - lastSave > 4000) {
      lastSave = Date.now();
      state.pos[state.item.id] = Math.floor(audio.currentTime);
      save("pos", state.pos);
      var bar = document.querySelector('.track.is-active .track-prog i');
      if (bar && audio.duration) bar.style.width = (audio.currentTime / audio.duration * 100) + "%";
    }
  });
  audio.addEventListener("ended", function () {
    if (state.mode === "ep") { delete state.pos[state.item.id]; save("pos", state.pos); }
    // בסוף כל הקלטה – הרדיו ממשיך (נשארים בערוץ שנבחר במיקסר, אלא אם התחיל שידור חי)
    if (state.mode !== "live") {
      if (state.channel && !(schedStatus().live && liveAvailable())) playReplayNext(); else playRadio();
    }
  });
  audio.addEventListener("error", function () {
    if (state.stopping || !state.item) return;
    setLoading(false);
    if (state.mode === "live") {
      if (state.retries < 3) {
        state.retries++;
        toast("מתחבר מחדש לשידור…");
        setTimeout(function () { if (!state.stopping && state.mode === "live") start(liveSrc()); }, 1500 * state.retries);
      } else {
        // השידור לא זמין: ממשיכים בשידורים חוזרים ומנסים שוב בעוד 2 דקות
        state.liveDownUntil = Date.now() + 120000;
        toast("השידור החי אינו זמין כרגע – ממשיכים בשידורים חוזרים");
        playReplayNext();
      }
    } else if (state.mode === "replay") {
      playReplayNext();
    } else {
      toast("לא ניתן לטעון את ההקלטה");
      setPlayUI();
    }
  });

  // ---------- Media Session (מסך נעילה, אוזניות, רכב) ----------
  function setMediaSession() {
    if (!("mediaSession" in navigator) || !state.item) return;
    var live = state.mode === "live", it = state.item;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: live ? (state.liveTitle || CFG.live.program) : it.title,
        artist: live ? CFG.live.stationLabel : CFG.stationName,
        album: live ? "שידור חי" : (state.mode === "replay" ? "שידור חוזר" : it.category),
        artwork: [{ src: new URL("icons/icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }]
      });
    } catch (e) {}
  }
  if ("mediaSession" in navigator) {
    var ms = navigator.mediaSession;
    var set = function (a, fn) { try { ms.setActionHandler(a, fn); } catch (e) {} };
    set("play", togglePlay); set("pause", togglePlay); set("stop", stopAudio);
    set("previoustrack", function () { step(-1); }); set("nexttrack", function () { step(1); });
    set("seekbackward", function () { seek(-15); }); set("seekforward", function () { seek(15); });
  }

  // ---------- לשונית "עכשיו": מצב, ספירה לאחור, לוח שידורים ----------
  var DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  function hm(min) { min = Math.round(min) % 1440; return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
  function countdown(min) {
    min = Math.ceil(min);
    if (min < 60) return "בעוד " + min + " דק׳";
    if (min < 1440) return "בעוד " + Math.floor(min / 60) + ":" + pad(min % 60) + " שע׳";
    var d = Math.floor(min / 1440);
    return d === 1 ? "בעוד יום" : "בעוד " + d + " ימים";
  }
  function whenLabel(w, nowMin) {
    var today = Math.floor(nowMin / 1440), from = w.start % 1440;
    if (w.day === today) return "היום ב-" + hm(from);
    if (w.day === (today + 1) % 7) return (from < 360 ? "הלילה ב-" : "מחר ב-") + hm(from);
    return "ביום " + DAY_NAMES[w.day] + " ב-" + hm(from);
  }
  function rowTitle(w) { var from = w.start % 1440; return from < 360 ? "ליל " + DAY_NAMES[(w.day + 6) % 7] : "יום " + DAY_NAMES[w.day]; }

  function renderNow(st) {
    st = st || schedStatus();
    var m = window.Schedule.weekMinute();
    var badge = $("nowBadge");
    badge.textContent = st.live ? "שידור חי עכשיו" : "שידורים חוזרים";
    badge.className = "now-badge" + (st.live ? " live" : "");
    $("nowTitle").textContent = st.live ? CFG.live.program : "המיטב מהארכיון, ברצף";
    $("nowSub").textContent = st.live ? CFG.live.stationLabel + " · מסתיים " + countdown(st.endsInMin) : "עד השידור החי הבא";
    $("nowNext").innerHTML = st.next ? '<span>השידור החי הבא</span><b>' + esc(whenLabel(st.next, m)) + '</b><span class="count">' + esc(countdown(st.nextInMin)) + '</span>' : "";
    // לוח שבועי
    var ws = window.Schedule.windows(CFG).sort(function (a, b) { return a.start - b.start; });
    $("schedList").innerHTML = ws.map(function (w) {
      var on = m >= w.start && m < w.end;
      var isNext = !st.live && st.next === w;
      return '<li class="sched-row' + (on ? " on" : "") + (isNext ? " next" : "") + '">' +
        '<span class="sched-day">' + esc(rowTitle(w)) + '</span>' +
        '<span class="sched-time mono">' + hm(w.start % 1440) + '–' + hm(w.end % 1440) + '</span>' +
        '<span class="sched-tag">' + (on ? "חי עכשיו" : isNext ? "הבא" : "") + '</span></li>';
    }).join("");
  }
  $("btnRadio").addEventListener("click", function () {
    if (!audio.paused && state.auto) { stopAudio(); return; }
    playRadio();
  });

  // "מתנגן עכשיו" בשידור החי (Icecast)
  function pollNowPlaying() {
    if (!CFG.live.nowPlaying || !window.fetch) return;
    fetch(CFG.live.nowPlaying, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      var src = j.icestats && j.icestats.source; if (Array.isArray(src)) src = src[0];
      var title = src && src.title;
      if (title && title !== state.liveTitle) { state.liveTitle = title; if (state.mode === "live") updateDeck(); }
    }).catch(function () {});
  }

  // ---------- ארכיון ----------
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5.5v13L6.5 12z"/></svg>';
  var ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z"/></svg>';
  function trackHTML(ep, i) {
    var fav = state.favs.indexOf(ep.id) > -1;
    var pos = state.pos[ep.id] || 0, pct = ep.duration ? Math.min(100, pos / ep.duration * 100) : 0;
    return '<li class="track" data-ep="' + esc(ep.id) + '">' +
      '<span class="track-n">' + pad(i + 1) + '</span>' +
      '<button class="track-main" data-nav data-act="play">' +
        '<span class="track-title">' + esc(ep.title) + '</span>' +
        '<span class="track-meta"><span class="cat">' + esc(ep.category) + '</span><span class="sep">·</span><span>' + fmtDate(ep.date) + '</span><span class="sep">·</span><span>' + fmtDuration(ep.duration) + '</span></span>' +
        (pct > 1 ? '<span class="track-prog"><i style="width:' + pct + '%"></i></span>' : '') +
      '</button>' +
      '<button class="icon-btn fav" data-nav data-act="fav" aria-pressed="' + fav + '" aria-label="' + (fav ? "הסרה מהשמורים" : "שמירה") + '">' + ICON_STAR + '</button>' +
      '<button class="icon-btn go" data-nav data-act="play" aria-label="נגן">' + ICON_PLAY + '</button>' +
      '</li>';
  }
  function filtered() {
    var q = state.q.trim();
    return state.episodes.filter(function (ep) {
      return (state.cat === "הכל" || ep.category === state.cat) && (!q || ep.title.indexOf(q) > -1 || ep.category.indexOf(q) > -1);
    });
  }
  // טעינה הדרגתית – אלפי פרקים בבת אחת מכבידים על טלפונים חלשים
  var PAGE = 60, shown = PAGE;
  function renderArchive(keep) {
    if (!keep) shown = PAGE;
    var list = filtered(), page = list.slice(0, shown);
    $("trackList").innerHTML = page.map(trackHTML).join("") || '<li class="empty">לא נמצאו הקלטות</li>';
    var meta = $("archiveMeta");
    if (!list.length) meta.innerHTML = "";
    else if (list.length > shown) meta.innerHTML = '<button class="more" id="btnMore" data-nav>הצגת עוד הקלטות</button><span>מוצגות ' + shown + ' מתוך ' + list.length.toLocaleString("he-IL") + '</span>';
    else meta.innerHTML = '<span>' + list.length.toLocaleString("he-IL") + ' הקלטות</span>';
    markActive();
  }
  $("archiveMeta").addEventListener("click", function (e) {
    if (!e.target.closest("#btnMore")) return;
    shown += PAGE; renderArchive(true);
    var items = document.querySelectorAll("#trackList [data-act=play]");
    var target = items[(shown - PAGE) * 2]; if (target) target.focus();
  });
  function renderFavs() {
    var list = state.episodes.filter(function (ep) { return state.favs.indexOf(ep.id) > -1; });
    $("favList").innerHTML = list.map(trackHTML).join("") || '<li class="empty">עדיין לא שמרתם הקלטות. הקישו על הכוכב ליד הקלטה כדי לשמור אותה כאן.</li>';
    markActive();
  }
  function renderChips() {
    var cats = ["הכל"];
    state.episodes.forEach(function (ep) { if (cats.indexOf(ep.category) < 0) cats.push(ep.category); });
    $("chips").innerHTML = cats.map(function (c) {
      return '<button class="chip" data-nav data-cat="' + esc(c) + '" aria-pressed="' + (c === state.cat) + '">' + esc(c) + '</button>';
    }).join("");
  }
  $("chips").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cat]"); if (!b) return;
    state.cat = b.getAttribute("data-cat"); renderChips(); renderArchive();
  });
  var qTimer;
  $("q").addEventListener("input", function (e) { clearTimeout(qTimer); qTimer = setTimeout(function () { state.q = e.target.value; renderArchive(); }, 150); });

  function onTrackClick(e, getQueue) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    var id = b.closest("[data-ep]").getAttribute("data-ep");
    var ep = state.episodes.filter(function (x) { return x.id === id; })[0]; if (!ep) return;
    if (b.getAttribute("data-act") === "fav") {
      var i = state.favs.indexOf(id);
      if (i > -1) state.favs.splice(i, 1); else state.favs.unshift(id);
      save("favs", state.favs);
      b.setAttribute("aria-pressed", i < 0);
      toast(i < 0 ? "נשמר בשמורים" : "הוסר מהשמורים");
      if (state.tab === "fav") renderFavs();
      return;
    }
    if (state.item === ep) togglePlay(); else playEpisode(ep, getQueue());
  }
  $("trackList").addEventListener("click", function (e) { onTrackClick(e, filtered); });
  $("favList").addEventListener("click", function (e) {
    onTrackClick(e, function () { return state.episodes.filter(function (ep) { return state.favs.indexOf(ep.id) > -1; }); });
  });

  function markActive() {
    var id = state.item && state.item.id;
    Array.prototype.forEach.call(document.querySelectorAll(".track"), function (li) {
      var on = (state.mode === "ep" || state.mode === "replay") && li.getAttribute("data-ep") === id;
      li.classList.toggle("is-active", on);
      var n = li.querySelector(".track-n");
      if (on && !n.querySelector(".eq")) { n.setAttribute("data-n", n.textContent); n.innerHTML = '<span class="eq"><i></i><i></i><i></i></span>'; }
      else if (!on && n.hasAttribute("data-n")) { n.textContent = n.getAttribute("data-n"); n.removeAttribute("data-n"); }
    });
  }

  function loadEpisodes() {
    var cached = load("episodes", null);
    if (cached) { state.episodes = cached; renderChips(); renderArchive(); }
    if (!window.fetch) return;
    fetch(CFG.episodesUrl, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      state.episodes = (j.items || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      save("episodes", state.episodes);
      renderChips(); renderArchive(); if (state.tab === "fav") renderFavs();
      if (state.pendingRadio) { state.pendingRadio = false; playRadio(); }
    }).catch(function () { if (!cached) $("archiveMeta").textContent = "הארכיון אינו זמין כרגע"; });
  }

  // ---------- לשוניות ----------
  var TABS = ["live", "archive", "fav"];
  function setTab(name, focus) {
    state.tab = name;
    TABS.forEach(function (t) {
      var b = $("tab-" + t), on = t === name;
      b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
      $("panel-" + t).hidden = !on;
      if (on && focus) b.focus();
    });
    if (name === "fav") renderFavs();
    save("tab", name);
  }
  document.querySelector(".seg").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) setTab(b.getAttribute("data-tab")); });
  document.querySelector(".seg").addEventListener("keydown", function (e) {
    var i = TABS.indexOf(state.tab);
    if (e.key === "ArrowLeft") { setTab(TABS[(i + 1) % 3], true); e.preventDefault(); }   // RTL: שמאלה = הבא
    if (e.key === "ArrowRight") { setTab(TABS[(i + 2) % 3], true); e.preventDefault(); }
  });

  // ---------- פקדי קונסולה ----------
  $("btnPlay").addEventListener("click", togglePlay);
  $("btnBack").addEventListener("click", function () { seek(-15); });
  $("btnFwd").addEventListener("click", function () { seek(15); });

  var track = $("progressTrack");
  function seekFromPointer(x) {
    var r = track.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (r.right - x) / r.width)); // RTL: מימין לשמאל
    if (isFinite(audio.duration)) { audio.currentTime = f * audio.duration; updateProgress(); }
  }
  var dragging = false;
  track.addEventListener("pointerdown", function (e) { dragging = true; try { track.setPointerCapture(e.pointerId); } catch (x) {} seekFromPointer(e.clientX); });
  track.addEventListener("pointermove", function (e) { if (dragging) seekFromPointer(e.clientX); });
  track.addEventListener("pointerup", function () { dragging = false; });
  track.addEventListener("pointercancel", function () { dragging = false; });
  track.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { seek(5); e.preventDefault(); e.stopPropagation(); }
    if (e.key === "ArrowRight") { seek(-5); e.preventDefault(); e.stopPropagation(); }
  });

  // עוצמה. ב-iOS העוצמה נשלטת רק מכפתורי המכשיר – לכן מסתירים את הפיידר.
  var vol = $("vol");
  function applyVol() {
    audio.volume = vol.value / 100;
    $("volVal").textContent = vol.value;
    vol.style.setProperty("--p", vol.value + "%");
    save("vol", +vol.value);
  }
  vol.value = load("vol", 85);
  vol.addEventListener("input", applyVol);
  applyVol();
  (function detectFixedVolume() {
    var before = audio.volume; audio.volume = 0.5;
    var fixed = audio.volume !== 0.5; audio.volume = before;
    var f = document.querySelector(".fader");
    if (fixed) { if (f) f.hidden = true; document.documentElement.classList.add("fixed-volume"); }
  })();

  // ---------- מקלדת / מקשי טלפון כשר ----------
  function navItems() {
    return Array.prototype.filter.call(document.querySelectorAll("[data-nav], .seg [aria-selected=true], .play, .tbtn, #q, #vol"), function (n) {
      return !n.disabled && n.offsetParent !== null;
    });
  }
  document.addEventListener("keydown", function (e) {
    var tag = e.target.tagName, typing = tag === "INPUT" && e.target.type !== "range";
    if (e.key === "MediaPlayPause") { togglePlay(); return; }
    if (typing) return;
    switch (e.key) {
      case "5": case " ": if (e.target.tagName !== "BUTTON" || e.key === "5") { togglePlay(); e.preventDefault(); } break;
      case "4": seek(-15); break;
      case "6": seek(15); break;
      case "2": step(-1); break;
      case "8": step(1); break;
      case "ArrowDown": case "ArrowUp":
        if (tag === "INPUT") return;
        var items = navItems(), i = items.indexOf(document.activeElement);
        var n = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (n) { n.focus(); if (n.scrollIntoView) n.scrollIntoView({ block: "nearest" }); }
        e.preventDefault();
        break;
    }
  });

  // ---------- שבת וחג ----------
  function guardClosed() {
    if (state.closed) { toast("השידורים מושבתים כעת"); return true; }
    return false;
  }
  function checkClosed() {
    var preview = location.hash === "#shabbat-preview";
    var st = preview ? { kind: "shabbat", until: new Date(Date.now() + 3600e3 * 20) } : window.Zmanim.closedState(new Date(), CFG.shabbat);
    state.closed = st;
    $("shabbat").hidden = !st;
    if (!st) return;
    if (!audio.paused) stopAudio();
    var holiday = st.kind === "holiday";
    $("shabbatTitle").textContent = holiday ? "חג שמח" : "שבת שלום";
    $("shabbatText").textContent = holiday ? "השידורים מושבתים בחג" + (st.name ? " " + st.name : "") + " ויחודשו בצאת החג." : "השידורים מושבתים בשבת ויחודשו במוצאי שבת.";
    $("shabbatTime").textContent = "חידוש השידורים: " + pad(st.until.getHours()) + ":" + pad(st.until.getMinutes());
  }
  window.addEventListener("hashchange", checkClosed);

  // ---------- התקנה כאפליקציה (מחשב וטלפון) ----------
  // כשהאתר רץ כאפליקציה מותקנת (חלון נפרד) – לא מציגים כפתור התקנה
  function isInstalled() {
    try { if (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: minimal-ui)").matches) return true; } catch (e) {}
    return window.navigator.standalone === true;
  }
  if (isInstalled()) document.documentElement.classList.add("is-app");
  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferredPrompt = e;
    if ($("installBtn") || isInstalled()) return;
    var b = document.createElement("button");
    b.id = "installBtn"; b.className = "onair"; b.textContent = "התקנת האפליקציה";
    b.style.marginInlineStart = "8px";
    b.addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (c) { if (c && c.outcome === "accepted") b.remove(); }).catch(function () {});
      deferredPrompt = null;
    });
    document.querySelector(".topbar").appendChild(b);
  });
  window.addEventListener("appinstalled", function () {
    var b = $("installBtn"); if (b) b.remove();
    deferredPrompt = null;
    toast("DIKMAN FM הותקנה במחשב");
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {}
  }

  // ---------- ממשק למיקסר (js/mixer.js) ----------
  window.RadioApp = {
    state: state, cfg: CFG, audio: audio,
    schedStatus: schedStatus,
    playRadio: playRadio,                                   // אוטומטי: חי בזמן התוכנית, אחרת ארכיון
    playLive: function () { playLiveNow(true); },           // השידור החי של התחנה, עד שמכבים
    playChannel: function (cat) {                           // שידורים חוזרים מתוכנית אחת
      if (guardClosed()) return;
      state.channel = cat; state.bag = []; state.manualLive = false; playReplayNext();
    },
    toggle: togglePlay, stop: stopAudio, seek: seek, next: function () { step(1); },
    toast: toast,
    setVolume: function (v) { vol.value = Math.round(v); applyVol(); },
    getVolume: function () { return +vol.value; }
  };

  // ---------- הפעלה ----------
  $("year").textContent = new Date().getFullYear();
  loadEpisodes();
  setTab(load("tab", "live"));
  updateDeck(); setPlayUI();
  tickClock(); setInterval(tickClock, 15000);
  checkClosed(); setInterval(checkClosed, 30000);
  state.wasLive = schedStatus().live;
  tickSchedule(); setInterval(tickSchedule, 10000);
  pollNowPlaying(); setInterval(pollNowPlaying, 30000);
  window.addEventListener("hashchange", function () { tickSchedule(); updateDeck(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) tickSchedule(); });
  requestAnimationFrame(meterLoop);
})();
