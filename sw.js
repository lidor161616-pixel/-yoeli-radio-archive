/* Service Worker – מעטפת האפליקציה עובדת גם בלי רשת.
   שידורים חיים וקובצי שמע לא נשמרים במטמון (לא חוסמים, לא תופסים מקום). */
var VERSION = "ngn-v2";
var SHELL = [
  "./", "index.html", "css/app.css",
  "js/config.js", "js/zmanim.js", "js/schedule.js", "js/demo-audio.js", "js/app.js",
  "icons/icon.svg", "manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // שמע ושידור – תמיד ישר מהרשת
  if (req.destination === "audio" || req.headers.has("range") || /\.(mp3|aac|m4a|ogg|opus|m3u8)$/i.test(url.pathname)) return;
  if (url.origin !== location.origin) return;

  // רשימת הארכיון: רשת קודם, מטמון כגיבוי
  if (/episodes\.json$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); return res;
    }).catch(function () { return caches.match(req); }));
    return;
  }
  // שאר הקבצים: מטמון קודם, ועדכון ברקע
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
