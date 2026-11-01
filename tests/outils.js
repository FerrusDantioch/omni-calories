/* Omni-Calories — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   Boîte à outils des tests automatiques (la même dans plusieurs
   applications de l'Omni-système).

   - un petit serveur local qui sert l'application à la même forme
     d'adresse que GitHub Pages (http://localhost:PORT/__DOSSIER__/) ;
   - « verifier() » qui note chaque vérification réussie ou ratée ;
   - « controlesCommuns() » : ce que toute application doit savoir faire
     (s'ouvrir sans erreur, ne contacter aucun autre site, tenir dans un
     écran de téléphone, marcher sans internet…).

   Ces fichiers ne servent qu'au développement : l'application n'en a
   pas besoin pour fonctionner.
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('Playwright n’est pas installé. Tapez d’abord :  npm install playwright\n' +
    'puis :  npx playwright install chromium');
  process.exit(1);
}

const RACINE = path.resolve(__dirname, '..');           // le dossier de l'application
const DOSSIER = path.basename(RACINE);                    // son nom, comme sur GitHub Pages
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf'
};

/* ---------- Le serveur local ---------- */
function demarrerServeur() {
  const prefixe = '/' + DOSSIER + '/';
  const serveur = http.createServer((req, res) => {
    let chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!chemin.startsWith(prefixe)) { res.writeHead(404); return res.end('Introuvable'); }
    chemin = chemin.slice(prefixe.length) || 'index.html';
    const fichier = path.resolve(RACINE, chemin);
    if (!fichier.startsWith(RACINE + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(fichier, (err, contenu) => {
      if (err) { res.writeHead(404); return res.end('Introuvable'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(contenu);
    });
  });
  // Port 0 : le système choisit un port libre (jamais de conflit).
  return new Promise((ok) => serveur.listen(0, () => ok(serveur)));
}

/* ---------- Le bilan ---------- */
let reussis = 0;
const echecs = [];
function verifier(condition, libelle, detail) {
  if (condition) { reussis++; console.log('  ✓ ' + libelle); return; }
  const suite = detail !== undefined ? '  (obtenu : ' + JSON.stringify(detail) + ')' : '';
  echecs.push(libelle + suite);
  console.log('  ✗ ' + libelle + suite);
}
async function section(titre, fn) {
  console.log('\n■ ' + titre);
  try { await fn(); } catch (e) { echecs.push(titre + ' : ' + e.message); console.log('  ✗ ERREUR : ' + e.stack); }
}

/* ---------- Le navigateur ---------- */
const TELEPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' };
let navigateur, serveur, adresse;
const externes = [];         // requêtes vers un autre site
const erreurs = [];          // erreurs JavaScript

/* « avant » : ce qu'il faut préparer avant d'ouvrir la page (faux site, etc.). */
async function nouvellePage({ avant, ...options } = {}) {
  const ctx = await navigateur.newContext({ ...TELEPHONE, acceptDownloads: true, ...options });
  if (avant) await avant(ctx);
  ctx.on('request', (r) => {
    const u = r.url();
    if (!/^(http:\/\/localhost:|blob:|data:)/.test(u)) externes.push(u);
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erreurs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await p.goto(adresse);
  return { ctx, p };
}

/* Fichiers cités dans le service worker (« ./qqch.ext » ou « dossier/qqch.ext ») :
   tous doivent exister. Les adresses d'autres sites ne sont pas comptées. */
function fichiersDuServiceWorker(nomFichier) {
  const texte = fs.readFileSync(path.join(RACINE, nomFichier), 'utf8');
  const trouves = [...texte.matchAll(/["']((?:\.\/)?[\w\-./]+\.[a-z][a-z0-9]{1,11})["']/gi)].map((m) => m[1]);
  return [...new Set(trouves.filter((f) => !f.includes('//') && f !== nomFichier))];
}

/* Recharger la page. Si elle était déjà en train de se recharger d'elle-même
   (certaines applications le font une fois à la première visite), on attend
   un peu et on réessaie une fois. */
async function recharger(p) {
  try { await p.reload(); } catch (e) { await p.waitForTimeout(1500); await p.reload(); }
}

/* Mesurer quelque chose dans la page. Si la page se recharge pendant la
   mesure, on attend qu'elle soit de nouveau prête et on recommence. */
async function mesurer(p, fn) {
  for (let essai = 1; ; essai++) {
    try { return await p.evaluate(fn); } catch (e) {
      if (essai >= 3 || !/context was destroyed|navigation/i.test(e.message)) throw e;
      await p.waitForLoadState('load');
      await p.waitForTimeout(1000);
    }
  }
}

/* ---------- Ce que toute application doit savoir faire ---------- */
async function controlesCommuns({ serviceWorker, avant }) {
  await section('Fichiers rangés pour le hors ligne', async () => {
    const liste = fichiersDuServiceWorker(serviceWorker);
    const manquants = liste.filter((f) => !fs.existsSync(path.join(RACINE, f)));
    verifier(liste.length > 0, `${serviceWorker} cite ${liste.length} fichiers`);
    verifier(manquants.length === 0, 'chacun existe vraiment', manquants);
  });

  await section('Ouverture sur un téléphone', async () => {
    const { ctx, p } = await nouvellePage({ avant });
    await p.waitForTimeout(1500);
    const mesure = await mesurer(p, () => ({
      debord: document.documentElement.scrollWidth - innerWidth,
      caches: [...document.querySelectorAll('[hidden]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.className),
      texte: document.body.innerText.trim().length
    }));
    verifier(mesure.texte > 20, 'la page affiche du contenu');
    verifier(mesure.debord <= 0, 'aucun défilement sur le côté', mesure.debord);
    verifier(mesure.caches.length === 0, 'les éléments cachés restent cachés', mesure.caches);

    const pret = await mesurer(p, () => Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((ok) => setTimeout(() => ok(false), 10000))
    ]));
    verifier(pret, 'le service worker est installé');
    await recharger(p);
    await p.waitForTimeout(800);
    await ctx.setOffline(true);
    let horsLigne = 0;
    try {
      await recharger(p);
      await p.waitForTimeout(1500);
      horsLigne = await mesurer(p, () => document.body.innerText.trim().length);
    } catch (e) { /* page introuvable hors ligne */ }
    verifier(horsLigne > 20, 'l’application se rouvre sans internet');
    await ctx.close();
  });
}

/* ---------- Lancer une suite de tests ---------- */
/* « options » : sites autorisés (autorises) et réglages du navigateur
   (argsNavigateur, par exemple une fausse caméra pour les tests). */
async function lancer(nom, fn, { autorises = [], argsNavigateur = [] } = {}) {
  serveur = await demarrerServeur();
  adresse = `http://localhost:${serveur.address().port}/${DOSSIER}/`;
  navigateur = await chromium.launch({
    args: argsNavigateur,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  });
  console.log(`Tests de ${nom} sur ${adresse}`);
  try {
    await fn();
  } finally {
    await section('Bilan général', async () => {
      const autres = externes.filter((u) => !autorises.some((a) => u.startsWith(a)));
      verifier(autres.length === 0, 'aucun autre site contacté', [...new Set(autres)].slice(0, 5));
      verifier(erreurs.length === 0, 'aucune erreur JavaScript', [...new Set(erreurs)].slice(0, 5));
    });
    await navigateur.close();
    serveur.close();
  }
  console.log('\n────────────────────────────────────────');
  console.log(`Vérifications réussies : ${reussis}`);
  console.log(`Échecs : ${echecs.length}`);
  for (const e of echecs) console.log('  - ' + e);
  process.exit(echecs.length ? 1 : 0);
}

module.exports = { lancer, section, verifier, nouvellePage, controlesCommuns, RACINE, DOSSIER, erreurs, externes, adresse: () => adresse };
