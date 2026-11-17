/* Service Worker – מעטפת האפליקציה עובדת גם בלי רשת.
   שידורים חיים וקובצי שמע לא נשמרים במטמון (לא חוסמים, לא תופסים מקום). */
var VERSION = "dikman-v5";
var SHELL = [
  "./", "index.html", "css/app.css",
  "css/motion.css", "css/mixer.css",
  "js/config.js", "js/zmanim.js", "js/schedule.js", "js/demo-audio.js", "js/app.js", "js/motion.js", "js/mixer.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png", "manifest.webmanifest"
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
  // שאר הקבצים: רשת קודם (כדי שעדכון באתר יגיע מיד ובשלמותו), מטמון כגיבוי כשאין רשת
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()); });
  }));
});
