# Omni-Calories — notes pour Claude

PWA de suivi calorique/nutritionnel, en **HTML/CSS/JS pur, sans dépendance ni
compilation** (cohérent avec le reste du portfolio). Voir `ARCHITECTURE.md`
(dans ce dossier) pour la spécification complète (schéma de données, flux du
scanner, découpage en phases).

## État d'avancement

- **Phase 1 (socle) — fait** : structure PWA (manifest, service worker),
  schéma IndexedDB complet (`objectifs`, `produits`, `journal`, `parametres`)
  avec CRUD de base, écran journal du jour (ajout manuel par repas,
  suppression, navigation entre les jours).
- **Phase 2 (objectifs) — fait** : carte "Objectif quotidien" + boîte de
  dialogue de modification (pré-remplie), report automatique d'un jour à
  l'autre (`objectifActifMaintenant`, `objectifActifA`, `definirNouvelObjectif`
  dans `app.js`), écran d'onboarding au premier lancement, barres de
  progression calories/protéines sur l'écran journal avec indicateur visuel
  de dépassement.
- **Phase 3 (scanner code-barres) — fait** : le "+" d'un repas ouvre
  désormais un choix (scanner / photo étiquette — désactivé, Phase 4 /
  saisie manuelle). Scanner caméra via `lib/html5-qrcode.min.js` (copie
  locale, pas de CDN — voir plus bas), formats EAN-13/UPC-A uniquement.
  Recherche produit : cache local (`produits`, index `parCodeBarres`)
  puis Open Food Facts (`rechercherProduit` dans `app.js`), avec trois
  messages d'erreur distincts (caméra refusée/indisponible, pas de
  connexion, produit introuvable). Écran de confirmation modifiable
  (`ouvrirConfirmation`) avant ajout au journal via `ajouterAlimentConnu`
  (nommée `ajouterAlimentScanne` jusqu'à la Phase 7).
- **Phase 4 (OCR étiquette) — fait** : bouton "Photo de l'étiquette"
  activé dans le choix d'ajout (Phase 3), capture via
  `<input type="file" capture="environment">` (photo fixe, pas de flux
  caméra continu comme le scanner). Lecture via Tesseract.js (copie
  locale dans `lib/tesseract/`, modèle français `fra`, mode LSTM_ONLY —
  voir plus bas). Extraction des 4 valeurs par mots-clés
  (`extraireValeursNutritionnelles` dans `app.js`, section 12 —
  logique isolée du reste car dense). Réutilise l'écran de confirmation
  de la Phase 3 (`ouvrirConfirmationOcr`), nom du produit laissé vide
  (jamais deviné). Nouveau produit enregistré avec `source: "ocr"` via
  `ajouterAliment` (généralisée en Phase 4 pour accepter un `source`).
- **Phase 5 (alertes de dépassement) — fait** : bandeau in-app
  (`#bandeau-depassement`) et notification push, tous deux pilotés par
  `verifierDepassement` (app.js, section 6 — appelée depuis
  `rafraichirEcran`, donc à chaque ajout/suppression/changement de
  jour/chargement). Ne s'applique qu'au jour "aujourd'hui" — jamais en
  consultant un jour passé. Activation des notifications proposée dans
  le dialogue "Objectif quotidien" (case à cocher, jamais au premier
  lancement) ; la permission navigateur n'est demandée que quand
  l'utilisateur coche lui-même la case. Une seule notification par jour
  via `parametres.dateDerniereAlerteEnvoyee` (comparaison de date, pas
  de tâche planifiée). `sw.js` gère le clic sur la notification
  (`notificationclick`) pour ramener l'app au premier plan.
- **Phase 6 (historique et finitions) — fait** : pas d'écran séparé
  dupliquant l'affichage du journal — l'écran existant (avec sa
  navigation ◀▶ depuis la Phase 1) sert déjà d'historique ; ajout d'un
  sélecteur de date (`#date-historique`, bouton 📅) pour sauter
  directement à un jour précis. Jours passés en lecture seule : boutons
  "+" masqués (`rafraichirEcran`, section 5), suppression toujours
  possible. Nouvel indicateur `#indicateur-depassement-jour` (fait
  factuel, discret) distinct du bandeau Phase 5 (alerte du jour même
  uniquement). Vue "Tendances" (onglet séparé, `#vue-tendances`) :
  graphique en barres CSS pur des 7 derniers jours vs objectif
  (`calculerTendances7Jours` / `rafraichirTendances`, app.js section
  17), pas de canvas ni de bibliothèque. Corrections de cohérence
  visuelle trouvées en relisant les phases précédentes (voir plus bas :
  contraste du bandeau, couleur des erreurs scanner/OCR). Icône
  maskable régénérée (débordait de la zone de sécurité Android).
- **Phase 7 (confort de saisie) — fait** : cinq ajouts, un commit
  chacun (voir plus bas « Format des données depuis la Phase 7 ») :
  favoris (étoile ☆/★ sur chaque ligne du journal, liste en tête de la
  fenêtre « Ajouter un aliment », section 18) ; quantités et valeurs à
  décimales avec virgule ou point (`lireNombre`, section 2) ; détail
  d'un aliment en touchant sa ligne (calories, protéines, glucides,
  lipides pour la quantité consommée, section 19) ; modification de la
  quantité dans ce même détail, aussi sur un jour passé ; unité g ou ml
  pour les liquides (section 20), modifiable après coup dans le détail
  (`modifierEntree` : ne change que le libellé, et retient la nouvelle
  unité sur la fiche produit).
- Prochaines étapes (hors périmètre technique) : décision de mise en
  vente, choix de plateforme de distribution, politique de
  confidentialité, visuels de fiche produit.

## ⚠️ Avant de pousser : incrémenter la version du service worker

Après toute modification d'un fichier **mis en cache** (`index.html`,
`app.js`, `styles.css`, `manifest.json`, icônes), incrémenter la constante en
haut de `sw.js` :

```js
const CACHE = 'omni-calories-v22';   // → v23
```

Sans ce changement, le navigateur ne retélécharge rien et toute personne
ayant déjà ouvert l'application continue de voir l'ancienne version. En cas
d'**ajout de fichier**, l'inscrire aussi dans la liste `FICHIERS` du même
fichier.

## Nouvelle version : jamais de changement par surprise

Une nouvelle version **attend** un appui sur « Mettre à jour »
(`#bandeau-mise-a-jour`, en haut du journal ; fin d'`app.js`). Ne pas
remettre `self.skipWaiting()` dans l'installation de `sw.js` : il n'est
appelé qu'au message `{ type: 'activer' }`. Le `fetch` ne sert que la
copie de `CACHE` et ne remplace jamais en arrière-plan un fichier rangé
(sinon l'application changerait en douce). Limite du navigateur : si
l'application est complètement fermée, la nouvelle version est là à
l'ouverture suivante.

## Format des données depuis la Phase 7 (migration automatique)

- **Ligne du journal** : en plus de `caloriesCalculees` /
  `proteinesCalculees`, elle garde une copie de ses valeurs pour 100 g
  (`caloriesPour100g`, `proteinesPour100g`, `glucidesPour100g`,
  `lipidesPour100g`), ses `glucidesCalculees` / `lipidesCalculees` et
  son `unite` (`'g'` ou `'ml'`). Toujours la construire avec
  `nouvelleEntree` et la recalculer avec `calculerValeursEntree` (qui
  arrondit au dixième, comme avant).
- **Fiche produit** : champs `favori` (absent = pas favori) et `unite`.
- **`quantiteGrammes` contient des ml** pour une ligne en ml : le nom
  est resté pour ne pas convertir les données existantes. Une boisson
  donne ses valeurs pour 100 ml, le calcul est donc le même.
- **`produitRef` a deux formes** : code-barres (texte) pour un produit
  scanné, numéro de fiche (nombre) sinon. `produitDeLEntree` /
  `indexerProduits` gèrent les deux.
- **Pas de fiche en double** : une saisie manuelle (ou OCR) réutilise
  une fiche sans code-barres identique (`ficheIdentique` : même nom aux
  majuscules/accents/espaces près, même unité, mêmes valeurs pour
  100 g — voir `empreinteAliment`). Les doublons créés avant la
  Phase 7 sont fusionnés au démarrage (`fusionnerFichesEnDouble`,
  appelée par la migration) : fiche favorite gardée en priorité, sinon
  la plus ancienne ; lignes du journal rattachées, doublons supprimés,
  en une transaction. Même nom mais valeurs différentes = aliments
  distincts, volontairement (pain complet / pain blanc).
- **Migration** (`migrerAnciennesDonnees`, appelée dans `demarrer`) :
  complète les lignes et fiches d'avant la Phase 7 (repérées par
  l'absence de `caloriesPour100g` ou d'`unite`), en une transaction par
  magasin. Elle ne modifie **jamais** les calories et protéines
  calculées (totaux des jours passés identiques) ; sans fiche
  retrouvée, glucides et lipides restent `null` (« non renseigné »),
  jamais 0. Elle est rejouée à chaque démarrage mais ne touche rien
  quand tout est à jour. Pas de changement de version IndexedDB (aucun
  magasin ni index ajouté).
- Testé de bout en bout : ancienne version publiée (cache v10, vraies
  données saisies) → nouvelle version sur la même adresse ; totaux
  identiques, cache v10 supprimé.

## Champs décimaux : texte + `lireNombre`, pas `type="number"`

Les champs de quantité et de valeurs pour 100 g sont des
`<input type="text" inputmode="decimal" data-nombre="quantite|valeur">`.
Un `type="number"` refusait 54,4 (`step="1"`) et gère mal la virgule
selon le clavier Android. `lireNombre` accepte « 54,4 » et « 54.4 » ;
`brancherVerificationNombres(formulaire)` affiche un message en
français au moment de valider. Pour pré-remplir un champ, passer par
`nombreVersChamp` (virgule) ; pour afficher, par `formaterNombre`.

## ⚠️ Piège CSS : `display` sur un élément qui bascule `hidden`

Un sélecteur de classe (`.zone-progression { display: flex }`) a la même
spécificité que l'attribut `[hidden]` du navigateur (`display: none`), donc
l'ordre d'apparition dans la feuille de style décide — et une classe déclarée
après gagne, ce qui **annule le masquage**. Toujours écrire
`.ma-classe:not([hidden]) { display: ... }` pour un élément que le JS
cache/affiche via `el.hidden = true/false`. Vu en Phase 2 sur
`#zone-progression` (bug corrigé) — `#vue-onboarding` avait déjà le bon
réflexe.

## Dépendance réseau

Contrairement à Refuge (100 % hors-ligne), cette app a une fonctionnalité
dépendante d'internet depuis la Phase 3 (recherche par code-barres sur
Open Food Facts). Le service worker ignore les requêtes vers un autre
site (test d'origine en tête du gestionnaire `fetch`) et ne met en cache
que les réponses same-origin (type `basic`) : les appels à l'API passent
directement par le réseau.

## Bibliothèque html5-qrcode — copie locale, pas de CDN

`lib/html5-qrcode.min.js` est une copie figée de la version 2.3.8
(téléchargée une fois depuis jsdelivr, intégrité vérifiée par hash SHA-256),
commitée dans le dépôt et servie same-origin — cohérent avec le
fonctionnement offline du reste de l'app (le service worker la met en
cache comme n'importe quel autre asset statique). Elle expose des
variables globales (`Html5Qrcode`, `Html5QrcodeSupportedFormats`, etc.)
une fois chargée ; charger ce script *avant* `app.js` dans `index.html`.
Pour mettre à jour la version, retélécharger le fichier et vérifier son
intégrité avant de l'intégrer.

## Tesseract.js — copie locale, cache différé (pas au premier chargement)

`lib/tesseract/` contient une copie figée de Tesseract.js 6.0.1
(intégrité vérifiée par hash SHA-256, comme html5-qrcode) :
`tesseract.min.js` (API, 62 Ko), `worker.min.js` (script du Worker,
111 Ko), `tesseract-core-lstm.wasm.js` (moteur WebAssembly, mode
LSTM_ONLY seulement — **≈ 3,95 Mo**), et `lang-data/fra.traineddata.gz`
(modèle de français, variante `best_int` quantifiée — **≈ 690 Ko**,
c'est la variante que Tesseract.js utilise par défaut en mode LSTM, pas
besoin d'aller chercher un modèle "fast" séparément). Total téléchargé
au premier usage réel de l'OCR : **≈ 4,7 Mo**.

Décisions à connaître :
- **Un seul fichier core (`-lstm`, sans SIMD)**, passé explicitement en
  `corePath` pour court-circuiter la détection automatique SIMD de
  Tesseract.js (qui choisirait entre 4 variantes selon l'appareil). Un
  peu moins rapide sur les appareils récents qui supportent le SIMD,
  mais garanti de fonctionner partout et un seul fichier à gérer/mettre
  en cache. Si la vitesse devient un problème sur mobile, ajouter la
  variante `tesseract-core-simd-lstm.wasm.js` (même taille, ~3,95 Mo)
  et re-basculer sur la détection automatique de la bibliothèque.
- **Pas dans le précache du Service Worker** (`sw.js`, `FICHIERS`) :
  seul `tesseract.min.js` (62 Ko) y figure. Le worker, le cœur wasm et
  le modèle de langue ne sont récupérés qu'à la première utilisation
  réelle de la photo d'étiquette, via le gestionnaire `fetch` générique
  de `sw.js` (déjà en place depuis la Phase 1, met en cache toute
  requête same-origin réussie) — c'est le sens de "mis en cache après
  le premier téléchargement" : le tout premier chargement de l'app
  n'est pas alourdi par ~4,7 Mo dont la plupart des visites n'auront
  pas besoin.
- **`workerPath`/`corePath`/`langPath` en URL absolues** (via
  `new URL(chemin, document.baseURI)`), pas en chemins relatifs comme
  le reste de l'app : le Worker de Tesseract.js s'exécute via une URL
  `blob:`, où la résolution d'un chemin relatif est moins prévisible
  selon le navigateur — vu en testant cette phase, corrigé avant que ça
  ne devienne un bug intermittent difficile à diagnostiquer.

## Corrections de cohérence visuelle (trouvées en Phase 6)

En relisant les phases précédentes pour la passe de finitions, deux
problèmes de cohérence visuelle non détectés à l'époque :
- **`.bandeau-depassement` (Phase 5)** utilisait un texte blanc fixe
  sur fond `--danger`. Or `--danger` s'inverse en luminosité d'un
  thème à l'autre (clair en thème sombre, foncé en thème clair) : le
  texte blanc n'avait pas assez de contraste en thème sombre. Corrigé
  avec une nouvelle variable `--texte-sur-danger`, définie par thème
  (comme `--accent`/texte des boutons principaux le faisaient déjà,
  mais avec une valeur fixe suffisante dans leur cas — pas dans celui
  de `--danger`).
- **`.scanner-erreur p` et `.ocr-erreur p` (Phases 3 et 4)** utilisaient
  `--accent-fond` (teinte verte, habituellement réservée aux éléments
  positifs/succès) pour des boîtes de message d'**erreur**. Corrigé en
  utilisant une nouvelle variable `--danger-fond` (même principe que
  `--accent-fond`, déclinée pour le rouge).

## Piège rencontré : transfert d'un gros blob base64 vers un fichier

En régénérant l'icône `maskable-512.png` (Phase 6, voir plus bas),
copier un base64 de ~33 000 caractères directement dans le paramètre
`content` de l'outil d'écriture de fichier a produit à deux reprises un
fichier corrompu/tronqué (avec en plus un texte parasite `</content>`
ajouté par erreur en fin de fichier) — trop gros et trop sujet à des
erreurs de transcription pour être fiable dans ce contexte. Solution
qui a fonctionné : un petit serveur Node HTTP temporaire (`http.createServer`,
quelques lignes) recevant un `POST` direct depuis le navigateur
(`fetch(url, {method:'POST', body: blob})`) et écrivant les octets reçus
sur disque — aucune donnée binaire ne transite alors par la
conversation. Prévoir de gérer la requête `OPTIONS` (pré-vérification
CORS) séparément du vrai `POST`, sans quoi le serveur peut s'arrêter sur
une requête vide avant que les vraies données n'arrivent. À réutiliser
si un futur asset binaire doit être généré par le navigateur puis
sauvegardé sur disque.

## API Open Food Facts — noms de champs vérifiés

Testé en direct sur `https://world.openfoodfacts.org/api/v2/product/{code}.json`
avant l'implémentation (Phase 3) :
- Produit inconnu → `{ "status": 0 }`, **sans clé `"product"` du tout**
  (pas un objet vide — bien tester `!donnees.product` en plus de
  `status === 0`). L'API v2 renvoie ce corps avec un **statut HTTP 404** :
  `rechercherProduit` traite donc le 404 comme « produit introuvable »
  (et non comme une erreur de connexion) avant le test `reponse.ok`.
- Les valeurs nutritionnelles vivent dans `product.nutriments`, avec des
  noms de clés qui ne correspondent pas tous à des mots français : calories
  `energy-kcal_100g`, protéines `proteins_100g`, glucides
  `carbohydrates_100g`, **lipides → `fat_100g`** (pas `lipides_100g`,
  piège facile). Toutes ces clés peuvent être absentes selon la qualité
  des données communautaires : `rechercherProduit` retombe sur `0` avec
  `??`, l'utilisateur corrige si besoin à l'écran de confirmation.
  Exception pour les calories (`caloriesDepuisNutriments`) : si seule
  l'énergie en kJ est fournie (`energy-kj_100g` ou `energy_100g`, tous
  deux en kJ), elle est convertie (÷ 4,184) plutôt que d'afficher 0 kcal.
- Nom du produit : `product_name_fr` en priorité, puis `product_name`.
- Unité (Phase 7, `uniteDepuisOpenFoodFacts`) : `product_quantity_unit`
  vaut `"g"` ou `"ml"` (déduit du texte `quantity`, ex. « 6 x 250 ml »),
  et les valeurs `_100g` d'une boisson s'entendent pour 100 ml. Vérifié
  dans la documentation officielle (schéma « Product » de Product
  Opener), **pas** par un appel en direct : l'API était inaccessible
  depuis l'environnement de développement. À confirmer en scannant une
  canette ; en cas d'absence du champ, repli sur le texte `quantity`
  puis sur « g ».
- Ces noms viennent d'une base ouverte à tous : toujours passer par
  `echapper()` (qui neutralise aussi les guillemets) avant de les insérer
  dans du HTML, y compris dans un attribut.

## Tester en local

`outils/serveur-statique.js` sert le dossier sans dépendance npm (le service
worker exige `http://` ou `https://`, jamais `file://`) :

```bash
node outils/serveur-statique.js . 5500
```

Puis ouvrir `http://localhost:5500`. Un profil `.claude/launch.json` à la
racine du dossier `claude` (config `suivi-calorique`) permet aussi de lancer
ce serveur directement depuis l'outil de prévisualisation.

## Schéma IndexedDB (base `suivi-calorique`, v1)

Quatre magasins définis dans `BDD.ouvrir()` (`app.js`) — voir
`ARCHITECTURE.md` §4 pour le détail des champs :

- `objectifs` — id auto-incrémenté.
- `produits` — id auto-incrémenté, index unique `parCodeBarres` (nullable
  pour les produits manuels/OCR).
- `journal` — id auto-incrémenté, index `parDate` (non unique) pour charger
  rapidement les entrées d'un jour.
- `parametres` — clé fixe (une seule ligne).

Le module `BDD` (dans `app.js`) expose des opérations génériques
(`ajouter`, `remplacer`, `supprimer`, `tout`, `unePar`, `parIndex`) utilisables
pour n'importe quel magasin.

## Champ `id` du manifeste : nom du dossier, jamais `./`

`manifest.json` contient `"id": "/omni-calories/"`. Chrome résout `id` par rapport à
la **racine du domaine** (`https://ferrusdantioch.github.io/`), pas par
rapport au dossier de l'application : `"id": "./"` (ou `"."`) donnait donc
l'identité de la racine du site, la même pour toutes les applications qui
l'utilisaient. C'est une exception voulue à la règle des chemins relatifs.

Ne plus changer cette valeur : pour Chrome, une application déjà installée
dont l'`id` change devient une autre application (il faut la désinstaller
puis la réinstaller pour qu'elle reprenne les mises à jour).

Exception unique (octobre 2026) : l'application s'appelait « Suivi Calorique » et
vivait à `/SuiviCal/`. Le renommage du dépôt a changé son adresse,
donc son `id` : les personnes qui l'avaient installée doivent la réinstaller
depuis la nouvelle adresse (leurs données restent, le stockage n'a pas changé).

## ⚠️ Plusieurs applications sur `ferrusdantioch.github.io` : limite de Chrome Android

Toutes les applications du portfolio partagent la même adresse d'origine
(`ferrusdantioch.github.io`). Constaté en octobre 2026 sur le téléphone de
l'utilisateur : **Chrome Android n'accepte d'installer qu'une seule de ces
applications**. Dès qu'une est installée, les autres affichent « Cette appli
est déjà installée », même avec des `id` et des `scope` tous différents
(corriger l'`id`, ci-dessus, n'a pas suffi). **Brave installe toutes les
applications sans problème** : ce n'est pas un défaut des applications.

Contournements : installer depuis Brave, ou choisir « Créer un raccourci »
dans Chrome (l'application s'ouvre alors dans un onglet Chrome). Solution
durable si l'application doit être distribuée : une adresse (origine)
distincte par application (Cloudflare Pages, Netlify, sous-domaine d'un nom
de domaine, organisation GitHub…). À savoir aussi : une même origine
signifie stockage (IndexedDB, localStorage) et autorisations (micro,
notifications) partagés entre toutes ces applications.
