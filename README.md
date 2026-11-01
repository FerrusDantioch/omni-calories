# Omni-Calories

Application web (PWA) de suivi des calories et des nutriments, repas par
repas : scan du code-barres, photo de l'étiquette, objectifs quotidiens. Sans
compte : le journal et les objectifs restent sur l'appareil.

**Ouvrir l'application :** https://ferrusdantioch.github.io/omni-calories/

---

## Ce que fait l'application

- **Journal du jour**, rangé par repas : petit-déjeuner, déjeuner, dîner,
  collation.
- **Objectif quotidien** de calories et de protéines, avec des barres de
  progression. L'objectif se reporte tout seul d'un jour à l'autre.
- **Trois façons d'ajouter un aliment** :
  - scanner le code-barres avec la caméra (les valeurs viennent de la base
    ouverte Open Food Facts) ;
  - prendre en photo l'étiquette nutritionnelle (le texte est lu sur
    l'appareil) ;
  - saisir les valeurs à la main.

  Dans tous les cas, les valeurs restent modifiables avant l'ajout au journal.
- **Favoris** : une étoile sur un aliment le place en tête de la fenêtre
  « Ajouter un aliment ».
- **Détail d'un aliment** en touchant sa ligne : calories, protéines,
  glucides et lipides pour la quantité mangée. La quantité et l'unité
  (grammes ou millilitres) s'y modifient.
- **Nombres à virgule** acceptés : « 54,4 » comme « 54.4 ».
- **Historique** : les flèches ◀ ▶ passent d'un jour à l'autre, et 📅 saute
  directement à une date. Un jour passé ne reçoit plus de nouvel aliment, mais
  ses lignes peuvent encore être corrigées ou supprimées.
- **Tendances** : un graphique des 7 derniers jours comparés à l'objectif.
- **Alerte de dépassement** : un bandeau dans l'application quand l'objectif
  de calories du jour est dépassé, et, si vous l'activez, une notification
  (une par jour au plus). L'activation se fait dans « Objectif quotidien » :
  l'application ne la demande jamais d'elle-même.

## Vos données et internet

- Le journal, les objectifs et les aliments enregistrés restent sur
  l'appareil, dans le stockage du navigateur. Pas de compte, pas de publicité.
- Internet ne sert qu'à deux choses :
  - **la recherche d'un code-barres** : le code est envoyé à Open Food Facts
    pour retrouver le produit ;
  - **la première photo d'étiquette** : le moteur de lecture (environ 4,7 Mo)
    est téléchargé une fois depuis le site de l'application, puis il
    fonctionne sans connexion.
- Sans connexion, il reste la photo de l'étiquette (si elle a déjà servi une
  fois) et la saisie à la main.
- Les valeurs viennent d'étiquettes ou d'une base collaborative : elles
  peuvent contenir des erreurs. Vérifiez-les sur l'écran de confirmation.

## Installer sur un téléphone Android

Ouvrez l'adresse de l'application, puis menu ⋮ → **Installer l'application**
(ou **Ajouter à l'écran d'accueil**).

Si Chrome indique « Cette appli est déjà installée » alors qu'elle ne l'est
pas, c'est une limite de Chrome quand une autre application de
`ferrusdantioch.github.io` est déjà installée. Installez Omni-Calories
depuis Brave, ou choisissez « Créer un raccourci » dans Chrome.

## Tester sur un ordinateur

Le mode hors-ligne ne fonctionne qu'à une adresse `https://` ou
`http://localhost`, jamais en ouvrant `index.html` par un double-clic. Un petit
serveur sans installation est fourni (il demande Node.js) :

```bash
node outils/serveur-statique.js . 5500
```

puis ouvrez http://localhost:5500.

## Publier une modification

Le site est publié par GitHub Pages depuis la branche `main`, dossier racine.

Après toute modification de `index.html`, `app.js`, `styles.css`,
`manifest.json` ou des icônes, augmentez le numéro de version tout en haut de
`sw.js` (par exemple `omni-calories-v21` → `omni-calories-v22`). Sans cela,
les appareils continuent d'afficher l'ancienne version. Un nouveau fichier doit
aussi être ajouté à la liste `FICHIERS` du même fichier.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Les écrans et les textes affichés |
| `styles.css` | Couleurs et mise en page (thème clair et sombre) |
| `app.js` | Le fonctionnement : journal, objectifs, scanner, photo d'étiquette, alertes, tendances |
| `sw.js` | Le mode hors-ligne |
| `manifest.json` | Nom et icônes de l'application |
| `icon-192.png`, `icon-512.png`, `maskable-512.png` | Les icônes |
| `lib/html5-qrcode.min.js` | Lecture des codes-barres (copie locale) |
| `lib/tesseract/` | Lecture du texte des étiquettes, avec le modèle de français (copie locale) |
| `outils/serveur-statique.js` | Petit serveur de test, jamais utilisé en ligne |
| `ARCHITECTURE.md` | Documentation technique détaillée |
| `CLAUDE.md` | Notes de développement |

## Tests automatiques

Les tests ouvrent l’application dans un vrai navigateur, font les gestes
d’une personne et vérifient le résultat, y compris sans internet. Ils ne
contactent aucun site. Ils ne servent qu’au développement : l’application
n’en a pas besoin pour fonctionner.

Il faut [Node.js](https://nodejs.org) (version 22 ou plus récente), puis,
une seule fois, dans le dossier de l’application :

```
npm install playwright
npx playwright install chromium
```

Ensuite, à chaque fois :

```
node tests/tester.js
```

Le bilan s’affiche à la fin : « Échecs : 0 » veut dire que tout va bien.

## Bibliothèques et données d'autres auteurs

| Élément | Version | Licence |
|---|---|---|
| [html5-qrcode](https://github.com/mebjas/html5-qrcode) | 2.3.8 | Apache 2.0 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) et son moteur | 6.0.1 | Apache 2.0 |
| Modèle de français de [Tesseract](https://github.com/tesseract-ocr/tessdata_best) | — | Apache 2.0 |
| Données produits [Open Food Facts](https://world.openfoodfacts.org) | — | Open Database License (ODbL) |

Ces éléments gardent leur propre licence. Les textes complets des licences des
bibliothèques sont dans le dossier `lib/` : voir [lib/LICENCES.md](lib/LICENCES.md).

## Licence

**© 2026 Ferrus Dantioch — Creative Commons BY-NC-ND 4.0**
([résumé de la licence en français](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.fr))

En clair : le partage est autorisé, à l'identique et en citant l'auteur ;
l'usage commercial est interdit ; la modification et les œuvres dérivées
sont interdites. Le logiciel est fourni « en l'état », sans aucune garantie.

Texte complet dans le fichier [LICENSE](LICENSE) : le texte officiel en
anglais, suivi de la traduction française officielle publiée par Creative
Commons.
