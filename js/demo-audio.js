/* ==========================================================================
   צליל הדגמה – נוצר בדפדפן כדי שהנגן יעבוד לפני שיש כתובות שידור אמיתיות.
   אפשר למחוק את הקובץ כש-config.demo = false.
   ========================================================================== */
(function () {
  var cache = {};
  // מהלכי אקורדים במינור (תדרים ב-Hz) – אווירה של ניגון שקט
  var PROGS = [
    [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]],
    [[196, 233.1, 293.7], [155.6, 196, 233.1], [174.6, 220, 261.6], [146.8, 185, 220]],
    [[246.9, 293.7, 370], [196, 246.9, 293.7], [220, 277.2, 329.6], [185, 220, 277.2]]
  ];

  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  function build(seed, seconds) {
    var sr = 22050, len = sr * seconds;
    var data = new Float32Array(len);
    var prog = PROGS[seed % PROGS.length];
    var barLen = seconds / prog.length;
    var step = 0.375 + (seed % 3) * 0.0625; // קצב הארפג'

    for (var i = 0; i < len; i++) {
      var t = i / sr;
      var chord = prog[Math.floor(t / barLen) % prog.length];
      // פד רך
      var pad = 0;
      for (var k = 0; k < 3; k++) pad += Math.sin(2 * Math.PI * chord[k] * t) * 0.06;
      pad *= 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.2 * t);
      // ארפג'יו פלאק
      var ni = Math.floor(t / step), nt = t - ni * step;
      var f = chord[ni % 3] * 2;
      var pluck = Math.sin(2 * Math.PI * f * nt) * Math.exp(-nt * 6) * 0.22;
      pluck += Math.sin(4 * Math.PI * f * nt) * Math.exp(-nt * 10) * 0.05;
      // בס
      var bass = Math.sin(2 * Math.PI * chord[0] / 2 * t) * 0.12;
      data[i] = pad + pluck + bass;
    }
    // פייד קצר בהתחלה ובסוף (לולאה חלקה)
    var fade = sr * 0.05;
    for (var j = 0; j < fade; j++) { data[j] *= j / fade; data[len - 1 - j] *= j / fade; }
    return toWav(data, sr);
  }

  function toWav(samples, sr) {
    var buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, samples.length * 2, true);
    for (var i = 0, o = 44; i < samples.length; i++, o += 2) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  window.DemoAudio = {
    url: function (key, seconds) {
      seconds = seconds || 32;
      var k = key + ":" + seconds;
      if (!cache[k]) cache[k] = build(hash(key), seconds);
      return cache[k];
    }
  };
})();
