/* ══════════════════════════════════════════════════════════════
   HITSTER TUTI — service worker

   Hace dos cosas:
   1. Guarda la app en el teléfono para que abra al instante, incluso
      con el wifi de la casa de alguien más.
   2. Le da a Chrome en Android la señal que necesita para ofrecer
      «Instalar app» de forma prominente.

   El mazo (cartas.json) va por red primero: así, cuando subas una
   versión nueva al repositorio, el teléfono la toma sin que tengas
   que borrar nada. Si no hay red, usa la última copia guardada.
   ══════════════════════════════════════════════════════════════ */

const VERSION = 'tuti-v1';
const CONCHA = [
  './', './index.html', './auth.js', './jsqr.js',
  './manifest.json', './icono-192.png', './icono-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(CONCHA))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // si algo falla, igual instalamos
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // iTunes y Spotify: nunca se cachean

  // Clave sin ?parámetros, para no llenar la caché de copias del mismo archivo
  const clave = new Request(url.origin + url.pathname);

  const guardar = r => {
    if (r && r.ok && r.type === 'basic'){
      const copia = r.clone();
      return caches.open(VERSION).then(c => c.put(clave, copia)).then(() => r);
    }
    return r;
  };

  // El mazo: red primero, caché como respaldo
  if (url.pathname.endsWith('cartas.json')){
    e.respondWith(
      fetch(req).then(guardar).catch(() => caches.match(clave))
    );
    return;
  }

  // El resto: se sirve la copia guardada al instante y en paralelo se busca
  // la versión nueva para la próxima vez. Así la app abre al toque y aun así
  // tus cambios en GitHub llegan solos, sin tener que borrar nada.
  //
  // waitUntil va aquí, sincrónico: si no, el navegador puede apagar el service
  // worker antes de que alcance a guardar, y la actualización nunca llegaría.
  const actualizar = fetch(req).then(guardar).catch(() => null);
  e.waitUntil(actualizar);
  e.respondWith(
    caches.match(clave).then(hit => hit || actualizar.then(r => r || fetch(req)))
  );
});
