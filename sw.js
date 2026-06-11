const CACHE_NAME = "checklist-vtr-v21";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=21",
  "./app.js?v=21",
  "./pdf.mjs?v=21",
  "./pdf.worker.mjs?v=21",
  "./pdf-lib.esm.min.js?v=21",
  "./pdf-transformer.js?v=21",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./14-cicom.png",
  "./anderson-gomes.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" }))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) =>
        Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)))
      )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isCode =
    event.request.mode === "navigate" ||
    ["script", "style", "worker"].includes(event.request.destination) ||
    /\.(?:js|mjs|css|html)$/.test(url.pathname);

  if (isCode) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
