/* ==========================================================================
   חישוב שקיעה ומצב שבת/חג
   אלגוריתם "משוואת הזריחה" (NOAA המקוצר) – דיוק של כדקה, מספיק לחסימת שידור.
   לזמנים הלכתיים מדויקים לפרסום – להשתמש בלוח מוסמך.
   ========================================================================== */
(function () {
  var RAD = Math.PI / 180;

  function sunset(date, lat, lng) {
    var J = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5 + 2440587.5;
    var n = Math.ceil(J - 2451545 + 0.0008);
    var Js = n - lng / 360;
    var M = (357.5291 + 0.98560028 * Js) % 360;
    var C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
    var L = (M + C + 180 + 102.9372) % 360;
    var Jt = 2451545 + Js + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
    var sd = Math.sin(L * RAD) * Math.sin(23.4397 * RAD);
    var cd = Math.cos(Math.asin(sd));
    var cw = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sd) / (Math.cos(lat * RAD) * cd);
    var w = Math.acos(cw) / RAD;
    return new Date((Jt + w / 360 - 2440587.5) * 864e5);
  }

  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function parseDay(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12); }

  // מחזיר null אם מותר לשדר, או {kind, until} אם עכשיו שבת/חג
  function closedState(now, cfg) {
    if (!cfg || !cfg.enabled) return null;
    var c = cfg.candleMinutes * 6e4, h = cfg.havdalaMinutes * 6e4;
    var day = now.getDay(); // 5 = שישי, 6 = שבת

    // שבת
    var fri = addDays(now, day === 6 ? -1 : 5 - day);
    if (day === 5 || day === 6) {
      var start = sunset(fri, cfg.lat, cfg.lng).getTime() - c;
      var end = sunset(addDays(fri, 1), cfg.lat, cfg.lng).getTime() + h;
      if (now >= start && now < end) return { kind: "shabbat", until: new Date(end) };
    }
    // חגים
    var list = cfg.holidays || [];
    for (var i = 0; i < list.length; i++) {
      var s = sunset(parseDay(list[i].start), cfg.lat, cfg.lng).getTime() - c;
      var e = sunset(parseDay(list[i].end), cfg.lat, cfg.lng).getTime() + h;
      if (now >= s && now < e) return { kind: "holiday", name: list[i].name, until: new Date(e) };
    }
    return null;
  }

  window.Zmanim = { sunset: sunset, closedState: closedState };
})();
