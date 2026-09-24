// Deliberately network-only: no clinical records, authentication pages or API
// responses are ever written to the service-worker CacheStorage.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, {cache: 'no-store'}).catch(() => new Response(
    '<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meditaly Clinica</title><body style="font:18px system-ui;padding:32px;color:#193e5a"><h1>Connessione necessaria</h1><p>Per proteggere i dati dei pazienti, l’area medica non conserva schede cliniche offline. Riconnettiti e riapri l’app.</p></body></html>',
    {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}
  )));
});
