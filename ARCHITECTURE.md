# ARCHITECTURE.md — Omni-Calories

Document de référence technique pour le développement de l'application avec l'aide de l'intelligence artificielle. À passer en contexte au début de chaque session.

## 1. Vue d'ensemble

Application web progressive (PWA) de suivi calorique et nutritionnel, permettant de :

* Scanner des produits (code-barres ou OCR d'étiquette) pour récupérer automatiquement leurs valeurs nutritionnelles
* Enregistrer les aliments consommés, classés par repas (petit-déjeuner, déjeuner, dîner, collations)
* Définir des objectifs quotidiens de calories et de protéines
* Être alerté en cas de dépassement de l'objectif calorique

Statut de commercialisation : non décidé à ce stade (peut servir de projet-test comme Refuge).

## 2. Stack technique

* Base : HTML5 / CSS3 / JavaScript vanilla, aucune dépendance de build (cohérent avec le reste du portfolio)
* Stockage : IndexedDB (pas de localStorage — volumes de données trop structurés)
* PWA : Service Worker + manifest, installable, fonctionnement hors-ligne pour tout sauf la recherche par code-barres
* Scanner code-barres : bibliothèque `html5-qrcode` (lecture caméra, formats EAN-13/UPC courants sur emballages alimentaires)
* Base de données produits : API publique Open Food Facts (gratuite, sans clé API, endpoint REST simple par code-barres)
* OCR (repli) : `Tesseract.js` (reconnaissance de texte embarquée, fonctionne hors-ligne une fois le modèle de langue téléchargé en cache)
* Notifications : Notifications API + Service Worker pour les alertes push

### Dépendance réseau — point d'attention

Contrairement aux autres PWA du portfolio (100% offline), cette application a une fonctionnalité dépendante d'internet : la recherche par code-barres sur Open Food Facts. En l'absence de connexion, l'app doit basculer automatiquement sur l'OCR ou la saisie manuelle, avec un message clair à l'utilisateur plutôt qu'une erreur silencieuse.

## 3. Flux du scanner (logique métier)

1. L'utilisateur ouvre le scanner → choix entre "Code-barres" et "Photo de l'étiquette"
2. Mode code-barres :
   * Lecture caméra en continu jusqu'à détection d'un code-barres valide
   * Requête à Open Food Facts avec le code détecté
   * Si produit trouvé → pré-remplissage des champs (nom, calories, protéines, glucides, lipides pour 100g, + poids de la portion si disponible)
   * Si produit non trouvé ou pas de connexion → proposition de bascule vers OCR ou saisie manuelle
3. Mode OCR :
   * Capture photo de l'étiquette nutritionnelle
   * Tesseract.js extrait le texte brut
   * Analyse du texte pour repérer les valeurs numériques associées aux mots-clés attendus (kcal, protéines, glucides, lipides)
   * Pré-remplissage des champs avec les valeurs détectées, toujours modifiables par l'utilisateur (l'OCR n'est jamais fiable à 100%)
4. Saisie manuelle : formulaire simple, toujours disponible en dernier recours

Dans tous les cas, l'étape finale est une validation par l'utilisateur avant l'ajout définitif (quantité consommée, repas associé).

## 4. Schéma de données (IndexedDB)

### Store `objectifs`

```
{
  id: auto-incrémenté,
  dateDebut: "2026-09-16",     // date à partir de laquelle cet objectif s'applique
  dateFin: null,                // null = objectif actif ; renseigné quand un nouvel objectif le remplace
  objectifCalories: 2000,
  objectifProteines: 120        // en grammes
}
```

Logique de report : à chaque nouveau jour, si aucun nouvel objectif n'a été défini, l'objectif actif (dateFin = null) reste en vigueur. Définir un nouvel objectif clôture l'ancien (dateFin = veille) et en ouvre un nouveau.

### Store `produits` (cache local des produits scannés/utilisés)

```
{
  codeBarres: "3017620422003",  // clé, null si produit créé manuellement/via OCR
  nom: "Nutella 400g",
  caloriesPour100g: 539,
  proteinesPour100g: 6.3,
  glucidesPour100g: 57.5,
  lipidesPour100g: 30.9,
  source: "openfoodfacts" | "ocr" | "manuel",
  unite: "g" | "ml",           // Phase 7 : "ml" = valeurs pour 100 ml (liquides)
  favori: true                  // Phase 7 : absent ou false = pas favori
}
```

### Store `journal` (aliments consommés)

```
{
  id: auto-incrémenté,
  date: "2026-09-16",
  repas: "petit-dejeuner" | "dejeuner" | "diner" | "collation",
  produitRef: codeBarres ou id produit local,
  nomAffiche: "Nutella",       // dénormalisé pour affichage rapide sans jointure
  quantiteGrammes: 30,         // décimales possibles (54.4) ; en ml si unite = "ml"
  unite: "g" | "ml",           // Phase 7
  // Phase 7 : copie des valeurs pour 100 g (ou 100 ml) au moment de l'ajout,
  // pour le détail et la modification de quantité
  caloriesPour100g: 539,
  proteinesPour100g: 6.3,
  glucidesPour100g: 57.5,      // null si inconnu (ancienne ligne sans fiche)
  lipidesPour100g: 30.9,       // null si inconnu
  caloriesCalculees: 161.7,
  proteinesCalculees: 1.9,
  glucidesCalculees: 17.3,     // Phase 7
  lipidesCalculees: 9.3        // Phase 7
}
```

Les lignes et fiches enregistrées avant la Phase 7 sont complétées
automatiquement au démarrage (`migrerAnciennesDonnees` dans `app.js`),
sans jamais modifier leurs calories ni leurs protéines.

### Store `parametres`

```
{
  id: "parametres",              // clé fixe, une seule ligne dans ce magasin
  seuilAlerteKcal: 100,          // dépassement à partir duquel l'alerte se déclenche
  notificationsPushActivees: true/false,
  dateDerniereAlerteEnvoyee: "2026-09-16" ou null   // sert d'indicateur "une seule notification par jour" (Phase 5) :
                                                     // comparée à la date du jour, pas besoin de tâche planifiée à minuit
}
```

## 5. Logique de l'alerte de dépassement

* Recalcul du total calorique du jour à chaque ajout/suppression dans le journal
* Si `totalJour > objectifCalories + seuilAlerteKcal` → déclenchement :
   * Bandeau visuel in-app (immédiat, si l'app est ouverte)
   * Notification push via Service Worker (si permission accordée), y compris si l'app est fermée — nécessite que le calcul soit refait au moment de l'ajout (donc uniquement déclenchable pendant une session active ; pas de calcul en tâche de fond sans action utilisateur)
* Une seule notification par jour par défaut, pour éviter le spam (à reconfirmer en phase de développement si besoin d'alertes répétées)

## 6. Découpage en phases de développement

### Phase 1 — Socle

* Structure PWA (manifest, Service Worker, cache offline des assets statiques)
* Schéma IndexedDB complet + fonctions CRUD de base
* Écran journal du jour (ajout manuel d'un aliment, affichage par repas)

### Phase 2 — Objectifs et calculs

* Définition/modification des objectifs (calories + protéines)
* Logique de report automatique des objectifs
* Calcul et affichage des totaux du jour vs objectifs (barres de progression)

### Phase 3 — Scanner code-barres

* Intégration html5-qrcode
* Appel API Open Food Facts + parsing de la réponse
* Gestion des cas d'erreur (produit non trouvé, pas de connexion)

### Phase 4 — OCR

* Intégration Tesseract.js
* Logique d'extraction des valeurs depuis le texte brut
* Interface de correction manuelle post-OCR

### Phase 5 — Alertes

* Bandeau in-app
* Notifications push (permission, Service Worker, déclenchement)

### Phase 6 — Historique et finitions (fait)

* Vue historique (jours passés, objectifs actifs à l'époque)
* Identité visuelle, responsive mobile, tests finaux

Décision d'implémentation : pas d'écran séparé pour l'historique — le
journal du jour (Phase 1) permettait déjà de naviguer vers n'importe
quel jour passé et d'y voir le détail par repas, les totaux et
l'objectif actif à cette date ; dupliquer cet affichage dans un second
écran aurait introduit une source de divergence visuelle. Cette phase
y ajoute plutôt un sélecteur de date (pour sauter directement à un
jour), un comportement lecture-seule sur les jours passés, un
indicateur de dépassement propre à l'historique, et une vue
"Tendances" séparée (agrégat sur 7 jours, graphique CSS) pour la vue
d'ensemble que le journal jour-par-jour ne donne pas.

### Phase 7 — Confort de saisie (fait)

* Aliments favoris : étoile sur chaque ligne du journal, liste des favoris en tête de la fenêtre d'ajout
* Quantités et valeurs à décimales, virgule ou point acceptés
* Détail d'un aliment du journal : calories et macronutriments pour la quantité consommée
* Modification de la quantité d'un aliment déjà enregistré (totaux recalculés)
* Unité g ou ml (liquides : valeurs pour 100 ml)
* Migration automatique des données existantes

## 7. Points à trancher en cours de développement

* Format exact des mots-clés recherchés par le parseur OCR (dépendra des retours de tests réels sur étiquettes françaises)
* Gestion des unités variées sur les étiquettes (certaines en "pour portion", d'autres "pour 100g")
* Éventuelle limite du nombre de notifications push par jour
