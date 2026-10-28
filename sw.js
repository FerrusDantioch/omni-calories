/* Service Worker d'Omni-Calories.
   Rôle : rendre l'app shell utilisable hors connexion.
   Le scan code-barres (Open Food Facts) reste dépendant du réseau ;
   ce fichier ne met en cache que les requêtes same-origin (type 'basic'),
   donc les appels API cross-origin ne sont jamais interceptés ici. */

const CACHE = 'omni-calories-v23';

// Fichiers mis en cache dès l'installation (l'app shell : tout ce dont
// l'app a besoin pour démarrer hors connexion). Le moteur OCR
// Tesseract.js (worker, cœur WebAssembly ~4 Mo, modèle de langue
// française ~0,7 Mo — voir lib/tesseract/) n'y figure volontairement
// PAS : ces fichiers ne sont récupérés qu'à la première utilisation
// réelle de la photo d'étiquette (par le gestionnaire "fetch"
// ci-dessous, qui met en cache toute requête same-origin réussie), pour
// ne pas alourdir le tout premier chargement de l'app avec un
// téléchargement dont la plupart des visites n'auront pas besoin.
const FICHIERS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './lib/html5-qrcode.min.js',
  './lib/tesseract/tesseract.min.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png'
];

// { cache: 'reload' } : chaque fichier est repris sur le serveur, sans
// passer par le petit cache du navigateur (GitHub Pages le garde 10 min).
// Sinon, deux mises à jour publiées coup sur coup pourraient ranger
// d'anciens fichiers sous le nouveau numéro de version.
// Volontairement, PAS de self.skipWaiting() ici : une nouvelle version
// attend qu'on touche « Mettre à jour » dans le bandeau de l'application
// (voir le message « activer » plus bas). Rien ne change par surprise.
// Seule exception, fixée par le navigateur : si l'application est
// complètement fermée, la nouvelle version est là à la prochaine ouverture.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
  );
});

// Activation : on supprime les anciennes versions de NOTRE cache, et
// seulement elles. Toutes les applications de ferrusdantioch.github.io
// partagent la même liste de caches : supprimer tout ce qui n'est pas
// CACHE effacerait aussi la copie hors ligne des autres applications
// (Refuge, Cap…). On ne touche donc qu'aux noms qui commencent par
// « omni-calories- » ou par « suivi-calorique- » (ancien nom de l'application).
const PREFIXES_A_NOUS = ['omni-calories-', 'suivi-calorique-'];

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles
        .filter((k) => k !== CACHE && PREFIXES_A_NOUS.some((p) => k.startsWith(p)))
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// On a touché « Mettre à jour » : cette version prend le relais. La page
// le remarque (événement « controllerchange ») et se recharge.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'activer') self.skipWaiting();
});

// Chaque fichier demandé : la copie rangée sur l'appareil d'abord ; le
// réseau seulement pour un fichier absent (ex. le moteur OCR, au premier
// usage), dont la copie est alors gardée.
// On ne remplace JAMAIS en arrière-plan un fichier déjà rangé : sinon
// l'application changerait en douce, sans passer par « Mettre à jour ».
// On ne cherche que dans CACHE, la copie de CETTE version : pendant
// qu'une nouvelle version attend, sa copie existe déjà à côté.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Les appels vers d'autres sites (Open Food Facts) passent directement
  // par le réseau, sans détour par ce fichier.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(e.request).then((enCache) => {
      if (enCache) return enCache;
      return fetch(e.request).then((rep) => {
        if (rep && rep.status === 200 && rep.type === 'basic') c.put(e.request, rep.clone());
        return rep;
      });
    }))
  );
});

// Phase 5 : la notification de dépassement (déclenchée depuis app.js
// via `registration.showNotification`) doit amener l'utilisateur vers
// l'app quand il appuie dessus, plutôt que de ne rien faire. Si un
// onglet de l'app est déjà ouvert, on le ramène au premier plan (sans
// le recharger) ; sinon on en ouvre un nouveau.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const dejaOuvert = clients.find((c) => 'focus' in c);
      if (dejaOuvert) return dejaOuvert.focus();
      return self.clients.openWindow('./');
    })
  );
});
