/* ==========================================================================
   לוח שידורים: האם עכשיו שידור חי, ומתי השידור הבא.
   הכול לפי שעון ישראל – גם אם המאזין נמצא בחו"ל או שהשעון במכשיר שלו שגוי באזור זמן.
   ========================================================================== */
(function () {
  var WEEK = 7 * 1440;
  var DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch (e) {}

  function toMin(hhmm) { var p = hhmm.split(":"); return (+p[0]) * 60 + (+p[1]); }

  // מיקום עכשיו בשבוע, בדקות (כולל שבר של שניות)
  function weekMinute(now) {
    now = now || new Date();
    if (fmt && fmt.formatToParts) {
      var o = {};
      fmt.formatToParts(now).forEach(function (p) { o[p.type] = p.value; });
      var h = +o.hour % 24;
      return DAYS[o.weekday] * 1440 + h * 60 + (+o.minute) + (+o.second) / 60;
    }
    return now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  }

  // כל החלונות בשבוע כ-[התחלה, סוף) בדקות
  function windows(cfg) {
    var out = [], extra = cfg.liveExtraMinutes || 0;
    (cfg.schedule || []).forEach(function (s) {
      var from = toMin(s.from), to = toMin(s.to);
      if (to <= from) to += 1440;            // עובר חצות
      s.days.forEach(function (d) {
        out.push({ start: d * 1440 + from, end: d * 1440 + to + extra, slot: s, day: d });
      });
    });
    return out;
  }

  function status(cfg, now) {
    var m = weekMinute(now), ws = windows(cfg), live = null, next = null, nextIn = Infinity;
    ws.forEach(function (w) {
      // בודקים גם את השבוע הקודם, לחלון שעובר ממוצאי שבת לראשון
      [0, -WEEK].forEach(function (shift) {
        if (m >= w.start + shift && m < w.end + shift) live = { w: w, endsIn: (w.end + shift - m) };
      });
      var d = ((w.start - m) % WEEK + WEEK) % WEEK;
      if (d > 0 && d < nextIn) { nextIn = d; next = w; }
    });
    return {
      live: !!live,
      endsInMin: live ? live.endsIn : null,
      next: next,
      nextInMin: next ? nextIn : null
    };
  }

  window.Schedule = { status: status, windows: windows, toMin: toMin, weekMinute: weekMinute };
})();
