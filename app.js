/* ============================================================
   OMNI-CALORIES — logique de l'application
   Phase 1 (socle) : schéma IndexedDB complet + CRUD, écran
   journal du jour avec ajout manuel par repas.
   Phase 2 (objectifs) : objectif quotidien de calories/protéines,
   report automatique d'un jour à l'autre, barres de progression.
   Phase 3 (scanner) : lecture de code-barres à la caméra
   (html5-qrcode), recherche du produit dans le cache local puis
   sur Open Food Facts, écran de confirmation avant ajout.
   Phase 4 (OCR) : photo de l'étiquette nutritionnelle, lecture du
   texte par Tesseract.js (moteur + modèle français en local),
   extraction des valeurs par mots-clés, réutilisation de l'écran
   de confirmation de la Phase 3 pour la correction.
   Phase 5 (alertes) : bandeau in-app et notification push quand le
   total calorique du jour dépasse l'objectif de plus de
   `seuilAlerteKcal`, activation de la permission depuis le dialogue
   objectif, une seule notification par jour.
   Phase 6 (historique et finitions) : sélecteur de date pour aller
   directement à un jour passé (en plus du ◀▶ de la Phase 1), jours
   passés en lecture seule (suppression toujours possible), vue
   "Tendances" avec graphique CSS des 7 derniers jours.
   Phase 7 (confort de saisie) : aliments favoris (étoile sur chaque
   ligne du journal, liste des favoris dans la fenêtre d'ajout) ;
   quantités et valeurs à décimales, avec virgule ou point ; détail
   d'un aliment du journal (calories, protéines, glucides, lipides pour
   la quantité consommée), avec migration des anciennes lignes ;
   modification de la quantité d'un aliment déjà enregistré ;
   unité au choix, grammes ou millilitres (liquides).
   ============================================================ */

'use strict';

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function annoncer(texte) { $('#annonce').textContent = texte; }


/* ============================================================
   1. BASE DE DONNÉES — IndexedDB
   Quatre magasins, conformes au schéma d'ARCHITECTURE.md :
   objectifs, produits, journal, parametres.
   ============================================================ */

const BDD = {
  base: null,

  ouvrir() {
    return new Promise((resoudre, rejeter) => {
      const demande = indexedDB.open('suivi-calorique', 1);

      demande.onupgradeneeded = () => {
        const b = demande.result;

        if (!b.objectStoreNames.contains('objectifs')) {
          b.createObjectStore('objectifs', { keyPath: 'id', autoIncrement: true });
        }

        if (!b.objectStoreNames.contains('produits')) {
          const m = b.createObjectStore('produits', { keyPath: 'id', autoIncrement: true });
          m.createIndex('parCodeBarres', 'codeBarres', { unique: true });
        }

        if (!b.objectStoreNames.contains('journal')) {
          const m = b.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
          m.createIndex('parDate', 'date');
        }

        if (!b.objectStoreNames.contains('parametres')) {
          b.createObjectStore('parametres', { keyPath: 'id' });
        }
      };

      demande.onsuccess = () => { BDD.base = demande.result; resoudre(BDD.base); };
      demande.onerror = () => rejeter(demande.error);
    });
  },

  operation(magasin, mode, action) {
    return new Promise((resoudre, rejeter) => {
      const t = BDD.base.transaction(magasin, mode);
      const r = action(t.objectStore(magasin));
      t.oncomplete = () => resoudre(r && r.result);
      t.onerror = () => rejeter(t.error);
    });
  },

  ajouter(magasin, entree)   { return BDD.operation(magasin, 'readwrite', (m) => m.add(entree)); },
  remplacer(magasin, entree) { return BDD.operation(magasin, 'readwrite', (m) => m.put(entree)); },
  supprimer(magasin, id)     { return BDD.operation(magasin, 'readwrite', (m) => m.delete(id)); },
  tout(magasin)              { return BDD.operation(magasin, 'readonly',  (m) => m.getAll()); },
  // Enregistre plusieurs entrées d'un coup, dans une seule transaction :
  // soit tout est enregistré, soit rien (utile pour une migration).
  remplacerPlusieurs(magasin, entrees) {
    return BDD.operation(magasin, 'readwrite', (m) => { entrees.forEach((e) => m.put(e)); });
  },
  // Écrit dans plusieurs magasins dans une seule transaction (même
  // principe : tout ou rien). `action` reçoit une fonction qui donne
  // accès à un magasin par son nom.
  ecrireDansPlusieurs(magasins, action) {
    return new Promise((resoudre, rejeter) => {
      const t = BDD.base.transaction(magasins, 'readwrite');
      action((nom) => t.objectStore(nom));
      t.oncomplete = () => resoudre();
      t.onerror = () => rejeter(t.error);
    });
  },
  unePar(magasin, id)        { return BDD.operation(magasin, 'readonly',  (m) => m.get(id)); },
  parIndex(magasin, index, valeur) {
    return BDD.operation(magasin, 'readonly', (m) => m.index(index).getAll(valeur));
  }
};


/* ============================================================
   2. REPAS — constantes, utilitaires de date et de nombres
   ============================================================ */

const REPAS = [
  { id: 'petit-dejeuner', label: 'Petit-déjeuner' },
  { id: 'dejeuner',       label: 'Déjeuner' },
  { id: 'diner',          label: 'Dîner' },
  { id: 'collation',      label: 'Collation' }
];

function dateISO(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function libelleJour(iso) {
  const aujourdhui = dateISO(new Date());
  if (iso === aujourdhui) return "Aujourd'hui";
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  if (iso === dateISO(hier)) return 'Hier';
  const demain = new Date();
  demain.setDate(demain.getDate() + 1);
  if (iso === dateISO(demain)) return 'Demain';

  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

let jourAffiche = dateISO(new Date());


/* ---- Nombres à virgule (Phase 7) ----
   Les champs de quantité et de valeurs nutritionnelles sont des champs
   TEXTE (avec clavier numérique, `inputmode="decimal"`) plutôt que des
   champs `type="number"` : ces derniers refusent ou vident la saisie
   selon que le clavier du téléphone propose la virgule ou le point.
   On lit donc nous-mêmes le texte tapé, en acceptant les deux. */

// Transforme le texte tapé en nombre : "54,4", "54.4", " 54,4 " → 54.4.
// Renvoie NaN ("pas un nombre") pour une saisie invalide ("abc",
// "5,4,4", "-3"…). Un champ vide n'est pas un nombre non plus : c'est à
// l'appelant de décider s'il vaut 0 (champ facultatif) ou s'il manque.
function lireNombre(texte) {
  const nettoye = String(texte).replace(/\s/g, '').replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(nettoye)) return NaN;
  return Number(nettoye);
}

// Écrit un nombre à la française pour l'affichage : 54.4 → "54,4".
// `decimalesMax` limite le nombre de chiffres après la virgule.
function formaterNombre(nombre, decimalesMax = 1) {
  return Number(nombre).toLocaleString('fr-FR', { maximumFractionDigits: decimalesMax });
}

// Prépare un nombre pour le placer dans un champ de saisie : virgule
// française, sans espace des milliers (qui gênerait la relecture), et
// champ vide pour une valeur inconnue (null).
function nombreVersChamp(nombre) {
  if (nombre === null || nombre === undefined || nombre === '') return '';
  return String(Math.round(Number(nombre) * 100) / 100).replace('.', ',');
}

// Vérifie les champs portant `data-nombre` d'un formulaire et leur
// attache le message d'erreur que le navigateur affichera (en bulle) au
// moment de valider. `data-nombre="quantite"` : nombre strictement
// positif ; `data-nombre="valeur"` : nombre positif ou nul. Un champ
// vide est laissé à l'attribut `required` (obligatoire ou non).
function verifierChampsNombres(formulaire) {
  formulaire.querySelectorAll('input[data-nombre]').forEach((champ) => {
    let message = '';
    if (champ.value.trim() !== '') {
      const nombre = lireNombre(champ.value);
      if (Number.isNaN(nombre)) {
        message = 'Saisissez un nombre, par exemple 54,4 (avec une virgule ou un point).';
      } else if (champ.dataset.nombre === 'quantite' && nombre <= 0) {
        message = 'La quantité doit être supérieure à 0.';
      }
    }
    champ.setCustomValidity(message);
  });
}

// À brancher une fois par formulaire. La vérification se fait au clic
// sur le bouton de validation : le navigateur lance ce clic AVANT de
// contrôler le formulaire, les messages sont donc toujours à jour (y
// compris quand un champ a été pré-rempli par le code). La touche
// Entrée dans un champ déclenche elle aussi ce clic.
function brancherVerificationNombres(formulaire) {
  formulaire.querySelector('button[type="submit"]')
    .addEventListener('click', () => verifierChampsNombres(formulaire));
  // Pendant la frappe, on efface l'erreur affichée : elle sera
  // recalculée au prochain essai de validation.
  formulaire.addEventListener('input', (e) => {
    if (e.target.matches('input[data-nombre]')) e.target.setCustomValidity('');
  });
}


/* ============================================================
   3. JOURNAL — CRUD de haut niveau
   ============================================================ */

async function entreesDuJour(iso) {
  return BDD.parIndex('journal', 'parDate', iso);
}

// Calcule une valeur "pour la quantité consommée" à partir de sa valeur
// pour 100 g, arrondie au dixième (54,4 g à 539 kcal/100 g → 293,2 kcal).
// Une valeur inconnue (null) reste inconnue.
function pourQuantite(valeurPour100g, quantite) {
  if (valeurPour100g === null || valeurPour100g === undefined) return null;
  return Math.round((valeurPour100g * quantite) / 100 * 10) / 10;
}

// (Re)calcule les quatre valeurs "consommées" d'une ligne du journal à
// partir de ses valeurs pour 100 g et de sa quantité.
function calculerValeursEntree(entree) {
  const quantite = entree.quantiteGrammes;
  entree.caloriesCalculees = pourQuantite(entree.caloriesPour100g, quantite);
  entree.proteinesCalculees = pourQuantite(entree.proteinesPour100g, quantite);
  entree.glucidesCalculees = pourQuantite(entree.glucidesPour100g, quantite);
  entree.lipidesCalculees = pourQuantite(entree.lipidesPour100g, quantite);
  return entree;
}

// Construit une nouvelle ligne du journal pour le jour affiché.
// Depuis la Phase 7, chaque ligne garde une COPIE de ses valeurs pour
// 100 g (en plus des valeurs calculées) : le détail d'un aliment et la
// modification de sa quantité se calculent à partir de cette copie, et
// restent donc justes même si la fiche produit est corrigée plus tard.
//
// Liquides : avec `unite: 'ml'`, les valeurs "pour 100 g" sont en fait
// pour 100 ml (comme sur l'étiquette d'une boisson) et la quantité est
// en ml. Le calcul est exactement le même ; seuls les libellés changent.
// Le champ `quantiteGrammes` garde son nom d'origine (le renommer
// obligerait à convertir toutes les données existantes) mais contient
// donc des millilitres pour une ligne en ml.
function nouvelleEntree({ repas, produitRef, nom, quantite, unite, calories, proteines, glucides, lipides }) {
  return calculerValeursEntree({
    date: jourAffiche,
    repas,
    produitRef,
    nomAffiche: nom,
    quantiteGrammes: quantite,
    unite,
    caloriesPour100g: calories,
    proteinesPour100g: proteines,
    glucidesPour100g: glucides,
    lipidesPour100g: lipides
  });
}

// "Empreinte" d'une fiche sans code-barres : deux fiches qui ont la même
// décrivent le même aliment. Même nom (sans tenir compte des
// majuscules, des accents ni des espaces en trop), même unité et
// exactement les mêmes valeurs pour 100 g. Deux "Pain" de valeurs
// différentes (complet / blanc) restent volontairement distincts.
function empreinteAliment(p) {
  return [
    normaliser(String(p.nom).trim().replace(/\s+/g, ' ')),
    uniteDe(p),
    p.caloriesPour100g,
    p.proteinesPour100g,
    p.glucidesPour100g,
    p.lipidesPour100g
  ].join('|');
}

// Cherche une fiche existante identique (sans code-barres) à celle
// donnée ; renvoie null s'il n'y en a pas.
async function ficheIdentique(produit) {
  const empreinte = empreinteAliment(produit);
  const produits = await BDD.tout('produits');
  return produits.find((p) => !p.codeBarres && empreinteAliment(p) === empreinte) || null;
}

async function ajouterAliment({ nom, quantite, unite = 'g', calories, proteines, glucides, lipides, repas, source = 'manuel' }) {
  const produit = {
    codeBarres: null,
    nom,
    caloriesPour100g: calories,
    proteinesPour100g: proteines || 0,
    glucidesPour100g: glucides || 0,
    lipidesPour100g: lipides || 0,
    unite,
    source
  };
  // Le même aliment saisi une deuxième fois à la main réutilise sa
  // fiche au lieu d'en créer une en double (Phase 7) : il garde ainsi
  // son étoile de favori sur toutes ses lignes du journal.
  const dejaConnu = await ficheIdentique(produit);
  const idProduit = dejaConnu ? dejaConnu.id : await BDD.ajouter('produits', produit);

  await BDD.ajouter('journal', nouvelleEntree({
    repas,
    produitRef: idProduit,
    nom,
    quantite,
    unite,
    calories,
    proteines: produit.proteinesPour100g,
    glucides: produit.glucidesPour100g,
    lipides: produit.lipidesPour100g
  }));
}

async function supprimerAliment(id) {
  await BDD.supprimer('journal', id);
}

// Modifie la quantité et/ou l'unité d'une ligne du journal.
// - Nouvelle quantité : ses valeurs (calories, protéines, glucides,
//   lipides) sont recalculées à partir de ses valeurs pour 100 g. Les
//   totaux du jour, calculés à chaque affichage à partir des lignes,
//   suivent donc d'eux-mêmes.
// - Nouvelle unité : seul le libellé change (les valeurs étaient déjà
//   données "pour 100" de l'unité voulue) ; elle est aussi retenue sur
//   la fiche produit, pour être proposée d'office la prochaine fois.
async function modifierEntree(entree, { quantite, unite }) {
  if (quantite !== entree.quantiteGrammes) {
    entree.quantiteGrammes = quantite;
    calculerValeursEntree(entree);
  }
  const uniteChangee = unite !== uniteDe(entree);
  entree.unite = unite;
  await BDD.remplacer('journal', entree);

  if (uniteChangee) {
    const produit = await produitDeLEntree(entree);
    if (produit) {
      produit.unite = unite;
      await BDD.remplacer('produits', produit);
    }
  }
}

// Une ligne du journal ne désigne pas sa fiche produit de la même façon
// selon l'origine de l'aliment : un produit scanné est désigné par son
// code-barres (un texte), un aliment saisi à la main ou lu sur une
// photo par le numéro de sa fiche (un nombre). Ces deux fonctions
// savent retrouver la fiche dans les deux cas.

// Retrouve la fiche d'UNE ligne (lecture directe dans la base).
async function produitDeLEntree(entree) {
  if (typeof entree.produitRef === 'number') {
    return (await BDD.unePar('produits', entree.produitRef)) || null;
  }
  if (typeof entree.produitRef === 'string') {
    const trouves = await BDD.parIndex('produits', 'parCodeBarres', entree.produitRef);
    return trouves[0] || null;
  }
  return null;
}

// Pour retrouver la fiche de BEAUCOUP de lignes d'un coup (affichage du
// journal) : à partir de la liste complète des produits, déjà lue une
// seule fois, renvoie une fonction qui fait la correspondance sans
// relire la base pour chaque ligne.
function indexerProduits(produits) {
  const parNumero = new Map();
  const parCodeBarres = new Map();
  produits.forEach((p) => {
    parNumero.set(p.id, p);
    if (p.codeBarres) parCodeBarres.set(p.codeBarres, p);
  });

  return (entree) => {
    if (typeof entree.produitRef === 'number') return parNumero.get(entree.produitRef) || null;
    return parCodeBarres.get(entree.produitRef) || null;
  };
}


/* ---- Migration des données enregistrées avant la Phase 7 ----
   Avant la Phase 7 :
   - une ligne du journal ne gardait que ses calories et ses protéines
     déjà calculées ; les glucides et lipides pour 100 g n'étaient
     enregistrés que sur la fiche produit ;
   - tout était en grammes : ni les lignes ni les fiches n'avaient de
     champ `unite`.
   Au démarrage, `migrerAnciennesDonnees` complète une fois pour toutes
   ces anciennes lignes et fiches. Les calories et protéines déjà
   enregistrées ne sont JAMAIS modifiées : les totaux des jours passés
   restent exactement les mêmes. */

// Une ligne est "ancienne" s'il lui manque un des champs de la Phase 7.
function estAncienneEntree(entree) {
  return entree.caloriesPour100g === undefined || entree.unite === undefined;
}

// Complète une ancienne ligne à partir de sa fiche produit (`produit`
// peut valoir null si la fiche est introuvable).
function completerAncienneEntree(entree, produit) {
  // Avant la Phase 7, une quantité était toujours en grammes.
  if (entree.unite === undefined) entree.unite = 'g';
  if (entree.caloriesPour100g !== undefined) return entree;

  const quantite = entree.quantiteGrammes;

  // Retrouve une valeur pour 100 g à partir de la valeur calculée de la
  // ligne (simple règle de trois), au centième près.
  const depuisLaLigne = (valeurCalculee) => (quantite > 0
    ? Math.round(((valeurCalculee || 0) * 100) / quantite * 100) / 100
    : 0);

  // Calories et protéines : la valeur de la fiche est prise si elle
  // redonne bien ce que la ligne a enregistré (cas normal). Si la fiche
  // a été corrigée depuis (ou est introuvable), on se fie à la ligne
  // elle-même, pour que le détail reste cohérent avec les totaux.
  const choisir = (valeurFiche, valeurCalculee) => (
    valeurFiche !== null && valeurFiche !== undefined && pourQuantite(valeurFiche, quantite) === valeurCalculee
      ? valeurFiche
      : depuisLaLigne(valeurCalculee)
  );

  entree.caloriesPour100g = choisir(produit && produit.caloriesPour100g, entree.caloriesCalculees);
  entree.proteinesPour100g = choisir(produit && produit.proteinesPour100g, entree.proteinesCalculees);
  // Glucides et lipides n'existent que sur la fiche : sans elle, ils
  // restent inconnus (null) plutôt qu'inventés.
  entree.glucidesPour100g = produit ? (produit.glucidesPour100g ?? null) : null;
  entree.lipidesPour100g = produit ? (produit.lipidesPour100g ?? null) : null;
  entree.glucidesCalculees = pourQuantite(entree.glucidesPour100g, quantite);
  entree.lipidesCalculees = pourQuantite(entree.lipidesPour100g, quantite);
  return entree;
}

// Complète toutes les anciennes lignes et fiches (une transaction par
// magasin). Sans effet (et rapide) quand tout est déjà à jour. Renvoie
// le nombre d'enregistrements complétés.
async function migrerAnciennesDonnees() {
  const produits = await BDD.tout('produits');

  // Lignes du journal (avant les fiches : on se sert ici des fiches
  // telles qu'elles étaient, ce qui ne change rien au résultat).
  const lignesACompleter = (await BDD.tout('journal')).filter(estAncienneEntree);
  if (lignesACompleter.length > 0) {
    const produitDe = indexerProduits(produits);
    lignesACompleter.forEach((e) => completerAncienneEntree(e, produitDe(e)));
    await BDD.remplacerPlusieurs('journal', lignesACompleter);
  }

  // Fiches produits : unité "g" pour toutes celles d'avant la Phase 7.
  const fichesACompleter = produits.filter((p) => p.unite === undefined);
  if (fichesACompleter.length > 0) {
    fichesACompleter.forEach((p) => { p.unite = 'g'; });
    await BDD.remplacerPlusieurs('produits', fichesACompleter);
  }

  const fichesFusionnees = await fusionnerFichesEnDouble();

  return lignesACompleter.length + fichesACompleter.length + fichesFusionnees;
}

// Avant la Phase 7, chaque saisie manuelle créait une nouvelle fiche,
// même pour un aliment déjà saisi à l'identique : une "Pomme" mangée
// trois fois avait trois fiches, et l'étoile de favori n'en marquait
// qu'une. On regroupe ici les fiches identiques (voir
// `empreinteAliment`) en une seule :
// - la fiche gardée est la favorite s'il y en a une, sinon la plus
//   ancienne ; elle devient favorite si l'une des autres l'était ;
// - les lignes du journal des fiches en double sont rattachées à la
//   fiche gardée (leurs valeurs, copiées dans chaque ligne, et donc les
//   totaux, ne changent pas), puis les doublons sont supprimés.
// Tout se fait dans une seule transaction. Les produits scannés (avec
// code-barres) ne sont jamais concernés : ils sont déjà uniques.
// Renvoie le nombre de fiches supprimées.
async function fusionnerFichesEnDouble() {
  const groupes = new Map();
  (await BDD.tout('produits'))
    .filter((p) => !p.codeBarres)
    .forEach((p) => {
      const empreinte = empreinteAliment(p);
      if (!groupes.has(empreinte)) groupes.set(empreinte, []);
      groupes.get(empreinte).push(p);
    });

  const fichesGardees = [];
  const doublons = new Map(); // numéro de la fiche en double → fiche gardée
  groupes.forEach((fiches) => {
    if (fiches.length < 2) return;
    fiches.sort((a, b) => (b.favori === true) - (a.favori === true) || a.id - b.id);
    const gardee = fiches[0];
    gardee.favori = fiches.some((f) => f.favori === true);
    fichesGardees.push(gardee);
    fiches.slice(1).forEach((f) => doublons.set(f.id, gardee));
  });
  if (doublons.size === 0) return 0;

  const lignesARattacher = (await BDD.tout('journal'))
    .filter((e) => typeof e.produitRef === 'number' && doublons.has(e.produitRef));
  lignesARattacher.forEach((e) => { e.produitRef = doublons.get(e.produitRef).id; });

  await BDD.ecrireDansPlusieurs(['produits', 'journal'], (magasin) => {
    fichesGardees.forEach((p) => magasin('produits').put(p));
    doublons.forEach((_gardee, id) => magasin('produits').delete(id));
    lignesARattacher.forEach((e) => magasin('journal').put(e));
  });
  return doublons.size;
}

// Lit une ligne du journal en s'assurant qu'elle est au format actuel.
// Filet de sécurité : une ligne ajoutée par une ancienne version restée
// ouverte dans un autre onglet, après la migration du démarrage, est
// complétée ici au moment où on en a besoin.
async function lireEntreeComplete(id) {
  const entree = await BDD.unePar('journal', id);
  if (!entree) return null;
  if (estAncienneEntree(entree)) {
    completerAncienneEntree(entree, await produitDeLEntree(entree));
    await BDD.remplacer('journal', entree);
  }
  return entree;
}


/* ============================================================
   4. OBJECTIFS — objectifs quotidiens de calories et de protéines
   ============================================================ */

// Renvoie la date (au format "AAAA-MM-JJ") du jour précédent celui donné.
function veilleDe(dateDeReference) {
  const d = new Date(dateDeReference + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return dateISO(d);
}

// Renvoie l'objectif actuellement en cours, c'est-à-dire celui dont la
// "dateFin" vaut encore null. Un objectif reste actif indéfiniment tant
// que l'utilisateur n'en définit pas un nouveau : il n'y a donc jamais
// plus d'un objectif avec dateFin = null en même temps.
async function objectifActifMaintenant() {
  const tousLesObjectifs = await BDD.tout('objectifs');
  return tousLesObjectifs.find((o) => o.dateFin === null) || null;
}

// Renvoie l'objectif qui était en vigueur à une date donnée (format
// "AAAA-MM-JJ"). Comme les dates sont écrites "AAAA-MM-JJ", on peut les
// comparer directement avec <= et >= : l'ordre des caractères correspond
// à l'ordre chronologique.
async function objectifActifA(dateRecherchee) {
  const tousLesObjectifs = await BDD.tout('objectifs');

  return tousLesObjectifs.find((o) => {
    const aDejaCommence = o.dateDebut <= dateRecherchee;
    const nEstPasEncoreTermine = o.dateFin === null || dateRecherchee <= o.dateFin;
    return aDejaCommence && nEstPasEncoreTermine;
  }) || null;
}

// Définit un nouvel objectif à partir d'aujourd'hui.
// - Si l'utilisateur avait déjà modifié son objectif plus tôt dans la
//   journée, on met simplement à jour ce même enregistrement (inutile
//   d'en créer un deuxième pour le même jour).
// - Sinon, on clôture l'ancien objectif actif (sa "dateFin" devient la
//   veille d'aujourd'hui) et on en crée un nouveau qui commence aujourd'hui.
async function definirNouvelObjectif(objectifCalories, objectifProteines) {
  const aujourdhui = dateISO(new Date());
  const objectifActuel = await objectifActifMaintenant();

  if (objectifActuel && objectifActuel.dateDebut === aujourdhui) {
    objectifActuel.objectifCalories = objectifCalories;
    objectifActuel.objectifProteines = objectifProteines;
    await BDD.remplacer('objectifs', objectifActuel);
    return;
  }

  if (objectifActuel) {
    objectifActuel.dateFin = veilleDe(aujourdhui);
    await BDD.remplacer('objectifs', objectifActuel);
  }

  await BDD.ajouter('objectifs', {
    dateDebut: aujourdhui,
    dateFin: null,
    objectifCalories,
    objectifProteines
  });
}


/* ============================================================
   5. AFFICHAGE — écran journal du jour
   ============================================================ */

const conteneur = $('#repas-conteneur');

function construireSections() {
  conteneur.innerHTML = REPAS.map((r) => `
    <section class="section-repas" data-repas="${r.id}">
      <div class="entete-repas">
        <h2>${r.label}</h2>
        <span class="sous-total" data-role="sous-total">0 kcal</span>
        <button type="button" class="btn-ajouter-repas" data-repas="${r.id}" aria-label="Ajouter un aliment à ${r.label}">+</button>
      </div>
      <ul class="liste-aliments" data-role="liste" aria-label="Aliments — ${r.label}"></ul>
    </section>
  `).join('');

  $$('.btn-ajouter-repas').forEach((b) => {
    b.addEventListener('click', () => ouvrirChoixAjout(b.dataset.repas));
  });
}

async function rafraichirEcran() {
  $('#btn-jour-txt').textContent = libelleJour(jourAffiche);

  // Un jour passé est consultable mais pas modifiable par ajout : on
  // n'affiche les boutons "+" que pour aujourd'hui (Phase 6 — la
  // suppression, elle, reste toujours possible, y compris sur un jour
  // passé, pour corriger une erreur).
  const estAujourdhui = jourAffiche === dateISO(new Date());
  $$('.btn-ajouter-repas').forEach((b) => { b.hidden = !estAujourdhui; });
  $('#mention-lecture-seule').hidden = estAujourdhui;

  const entrees = await entreesDuJour(jourAffiche);
  const produitDe = indexerProduits(await BDD.tout('produits'));
  let totalCaloriesJour = 0;
  let totalProteinesJour = 0;

  REPAS.forEach((r) => {
    const section = conteneur.querySelector(`section[data-repas="${r.id}"]`);
    const liste = section.querySelector('[data-role="liste"]');
    const sousTotalEl = section.querySelector('[data-role="sous-total"]');

    const entreesRepas = entrees
      .filter((e) => e.repas === r.id)
      .sort((a, b) => a.id - b.id);

    const sousTotal = entreesRepas.reduce((s, e) => s + e.caloriesCalculees, 0);
    sousTotalEl.textContent = `${Math.round(sousTotal)} kcal`;
    totalCaloriesJour += sousTotal;
    totalProteinesJour += entreesRepas.reduce((s, e) => s + e.proteinesCalculees, 0);

    liste.innerHTML = entreesRepas.map((e) => `
      <li class="ligne-aliment" data-id="${e.id}">
        ${htmlBoutonFavori(e, produitDe(e))}
        <button type="button" class="btn-detail" data-id="${e.id}" title="Voir le détail ou modifier la quantité">
          <span class="info">
            <span class="nom">${echapper(e.nomAffiche)}</span>
            <span class="detail">${formaterNombre(e.quantiteGrammes, 2)} ${uniteDe(e)}</span>
          </span>
          <span class="kcal">${Math.round(e.caloriesCalculees)} kcal</span>
        </button>
        <button type="button" class="btn-supprimer" data-id="${e.id}" aria-label="Supprimer ${echapper(e.nomAffiche)}">✕</button>
      </li>
    `).join('');
  });

  await afficherObjectifActif();
  await afficherProgression(totalCaloriesJour, totalProteinesJour, estAujourdhui);
  await verifierDepassement(totalCaloriesJour, estAujourdhui);
}

// Met à jour la carte "Objectif quotidien" en haut de l'écran avec les
// valeurs de l'objectif en cours (celui qui n'a pas encore de dateFin).
async function afficherObjectifActif() {
  const objectif = await objectifActifMaintenant();
  const resume = $('#objectif-resume');

  if (!objectif) {
    resume.textContent = 'Aucun objectif défini';
    return;
  }

  resume.textContent = `${objectif.objectifCalories} kcal · ${objectif.objectifProteines} g de protéines`;
}

// Remplit les deux barres de progression (calories, protéines) à partir
// des totaux du jour consulté et de l'objectif qui s'appliquait ce
// jour-là (utile pour les jours passés, dont l'objectif a pu changer
// depuis). Si aucun objectif n'existait encore à cette date, on affiche
// un message à la place des barres plutôt qu'une division par zéro.
async function afficherProgression(totalCaloriesJour, totalProteinesJour, estAujourdhui) {
  const objectifDuJour = await objectifActifA(jourAffiche);

  const zoneProgression = $('#zone-progression');
  const messageSansObjectif = $('#message-sans-objectif');
  const indicateurHistorique = $('#indicateur-depassement-jour');

  if (!objectifDuJour) {
    zoneProgression.hidden = true;
    messageSansObjectif.hidden = false;
    indicateurHistorique.hidden = true;
    return;
  }

  zoneProgression.hidden = false;
  messageSansObjectif.hidden = true;

  remplirUneBarre({
    valeurActuelle: totalCaloriesJour,
    valeurObjectif: objectifDuJour.objectifCalories,
    unite: 'kcal',
    elementValeurs: $('#calories-valeurs'),
    elementRemplissage: $('#calories-remplissage')
  });

  remplirUneBarre({
    valeurActuelle: totalProteinesJour,
    valeurObjectif: objectifDuJour.objectifProteines,
    unite: 'g',
    elementValeurs: $('#proteines-valeurs'),
    elementRemplissage: $('#proteines-remplissage')
  });

  // Indicateur "ce jour-là" (Phase 6) : seulement pour un jour passé —
  // aujourd'hui a déjà le bandeau rouge (section 7), pas besoin des deux
  // à la fois. Contrairement au bandeau (qui utilise le seuil d'alerte),
  // ici c'est un simple constat : dépassé ou non, sans marge.
  indicateurHistorique.hidden = estAujourdhui || totalCaloriesJour <= objectifDuJour.objectifCalories;
}

// Met à jour une seule barre de progression (texte + largeur + couleur).
function remplirUneBarre({ valeurActuelle, valeurObjectif, unite, elementValeurs, elementRemplissage }) {
  elementValeurs.textContent = `${Math.round(valeurActuelle)} / ${valeurObjectif} ${unite}`;

  const pourcentage = valeurObjectif > 0
    ? Math.min(100, (valeurActuelle / valeurObjectif) * 100)
    : 0;
  elementRemplissage.style.width = `${pourcentage}%`;

  const objectifDepasse = valeurActuelle > valeurObjectif;
  elementRemplissage.classList.toggle('depassement', objectifDepasse);
}

// Neutralise les caractères spéciaux du HTML avant d'insérer un texte
// dans la page. Les guillemets sont traités aussi : le nom d'un produit
// (qui peut venir d'Open Food Facts, une base ouverte à tous) est également
// placé dans un attribut (aria-label="…"), où un guillemet pourrait sinon
// fermer l'attribut et y faire entrer du code.
function echapper(texte) {
  return String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

conteneur.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-supprimer');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const ligne = btn.closest('.ligne-aliment');
  const nom = ligne.querySelector('.nom').textContent;
  await supprimerAliment(id);
  await rafraichirEcran();
  annoncer(`${nom} supprimé.`);
});


/* ============================================================
   6. VUES — bascule Journal / Tendances, sélecteur de date (Phase 6)
   ============================================================ */

const vueJournal = $('#vue-journal');
const vueTendances = $('#vue-tendances');
const blocNavJour = $('#bloc-nav-jour');
const btnVueJournal = $('#btn-vue-journal');
const btnVueTendances = $('#btn-vue-tendances');

// Fait basculer entre la vue "Journal" (jour par jour, existante depuis
// la Phase 1) et la vue "Tendances" (nouvelle, Phase 6). Le bloc de
// navigation entre jours n'a de sens que pour le Journal, on le masque
// donc avec lui plutôt que de le laisser flotter au-dessus d'un
// graphique qu'il ne contrôle pas.
function basculerVue(vue) {
  const surJournal = vue === 'journal';

  vueJournal.hidden = !surJournal;
  vueTendances.hidden = surJournal;
  blocNavJour.hidden = !surJournal;
  document.body.classList.toggle('mode-tendances', !surJournal);

  btnVueJournal.setAttribute('aria-pressed', String(surJournal));
  btnVueTendances.setAttribute('aria-pressed', String(!surJournal));

  if (!surJournal) rafraichirTendances();
}

btnVueJournal.addEventListener('click', () => basculerVue('journal'));
btnVueTendances.addEventListener('click', () => basculerVue('tendances'));

// Sélecteur de date : replié par défaut derrière le bouton 📅, pour
// aller directement à un jour précis plutôt que de cliquer ◀ un grand
// nombre de fois. `max` empêche de choisir une date future via ce
// sélecteur (la navigation ◀▶ le permettait déjà depuis la Phase 1 —
// pas un problème introduit ici, mais pas une raison de l'encourager
// via ce nouveau sélecteur).
const champDate = $('#date-historique');
champDate.max = dateISO(new Date());

$('#btn-choisir-date').addEventListener('click', () => {
  champDate.hidden = !champDate.hidden;
  if (!champDate.hidden) {
    champDate.value = jourAffiche;
    champDate.focus();
    if (champDate.showPicker) champDate.showPicker();
  }
});

champDate.addEventListener('change', () => {
  if (!champDate.value) return;
  jourAffiche = champDate.value;
  champDate.hidden = true;
  rafraichirEcran();
});


/* ============================================================
   7. ALERTES DE DÉPASSEMENT — bandeau in-app + notification push
   ============================================================
   Cas limites à garder en tête en lisant cette section :
   - Le dépassement n'est vérifié QUE pour le jour "aujourd'hui" :
     consulter un jour passé (navigation, section 16) n'affiche jamais
     le bandeau et ne déclenche jamais de notification pour ce jour-là
     — signaler après coup un dépassement d'un jour révolu n'aurait pas
     de sens.
   - Le calcul ne peut se faire qu'au moment où l'app est ouverte et
     qu'un recalcul a lieu (ajout/suppression, changement de jour,
     chargement) : il n'y a pas de vérification en tâche de fond sans
     action de l'utilisateur (hors de portée technique de ce projet,
     voir ARCHITECTURE.md §5).
   - Une seule notification par jour : `dateDerniereAlerteEnvoyee`
     (dans le magasin "parametres") retient la date du dernier envoi.
     Comparer cette date à celle d'aujourd'hui suffit à savoir si une
     notification a déjà été envoyée "aujourd'hui" — nul besoin d'une
     tâche planifiée à minuit pour "réinitialiser" quoi que ce soit :
     dès que la date change, la comparaison redevient naturellement
     fausse. */

const ID_PARAMETRES = 'parametres';

// Renvoie la ligne unique de paramètres, en la créant avec des valeurs
// par défaut si elle n'existe pas encore (tout premier lancement).
async function obtenirParametres() {
  const existants = await BDD.unePar('parametres', ID_PARAMETRES);
  if (existants) return existants;

  const parDefaut = {
    id: ID_PARAMETRES,
    seuilAlerteKcal: 100,
    notificationsPushActivees: false,
    dateDerniereAlerteEnvoyee: null
  };
  await BDD.ajouter('parametres', parDefaut);
  return parDefaut;
}

// Vérifie le dépassement du jour et met à jour le bandeau in-app en
// conséquence ; déclenche en plus une notification si les conditions
// sont réunies (voir `notifierDepassementSiBesoin`). Appelée depuis
// `rafraichirEcran` (section 5), donc à chaque ajout, suppression,
// changement de jour ou chargement de l'écran.
async function verifierDepassement(totalCaloriesJour, estAujourdhui) {
  const bandeau = $('#bandeau-depassement');

  if (!estAujourdhui) {
    bandeau.hidden = true;
    return;
  }

  const objectifDuJour = await objectifActifA(jourAffiche);
  if (!objectifDuJour) {
    bandeau.hidden = true;
    return;
  }

  const parametres = await obtenirParametres();
  const depassement = Math.round(totalCaloriesJour - objectifDuJour.objectifCalories);
  const seuilFranchi = depassement > parametres.seuilAlerteKcal;

  if (!seuilFranchi) {
    bandeau.hidden = true;
    return;
  }

  bandeau.hidden = false;
  bandeau.textContent = `Objectif dépassé de ${depassement} kcal aujourd'hui`;

  await notifierDepassementSiBesoin(depassement, parametres);
}

// Envoie la notification si l'utilisateur l'a activée et qu'aucune
// n'a encore été envoyée aujourd'hui pour un dépassement.
async function notifierDepassementSiBesoin(depassement, parametres) {
  if (!parametres.notificationsPushActivees) return;
  if (parametres.dateDerniereAlerteEnvoyee === jourAffiche) return; // déjà envoyée aujourd'hui

  const envoyee = await envoyerNotificationDepassement(depassement);
  if (!envoyee) return;

  parametres.dateDerniereAlerteEnvoyee = jourAffiche;
  await BDD.remplacer('parametres', parametres);
}

// Déclenche la notification elle-même via le Service Worker (plutôt
// que `new Notification()` directement : plus fiable pour une PWA,
// et c'est le Service Worker qui devra un jour gérer le clic dessus).
// Renvoie `true` si la notification a bien pu être affichée.
async function envoyerNotificationDepassement(depassement) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator)) return false;

  try {
    const enregistrement = await navigator.serviceWorker.ready;
    await enregistrement.showNotification('Objectif calorique dépassé', {
      body: `Vous avez dépassé votre objectif de ${depassement} kcal aujourd'hui.`,
      icon: './icon-192.png',
      badge: './icon-192.png',
      // Un "tag" fixe fait remplacer une éventuelle notification déjà
      // affichée plutôt que d'en empiler une deuxième à côté.
      tag: 'depassement-calorique'
    });
    return true;
  } catch {
    return false;
  }
}


/* ============================================================
   8. DIALOGUE D'AJOUT MANUEL
   ============================================================ */

const dialogue = $('#dialogue-ajout');
const formAjout = $('#form-ajout');
let repasCible = null;

function ouvrirDialogueAjout(repasId) {
  repasCible = repasId;
  const repas = REPAS.find((r) => r.id === repasId);
  $('#dialogue-titre').textContent = `Ajouter à : ${repas.label}`;
  formAjout.reset();
  appliquerUnite(formAjout, 'g');
  dialogue.showModal();
  $('#f-nom').focus();
}

$('#btn-annuler-ajout').addEventListener('click', () => dialogue.close());
brancherVerificationNombres(formAjout);

formAjout.addEventListener('submit', async (e) => {
  const nom = $('#f-nom').value.trim();
  const quantite = lireNombre($('#f-quantite').value);
  const calories = lireNombre($('#f-calories').value);

  // Filet de sécurité : `verifierChampsNombres` a normalement déjà
  // bloqué ces cas avec un message clair.
  if (!nom || !(quantite > 0) || Number.isNaN(calories)) {
    e.preventDefault();
    return;
  }

  await ajouterAliment({
    nom,
    quantite,
    unite: formAjout.elements.unite.value,
    calories,
    // Champs facultatifs : vides (NaN) → 0.
    proteines: lireNombre($('#f-proteines').value) || 0,
    glucides: lireNombre($('#f-glucides').value) || 0,
    lipides: lireNombre($('#f-lipides').value) || 0,
    repas: repasCible
  });

  await rafraichirEcran();
  annoncer(`${nom} ajouté.`);
});


/* ============================================================
   9. CHOIX DU MODE D'AJOUT — scanner, photo d'étiquette ou manuel
   ============================================================ */

const dialogueChoix = $('#dialogue-choix-ajout');

// Ouvre le petit menu affiché quand on appuie sur le "+" d'un repas :
// c'est à partir de là que l'utilisateur choisit comment renseigner
// l'aliment. `repasCible` (déclaré section 8) est réutilisé par tous
// les chemins possibles (favori, scanner, photo, manuel). La liste des
// favoris (section 18) est reconstruite à chaque ouverture.
async function ouvrirChoixAjout(repasId) {
  suivreChangementDeJour(); // l'écran est peut-être resté allumé après minuit
  repasCible = repasId;
  await afficherFavoris();
  // Deux appuis rapides sur "+" : la fenêtre est peut-être déjà ouverte.
  if (!dialogueChoix.open) dialogueChoix.showModal();
}

$('#btn-annuler-choix').addEventListener('click', () => dialogueChoix.close());

$('#btn-choix-manuel').addEventListener('click', () => {
  dialogueChoix.close();
  ouvrirDialogueAjout(repasCible);
});

$('#btn-choix-scanner').addEventListener('click', () => {
  dialogueChoix.close();
  ouvrirScanner();
});

// Le bouton "Photo de l'étiquette" est câblé section 13 (OCR), avec le
// reste de la logique Tesseract.js.


/* ============================================================
   10. SCANNER DE CODE-BARRES — lecture caméra via html5-qrcode
   ============================================================ */

const dialogueScanner = $('#dialogue-scanner');
const etatScanner = $('#scanner-etat');
const zoneErreurScanner = $('#scanner-erreur');
const texteErreurScanner = $('#scanner-erreur-texte');

// Formats de codes-barres recherchés : les deux formats courants sur
// les emballages alimentaires (EAN-13 en Europe, UPC-A en Amérique du
// Nord). Restreindre les formats accélère la détection.
const FORMATS_CODE_BARRES = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.UPC_A
];

// Instance de lecteur créée une seule fois puis réutilisée d'un scan
// à l'autre (start()/stop() peuvent être appelés plusieurs fois sur
// la même instance).
let lecteurCodeBarres = null;

// Empêche de traiter deux fois le même code-barres si la caméra livre
// encore une ou deux images avant que stop() ait pris effet.
let codeBarresDejaTraite = false;

function ouvrirScanner() {
  codeBarresDejaTraite = false;
  zoneErreurScanner.hidden = true;
  etatScanner.textContent = 'Démarrage de la caméra…';
  dialogueScanner.showModal();
  demarrerLectureCodeBarres();
}

async function demarrerLectureCodeBarres() {
  if (!lecteurCodeBarres) {
    lecteurCodeBarres = new Html5Qrcode('lecteur-scanner');
  }

  try {
    await lecteurCodeBarres.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 160 }, formatsToSupport: FORMATS_CODE_BARRES },
      (codeBarresLu) => surCodeBarresDetecte(codeBarresLu),
      () => { /* aucun code-barres détecté sur cette image : normal en lecture continue, on ignore */ }
    );
    etatScanner.textContent = 'Visez le code-barres…';
  } catch (erreur) {
    afficherErreurScanner(messageErreurCamera(erreur));
  }
}

async function arreterLectureCodeBarres() {
  if (lecteurCodeBarres && lecteurCodeBarres.isScanning) {
    try {
      await lecteurCodeBarres.stop();
    } catch {
      /* déjà arrêtée : rien à faire */
    }
  }
}

// Construit un message d'erreur compréhensible selon la cause probable
// de l'échec d'accès à la caméra. Le navigateur transmet parfois
// l'exception d'origine (DOMException) : on s'appuie sur son "name"
// quand il est disponible, avec un message générique en repli sinon.
function messageErreurCamera(erreur) {
  const nom = erreur && erreur.name;

  if (nom === 'NotAllowedError' || nom === 'PermissionDeniedError') {
    return "Accès à la caméra refusé. Le scanner en a besoin pour lire le code-barres de l'emballage : autorisez la caméra pour ce site dans les paramètres de votre navigateur, ou utilisez la saisie manuelle.";
  }
  if (nom === 'NotFoundError' || nom === 'OverconstrainedError') {
    return "Aucune caméra arrière détectée sur cet appareil. Utilisez la saisie manuelle.";
  }
  return "Impossible d'accéder à la caméra (peut-être utilisée par une autre application). Réessayez, ou utilisez la saisie manuelle.";
}

function afficherErreurScanner(message) {
  etatScanner.textContent = '';
  texteErreurScanner.textContent = message;
  zoneErreurScanner.hidden = false;
}

async function surCodeBarresDetecte(codeBarres) {
  if (codeBarresDejaTraite) return;
  codeBarresDejaTraite = true;

  await arreterLectureCodeBarres();
  $('#lecteur-scanner').innerHTML = '';
  await traiterCodeBarres(codeBarres);
}

$('#btn-scanner-reessayer').addEventListener('click', () => {
  zoneErreurScanner.hidden = true;
  codeBarresDejaTraite = false;
  etatScanner.textContent = 'Démarrage de la caméra…';
  demarrerLectureCodeBarres();
});

$('#btn-scanner-saisie-manuelle').addEventListener('click', async () => {
  await arreterLectureCodeBarres();
  dialogueScanner.close();
  ouvrirDialogueAjout(repasCible);
});

$('#btn-annuler-scanner').addEventListener('click', async () => {
  await arreterLectureCodeBarres();
  dialogueScanner.close();
});

// Filet de sécurité : si la boîte de dialogue se ferme par un autre
// chemin que les boutons ci-dessus (touche Échap, par exemple), on
// coupe quand même la caméra pour ne pas laisser le flux vidéo actif.
dialogueScanner.addEventListener('close', () => arreterLectureCodeBarres());


/* ============================================================
   11. RECHERCHE PRODUIT — cache local puis Open Food Facts
   ============================================================ */

const URL_OPEN_FOOD_FACTS = 'https://world.openfoodfacts.org/api/v2/product/';

// Certaines fiches n'indiquent l'énergie qu'en kilojoules (kJ). Plutôt que
// d'afficher 0 kcal (qu'on risquerait de valider sans le voir), on convertit :
// 1 kcal = 4,184 kJ. "energy_100g" est lui aussi exprimé en kJ.
function caloriesDepuisNutriments(n) {
  const kcal = Number(n['energy-kcal_100g']);
  if (n['energy-kcal_100g'] != null && Number.isFinite(kcal)) return kcal;
  const kj = Number(n['energy-kj_100g'] ?? n['energy_100g']);
  return Number.isFinite(kj) && kj > 0 ? Math.round(kj / 4.184) : 0;
}

// Devine si un produit d'Open Food Facts est un liquide, pour proposer
// "ml" d'office à l'écran de confirmation (où l'utilisateur peut
// toujours changer). Deux indices : l'unité de la contenance
// (`product_quantity_unit`, "ml" pour une boisson) ou, à défaut, la
// contenance écrite sur l'emballage (`quantity`, ex. "33 cl", "1,5 L").
// Noms et valeurs vérifiés dans la documentation officielle (schéma
// "Product" d'Open Food Facts : `product_quantity_unit` vaut "g" ou
// "ml", déduit de `quantity`), mais pas par un essai en direct (API
// inaccessible pendant le développement de la Phase 7). S'ils sont
// absents, on retombe simplement sur "g", comme avant.
function uniteDepuisOpenFoodFacts(p) {
  if (String(p.product_quantity_unit || '').toLowerCase() === 'ml') return 'ml';
  return /\d\s*(ml|cl|dl|l|litres?)\b/i.test(String(p.quantity || '')) ? 'ml' : 'g';
}

// Recherche un produit à partir de son code-barres :
// 1. D'abord dans le cache local (magasin "produits"), pour éviter
//    une requête réseau si ce produit a déjà été scanné auparavant.
// 2. Sinon, interroge Open Food Facts et met le résultat en cache
//    pour la prochaine fois.
// En cas d'échec, lève une erreur portant un champ "type" ('reseau'
// ou 'non-trouve') pour que l'appelant affiche le message adapté.
async function rechercherProduit(codeBarres) {
  const dejaEnCache = await BDD.parIndex('produits', 'parCodeBarres', codeBarres);
  if (dejaEnCache.length > 0) {
    return { produit: dejaEnCache[0], depuisCache: true };
  }

  let reponse;
  try {
    reponse = await fetch(`${URL_OPEN_FOOD_FACTS}${codeBarres}.json`);
  } catch {
    throw { type: 'reseau' };
  }
  // L'API v2 répond par une erreur 404 quand le code-barres est inconnu :
  // c'est un produit introuvable, pas un problème de connexion.
  if (reponse.status === 404) throw { type: 'non-trouve' };
  if (!reponse.ok) throw { type: 'reseau' };

  const donnees = await reponse.json();
  // status === 0 : code-barres inconnu d'Open Food Facts (pas une
  // erreur réseau — la requête a bien abouti, le produit n'existe
  // simplement pas dans leur base).
  if (donnees.status === 0 || !donnees.product) throw { type: 'non-trouve' };

  const p = donnees.product;
  const n = p.nutriments || {};
  const produit = {
    codeBarres,
    // Le nom en français d'abord, quand il existe.
    nom: p.product_name_fr || p.product_name || 'Produit sans nom',
    // Certains produits n'ont pas toutes leurs valeurs renseignées sur
    // Open Food Facts (base communautaire) : 0 par défaut, mais reste
    // modifiable par l'utilisateur à l'écran de confirmation.
    caloriesPour100g: caloriesDepuisNutriments(n),
    proteinesPour100g: n['proteins_100g'] ?? 0,
    glucidesPour100g: n['carbohydrates_100g'] ?? 0,
    lipidesPour100g: n['fat_100g'] ?? 0,
    unite: uniteDepuisOpenFoodFacts(p),
    source: 'openfoodfacts'
  };

  const idProduit = await BDD.ajouter('produits', produit);
  produit.id = idProduit;
  return { produit, depuisCache: false };
}

// Enchaîne la recherche du produit après une lecture de code-barres
// réussie (affichée dans la même boîte de dialogue que le scanner, le
// temps de la requête), puis ouvre l'écran de confirmation ou affiche
// l'erreur correspondante.
async function traiterCodeBarres(codeBarres) {
  etatScanner.textContent = 'Recherche du produit…';

  try {
    const { produit, depuisCache } = await rechercherProduit(codeBarres);
    dialogueScanner.close();
    ouvrirConfirmation(produit, depuisCache
      ? 'Produit déjà scanné précédemment (depuis le cache local)'
      : 'Produit trouvé sur Open Food Facts');
  } catch (erreur) {
    if (erreur && erreur.type === 'reseau') {
      afficherErreurScanner("Pas de connexion internet : impossible de vérifier ce produit sur Open Food Facts. Réessayez une fois connecté, ou passez à la saisie manuelle.");
    } else if (erreur && erreur.type === 'non-trouve') {
      afficherErreurScanner("Ce produit n'est pas encore répertorié sur Open Food Facts. Passez à la saisie manuelle en attendant.");
    } else {
      afficherErreurScanner('Une erreur inattendue est survenue lors de la recherche du produit. Réessayez, ou passez à la saisie manuelle.');
    }
  }
}


/* ============================================================
   12. CONFIRMATION POST-SCAN
   ============================================================ */

const dialogueConfirmation = $('#dialogue-confirmation');
const formConfirmation = $('#form-confirmation');

// Produit actuellement affiché dans l'écran de confirmation (retenu
// pour connaître son id et son code-barres au moment de la validation).
// Reste `null` quand la confirmation vient de l'OCR (section 13) plutôt
// que du scanner ou des favoris : il n'y a alors pas encore de produit
// existant à mettre à jour, il faudra en créer un nouveau à la validation.
let produitEnConfirmation = null;

// Pré-remplit l'écran de confirmation avec les valeurs d'un produit
// déjà connu (scanné, ou choisi dans les favoris) ; tous les champs
// restent modifiables par l'utilisateur avant l'ajout définitif au
// journal. `origine` est la petite phrase affichée sous le titre.
function ouvrirConfirmation(produit, origine) {
  produitEnConfirmation = produit;

  $('#confirmation-origine').textContent = origine;

  $('#c-nom').value = produit.nom;
  $('#c-calories').value = nombreVersChamp(produit.caloriesPour100g);
  $('#c-proteines').value = nombreVersChamp(produit.proteinesPour100g);
  $('#c-glucides').value = nombreVersChamp(produit.glucidesPour100g);
  $('#c-lipides').value = nombreVersChamp(produit.lipidesPour100g);
  $('#c-quantite').value = 100;
  $('#c-repas').value = repasCible;
  appliquerUnite(formConfirmation, uniteDe(produit));

  mettreAJourCalculConfirmation();
  dialogueConfirmation.showModal();
  $('#c-nom').focus();
}

// Recalcule "calories et protéines pour la quantité saisie" à chaque
// frappe, à partir des valeurs pour 100 g actuellement dans le
// formulaire (elles peuvent avoir été corrigées par l'utilisateur).
function mettreAJourCalculConfirmation() {
  const quantite = lireNombre($('#c-quantite').value) || 0;
  const calories = lireNombre($('#c-calories').value) || 0;
  const proteines = lireNombre($('#c-proteines').value) || 0;

  $('#confirmation-calories-calc').textContent = `${formaterNombre(pourQuantite(calories, quantite))} kcal`;
  $('#confirmation-proteines-calc').textContent = `${formaterNombre(pourQuantite(proteines, quantite))} g`;
}

['c-quantite', 'c-calories', 'c-proteines'].forEach((id) => {
  $('#' + id).addEventListener('input', mettreAJourCalculConfirmation);
});

$('#btn-annuler-confirmation').addEventListener('click', () => dialogueConfirmation.close());
brancherVerificationNombres(formConfirmation);

// Ajoute au journal un aliment dont la fiche existe déjà : produit
// identifié via le scanner, ou choisi dans les favoris. Contrairement
// à l'ajout manuel (qui crée toujours un nouveau produit "manuel"),
// on met ici à jour la fiche existante plutôt que d'en créer un
// doublon — utile si l'utilisateur vient de corriger une valeur
// erronée à l'écran de confirmation. Le reste de la fiche (code-barres,
// origine, marque "favori") est recopié tel quel grâce à `...produit` :
// sans cela, valider un produit lui ferait perdre sa place dans les favoris.
async function ajouterAlimentConnu({ produit, nom, quantite, unite, calories, proteines, glucides, lipides, repas }) {
  await BDD.remplacer('produits', {
    ...produit,
    nom,
    caloriesPour100g: calories,
    proteinesPour100g: proteines,
    glucidesPour100g: glucides,
    lipidesPour100g: lipides,
    unite
  });

  await BDD.ajouter('journal', nouvelleEntree({
    repas,
    // Un produit scanné reste désigné par son code-barres (comme depuis
    // la Phase 3) ; une fiche sans code-barres (favori saisi à la main
    // ou lu sur une photo) par son numéro.
    produitRef: produit.codeBarres ?? produit.id,
    nom,
    quantite,
    unite,
    calories,
    proteines,
    glucides,
    lipides
  }));
}

formConfirmation.addEventListener('submit', async (e) => {
  const nom = $('#c-nom').value.trim();
  const quantite = lireNombre($('#c-quantite').value);
  const calories = lireNombre($('#c-calories').value);

  if (!nom || !(quantite > 0) || Number.isNaN(calories)) {
    e.preventDefault();
    return;
  }

  const valeursCommunes = {
    nom,
    quantite,
    calories,
    proteines: lireNombre($('#c-proteines').value) || 0,
    glucides: lireNombre($('#c-glucides').value) || 0,
    lipides: lireNombre($('#c-lipides').value) || 0,
    unite: formConfirmation.elements.unite.value,
    repas: $('#c-repas').value
  };

  if (produitEnConfirmation) {
    // Produit déjà connu (scanner ou favoris) : on met à jour
    // l'enregistrement existant plutôt que d'en créer un doublon.
    await ajouterAlimentConnu({ ...valeursCommunes, produit: produitEnConfirmation });
  } else {
    // Confirmation venue de l'OCR (section 13) : aucun produit existant,
    // on en crée un nouveau comme pour un ajout manuel.
    await ajouterAliment({ ...valeursCommunes, source: 'ocr' });
  }

  await rafraichirEcran();
  annoncer(`${nom} ajouté.`);
});


/* ============================================================
   13. PHOTO DE L'ÉTIQUETTE — OCR via Tesseract.js
   ============================================================
   Contrairement au scanner (Phase 3, lecture caméra en continu),
   l'OCR se fait sur UNE photo fixe : plus simple à intégrer, et
   suffisant pour une étiquette qui ne bouge pas. On utilise pour
   cela un <input type="file" capture="environment">, qui ouvre
   directement l'appareil photo sur mobile. */

const entreePhotoEtiquette = $('#entree-photo-etiquette');
const dialogueOcr = $('#dialogue-ocr');
const etatOcr = $('#ocr-etat');
const barreProgressionOcr = $('#ocr-barre-progression');
const zoneErreurOcr = $('#ocr-erreur');
const texteErreurOcr = $('#ocr-erreur-texte');

// Durée maximale accordée à l'ANALYSE d'une photo avant d'abandonner
// (évite de laisser l'utilisateur bloqué sans retour si le traitement
// s'éternise sur un appareil lent). Le tout premier téléchargement du
// moteur et du modèle de langue (voir plus bas) n'est volontairement
// pas concerné par ce délai : il peut légitimement prendre plus de
// temps sur une connexion lente, et ne se reproduit qu'une seule fois.
const DELAI_MAX_ANALYSE_OCR_MS = 30000;

// Worker Tesseract.js, créé une seule fois puis réutilisé d'une photo
// à l'autre (le créer a un coût : chargement du moteur WebAssembly et
// du modèle de langue française — voir `obtenirTravailleurOcr`).
let travailleurOcr = null;

// Traduction (approximative) des statuts internes de Tesseract.js
// affichés pendant le chargement, pour que l'utilisateur comprenne ce
// qui se passe la première fois (téléchargement du modèle) plutôt que
// de voir un texte figé plusieurs secondes.
const LIBELLES_ETAPES_OCR = {
  'loading tesseract core': 'Chargement du moteur de reconnaissance…',
  'initializing tesseract': 'Initialisation…',
  'loading language traineddata': 'Téléchargement du modèle de français (une seule fois, réutilisé ensuite hors connexion)…',
  'initializing api': 'Initialisation…',
  'recognizing text': 'Analyse de la photo…'
};

$('#btn-choix-photo').addEventListener('click', () => {
  dialogueChoix.close();
  entreePhotoEtiquette.click();
});

entreePhotoEtiquette.addEventListener('change', async () => {
  const fichier = entreePhotoEtiquette.files[0];
  entreePhotoEtiquette.value = ''; // permet de reprendre la même photo une deuxième fois si besoin
  if (fichier) await analyserPhotoEtiquette(fichier);
});

// Crée le worker Tesseract.js au premier besoin. Les chemins pointent
// vers les copies locales dans lib/tesseract/ (pas de CDN — cohérent
// avec html5-qrcode en Phase 3). On calcule des URL absolues plutôt
// que relatives : le worker s'exécute dans un contexte séparé (via une
// URL "blob:") où un chemin relatif peut se résoudre différemment
// selon le navigateur.
function urlAbsolue(cheminRelatif) {
  return new URL(cheminRelatif, document.baseURI).href;
}

async function obtenirTravailleurOcr() {
  if (!travailleurOcr) {
    travailleurOcr = await Tesseract.createWorker('fra', Tesseract.OEM.LSTM_ONLY, {
      workerPath: urlAbsolue('./lib/tesseract/worker.min.js'),
      // Un seul fichier core (sans détection SIMD automatique) : un peu
      // moins rapide sur les appareils récents, mais garanti de
      // fonctionner partout et beaucoup plus simple à mettre en cache
      // intégralement pour l'usage hors-ligne (un seul fichier à
      // télécharger plutôt que plusieurs variantes possibles).
      corePath: urlAbsolue('./lib/tesseract/tesseract-core-lstm.wasm.js'),
      langPath: urlAbsolue('./lib/tesseract/lang-data'),
      logger: (m) => {
        etatOcr.textContent = LIBELLES_ETAPES_OCR[m.status] || etatOcr.textContent;
        if (m.status === 'recognizing text') {
          barreProgressionOcr.style.width = `${Math.round(m.progress * 100)}%`;
        }
      }
    });
  }
  return travailleurOcr;
}

async function terminerTravailleurOcr() {
  if (travailleurOcr) {
    try {
      await travailleurOcr.terminate();
    } catch {
      /* déjà arrêté : rien à faire */
    }
    travailleurOcr = null;
  }
}

function delaiExpire(ms) {
  return new Promise((_resoudre, rejeter) => {
    setTimeout(() => rejeter({ type: 'delai-depasse' }), ms);
  });
}

function afficherErreurOcr(message) {
  etatOcr.textContent = '';
  texteErreurOcr.textContent = message;
  zoneErreurOcr.hidden = false;
}

async function analyserPhotoEtiquette(fichier) {
  zoneErreurOcr.hidden = true;
  barreProgressionOcr.style.width = '0%';
  etatOcr.textContent = 'Préparation…';
  dialogueOcr.showModal();

  try {
    const travailleur = await obtenirTravailleurOcr();
    if (!dialogueOcr.open) return; // annulé pendant le chargement

    const { data } = await Promise.race([
      travailleur.recognize(fichier),
      delaiExpire(DELAI_MAX_ANALYSE_OCR_MS)
    ]);
    if (!dialogueOcr.open) return; // annulé pendant l'analyse

    const valeurs = extraireValeursNutritionnelles(data.text || '');
    const auMoinsUneValeurTrouvee = Object.values(valeurs).some((v) => v !== null);

    if (!auMoinsUneValeurTrouvee) {
      afficherErreurOcr("Aucune valeur nutritionnelle n'a pu être repérée sur la photo. Reprenez la photo bien cadrée sur le tableau nutritionnel, ou passez à la saisie manuelle.");
      return;
    }

    dialogueOcr.close();
    ouvrirConfirmationOcr(valeurs, uniteDepuisTexteEtiquette(data.text || ''));
  } catch (erreur) {
    if (!dialogueOcr.open) return; // annulé entre-temps

    if (erreur && erreur.type === 'delai-depasse') {
      // Le worker peut être resté occupé en arrière-plan : on le
      // recrée proprement pour la prochaine tentative plutôt que de le
      // réutiliser dans un état incertain.
      await terminerTravailleurOcr();
      afficherErreurOcr("L'analyse prend trop de temps. Réessayez avec une photo plus nette, ou passez à la saisie manuelle.");
    } else {
      afficherErreurOcr("Une erreur inattendue est survenue pendant l'analyse. Réessayez, ou passez à la saisie manuelle.");
    }
  }
}

// Pré-remplit l'écran de confirmation (partagé avec le scanner, Phase 3)
// avec les valeurs lues par l'OCR. Le nom est laissé vide : un nom
// deviné à partir du texte brut de l'étiquette serait peu fiable (ce
// n'est presque jamais la première ligne lisible), mieux vaut le faire
// saisir par l'utilisateur que proposer une valeur hasardeuse.
function ouvrirConfirmationOcr(valeurs, unite) {
  produitEnConfirmation = null;

  $('#confirmation-origine').textContent = 'Valeurs lues automatiquement sur la photo — à vérifier avant de valider';

  $('#c-nom').value = '';
  $('#c-calories').value = nombreVersChamp(valeurs.calories);
  $('#c-proteines').value = nombreVersChamp(valeurs.proteines);
  $('#c-glucides').value = nombreVersChamp(valeurs.glucides);
  $('#c-lipides').value = nombreVersChamp(valeurs.lipides);
  $('#c-quantite').value = 100;
  $('#c-repas').value = repasCible;
  appliquerUnite(formConfirmation, unite);

  mettreAJourCalculConfirmation();
  dialogueConfirmation.showModal();
  $('#c-nom').focus();
}

$('#btn-annuler-ocr').addEventListener('click', () => dialogueOcr.close());

$('#btn-ocr-reprendre-photo').addEventListener('click', () => {
  zoneErreurOcr.hidden = true;
  dialogueOcr.close();
  entreePhotoEtiquette.click();
});

$('#btn-ocr-saisie-manuelle').addEventListener('click', () => {
  dialogueOcr.close();
  ouvrirDialogueAjout(repasCible);
});


/* ============================================================
   14. EXTRACTION DES VALEURS NUTRITIONNELLES DEPUIS LE TEXTE OCR
   ============================================================
   Le texte renvoyé par Tesseract est brut : sauts de ligne pas
   toujours là où on les attend, caractères mal reconnus, accents
   parfois perdus. La logique ci-dessous reste volontairement simple
   (recherche par mots-clés) plutôt que de tenter de reconstruire la
   mise en page d'origine du tableau nutritionnel. */

// Mots-clés recherchés pour chaque valeur (en minuscules, sans accents
// — voir `normaliser` ci-dessous). "kcal" est traité séparément avec
// une recherche plus précise, voir `chercherCalories`.
const MOTS_CLES_NUTRIMENTS = {
  calories:  ['energie', 'kcal'],
  proteines: ['proteines'],
  glucides:  ['glucides'],
  lipides:   ['lipides', 'matieres grasses', 'matiere grasse']
};

// Retire les accents et met en minuscules, pour comparer un texte
// potentiellement mal reconnu sans se soucier des accents manqués ou
// déformés par l'OCR (ex. "Énergie" lu "Enerqie" reste comparable à
// "energie" une fois les accents ôtés).
function normaliser(texte) {
  return texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Extrait tous les nombres d'une ligne de texte. L'OCR peut renvoyer
// la virgule française ("6,3") ou un point : les deux sont acceptés.
function nombresDansLigne(ligne) {
  const correspondances = ligne.match(/\d+(?:[.,]\d+)?/g) || [];
  return correspondances.map((n) => Number(n.replace(',', '.')));
}

// Cherche, pour un ensemble de mots-clés donné (une seule valeur —
// protéines, glucides ou lipides), le nombre le plus proche : d'abord
// sur la même ligne que le mot-clé (comme dans "Protéines ... 6,3 g"),
// puis sur la ligne suivante si celle du mot-clé ne contient aucun
// nombre (certaines étiquettes mettent la valeur juste en dessous).
//
// Limite connue : quand une étiquette présente deux colonnes ("pour
// 100 g" et "par portion"), les deux valeurs peuvent atterrir sur la
// même ligne reconnue par l'OCR. On prend alors la première trouvée,
// ce qui correspond à la colonne "pour 100 g" sur la grande majorité
// des étiquettes françaises (toujours affichée en premier) — mais
// peut se tromper sur une mise en page inhabituelle, d'où l'écran de
// correction qui suit, où toutes les valeurs restent modifiables.
function chercherValeur(lignes, motsCles) {
  for (let i = 0; i < lignes.length; i++) {
    const ligneNormalisee = normaliser(lignes[i]);
    const contientMotCle = motsCles.some((mot) => ligneNormalisee.includes(mot));
    if (!contientMotCle) continue;

    const nombresLigne = nombresDansLigne(lignes[i]);
    if (nombresLigne.length > 0) return nombresLigne[0];

    if (i + 1 < lignes.length) {
      const nombresLigneSuivante = nombresDansLigne(lignes[i + 1]);
      if (nombresLigneSuivante.length > 0) return nombresLigneSuivante[0];
    }
  }
  return null;
}

// Les calories ont un traitement à part : sur une étiquette française,
// l'énergie est presque toujours donnée en kJ ET en kcal sur la même
// ligne (ex. "2255 kJ / 539 kcal"). Une recherche générique par ligne
// risquerait de renvoyer le kJ au lieu du kcal (le premier nombre de la
// ligne). On cherche donc d'abord, dans tout le texte, un nombre collé
// au mot "kcal" — motif très fiable sur les étiquettes réelles — et on
// ne retombe sur la recherche générique que si ce motif est absent.
function chercherCalories(texteBrut, lignes) {
  const correspondanceKcal = texteBrut.match(/(\d+(?:[.,]\d+)?)\s*k\s*cal/i);
  if (correspondanceKcal) return Number(correspondanceKcal[1].replace(',', '.'));

  return chercherValeur(lignes, MOTS_CLES_NUTRIMENTS.calories);
}

// Une étiquette de boisson donne ses valeurs "pour 100 ml" : si cette
// mention est lue sur la photo, l'écran de confirmation propose "ml"
// d'office (Phase 7). L'OCR sépare parfois les lettres ("100 m l"),
// d'où les espaces facultatifs.
function uniteDepuisTexteEtiquette(texteBrut) {
  return /100\s*m\s*l\b/i.test(texteBrut) ? 'ml' : 'g';
}

// Point d'entrée : analyse le texte brut renvoyé par Tesseract et tente
// d'en extraire les quatre valeurs nutritionnelles pour 100 g. Une
// valeur non trouvée vaut `null` (jamais 0, pour ne pas confondre
// "non trouvé" et "vraiment égal à zéro" sur l'écran de confirmation).
function extraireValeursNutritionnelles(texteBrut) {
  const lignes = texteBrut.split('\n').map((l) => l.trim()).filter(Boolean);

  return {
    calories:  chercherCalories(texteBrut, lignes),
    proteines: chercherValeur(lignes, MOTS_CLES_NUTRIMENTS.proteines),
    glucides:  chercherValeur(lignes, MOTS_CLES_NUTRIMENTS.glucides),
    lipides:   chercherValeur(lignes, MOTS_CLES_NUTRIMENTS.lipides)
  };
}


/* ============================================================
   15. DIALOGUE OBJECTIF ET ÉCRAN DE PREMIER LANCEMENT
   ============================================================ */

const dialogueObjectif = $('#dialogue-objectif');
const formObjectif = $('#form-objectif');

// Ouvre la boîte de dialogue "Objectif quotidien", pré-remplie avec les
// valeurs de l'objectif actuellement actif s'il y en a un.
async function ouvrirDialogueObjectif() {
  const objectifActuel = await objectifActifMaintenant();

  $('#f-objectif-calories').value = objectifActuel ? objectifActuel.objectifCalories : '';
  $('#f-objectif-proteines').value = objectifActuel ? objectifActuel.objectifProteines : '';

  await synchroniserCaseNotifications();

  dialogueObjectif.showModal();
  $('#f-objectif-calories').focus();
}

$('#btn-modifier-objectif').addEventListener('click', ouvrirDialogueObjectif);
$('#btn-annuler-objectif').addEventListener('click', () => dialogueObjectif.close());


/* ---- Activation des notifications de dépassement (Phase 5) ----
   Volontairement dans ce dialogue plutôt qu'au premier lancement de
   l'app : demander la permission navigateur seulement quand
   l'utilisateur vient lui-même de cocher la case, jamais tout seul. */

const caseNotifications = $('#f-notifications-activees');
const etatNotifications = $('#notifications-etat');

function afficherEtatNotifications(message) {
  etatNotifications.textContent = message;
  etatNotifications.hidden = !message;
}

async function enregistrerPreferenceNotifications(activee) {
  const parametres = await obtenirParametres();
  parametres.notificationsPushActivees = activee;
  await BDD.remplacer('parametres', parametres);
}

// Aligne l'affichage de la case sur l'état réel à chaque ouverture du
// dialogue : si l'utilisateur a retiré la permission depuis les
// réglages de son navigateur (en dehors de l'app) depuis la dernière
// fois, on ne doit pas laisser la case cochée comme si de rien n'était.
async function synchroniserCaseNotifications() {
  const parametres = await obtenirParametres();
  const permissionSupportee = 'Notification' in window;
  const permissionRefusee = permissionSupportee && Notification.permission === 'denied';

  if (permissionRefusee && parametres.notificationsPushActivees) {
    parametres.notificationsPushActivees = false;
    await BDD.remplacer('parametres', parametres);
  }

  caseNotifications.checked = permissionSupportee && !permissionRefusee && parametres.notificationsPushActivees;
  caseNotifications.disabled = !permissionSupportee || permissionRefusee;

  if (!permissionSupportee) {
    afficherEtatNotifications('Les notifications ne sont pas prises en charge par ce navigateur.');
  } else if (permissionRefusee) {
    afficherEtatNotifications('Notifications bloquées pour ce site. Autorisez-les dans les paramètres de votre navigateur si vous changez d\'avis.');
  } else {
    afficherEtatNotifications('');
  }
}

caseNotifications.addEventListener('change', async () => {
  if (!caseNotifications.checked) {
    await enregistrerPreferenceNotifications(false);
    afficherEtatNotifications('');
    return;
  }

  // L'utilisateur vient de cocher la case : c'est le moment de demander
  // la permission au navigateur, seulement si elle n'a encore jamais
  // été demandée ('default'). Si elle a déjà été refusée, le navigateur
  // ne redemande de toute façon rien tout seul — inutile d'insister.
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    caseNotifications.checked = false;
    await enregistrerPreferenceNotifications(false);
    afficherEtatNotifications('Permission refusée : activez les notifications pour ce site dans les paramètres de votre navigateur si vous changez d\'avis.');
    return;
  }

  await enregistrerPreferenceNotifications(true);
  afficherEtatNotifications('');
});

formObjectif.addEventListener('submit', async (e) => {
  const calories = Number($('#f-objectif-calories').value);
  const proteines = Number($('#f-objectif-proteines').value);

  if (!calories || !proteines) {
    e.preventDefault();
    return;
  }

  await definirNouvelObjectif(calories, proteines);
  await rafraichirEcran();
  annoncer('Objectif mis à jour.');
});

// Écran affiché uniquement au tout premier lancement, quand aucun
// objectif n'a jamais été défini : il bloque visuellement l'accès au
// journal tant que l'utilisateur n'a pas choisi un objectif de départ.
const vueOnboarding = $('#vue-onboarding');
const formOnboarding = $('#form-onboarding');

formOnboarding.addEventListener('submit', async (e) => {
  e.preventDefault();

  const calories = Number($('#ob-calories').value);
  const proteines = Number($('#ob-proteines').value);
  if (!calories || !proteines) return;

  await definirNouvelObjectif(calories, proteines);
  vueOnboarding.hidden = true;
  await rafraichirEcran();
});


/* ============================================================
   16. NAVIGATION ENTRE LES JOURS
   ============================================================ */

function changerJour(delta) {
  const d = new Date(jourAffiche + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  jourAffiche = dateISO(d);
  rafraichirEcran();
}

// Une application installée peut rester ouverte en arrière-plan pendant
// des heures. Si on la quitte le soir sur « Aujourd'hui » et qu'on y
// revient le lendemain matin, il faut passer au nouveau jour : sinon le
// petit-déjeuner serait ajouté au journal de la veille.
let dernierAujourdhui = dateISO(new Date());

function suivreChangementDeJour() {
  const maintenant = dateISO(new Date());
  if (maintenant === dernierAujourdhui) return;
  if (jourAffiche === dernierAujourdhui) jourAffiche = maintenant;
  dernierAujourdhui = maintenant;
  champDate.max = maintenant;
  rafraichirEcran();
  if (!vueTendances.hidden) rafraichirTendances();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') suivreChangementDeJour();
});

$('#btn-jour-prec').addEventListener('click', () => changerJour(-1));
$('#btn-jour-suiv').addEventListener('click', () => changerJour(1));
$('#btn-jour-txt').addEventListener('click', () => {
  jourAffiche = dateISO(new Date());
  rafraichirEcran();
});


/* ============================================================
   17. TENDANCES — aperçu des 7 derniers jours (Phase 6)
   ============================================================
   Volontairement un simple graphique en barres en CSS (pas de canvas,
   pas de bibliothèque de graphiques) : sept colonnes recalculées à
   chaque affichage de la vue, rien de plus. */

// Rassemble, pour chacun des 7 derniers jours (aujourd'hui inclus), le
// total calorique et l'objectif qui était actif ce jour-là (celui-ci
// peut différer d'un jour à l'autre si l'utilisateur l'a modifié entre
// temps — voir `objectifActifA`, section 4).
async function calculerTendances7Jours() {
  const jours = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = dateISO(d);

    const entrees = await entreesDuJour(iso);
    const total = entrees.reduce((s, e) => s + e.caloriesCalculees, 0);
    const objectifDuJour = await objectifActifA(iso);

    jours.push({
      iso,
      total,
      objectifCalories: objectifDuJour ? objectifDuJour.objectifCalories : null
    });
  }

  return jours;
}

// (Re)dessine le graphique et le résumé texte au-dessus. Appelée à
// chaque fois qu'on bascule sur la vue Tendances (section 6) : les
// données ne sont donc jamais périmées, au prix d'un petit recalcul à
// chaque fois — largement assez rapide vu le volume (7 jours).
async function rafraichirTendances() {
  const jours = await calculerTendances7Jours();
  const aujourdhui = dateISO(new Date());

  // Échelle commune aux 7 colonnes : le plus grand des totaux et des
  // objectifs de la période, avec une petite marge (×1.1) pour que la
  // barre la plus haute ne touche pas juste le bord du graphique.
  const maxObjectif = Math.max(0, ...jours.map((j) => j.objectifCalories || 0));
  const maxTotal = Math.max(0, ...jours.map((j) => j.total));
  const echelleMax = Math.max(maxObjectif, maxTotal, 1) * 1.1;

  $('#graphique-tendances').innerHTML = jours.map((j) => {
    const hauteurBarre = Math.min(100, (j.total / echelleMax) * 100);
    const hauteurObjectif = j.objectifCalories !== null
      ? Math.min(100, (j.objectifCalories / echelleMax) * 100)
      : null;
    const depasse = j.objectifCalories !== null && j.total > j.objectifCalories;
    const libelleCourt = new Date(j.iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short' });
    const infobulle = j.objectifCalories !== null
      ? `${Math.round(j.total)} kcal (objectif ${j.objectifCalories} kcal)`
      : `${Math.round(j.total)} kcal`;

    return `
      <div class="colonne-tendance${j.iso === aujourdhui ? ' aujourdhui' : ''}">
        <div class="piste-tendance" title="${echapper(infobulle)}">
          ${hauteurObjectif !== null ? `<div class="ligne-objectif" style="bottom:${hauteurObjectif}%"></div>` : ''}
          <div class="barre-tendance${depasse ? ' depassement' : ''}" style="height:${hauteurBarre}%"></div>
        </div>
        <span class="etiquette-jour">${echapper(libelleCourt)}</span>
      </div>
    `;
  }).join('');

  const resume = $('#tendances-resume');
  const joursAvecObjectif = jours.filter((j) => j.objectifCalories !== null);

  if (joursAvecObjectif.length === 0) {
    resume.textContent = "Aucun objectif n'était défini sur cette période.";
    return;
  }

  const moyenne = Math.round(jours.reduce((s, j) => s + j.total, 0) / jours.length);
  const nbDepassements = joursAvecObjectif.filter((j) => j.total > j.objectifCalories).length;
  resume.textContent = `Moyenne : ${moyenne} kcal/jour sur 7 jours · objectif dépassé ${nbDepassements} jour${nbDepassements > 1 ? 's' : ''}.`;
}


/* ============================================================
   18. FAVORIS — étoile sur le journal, liste dans la fenêtre d'ajout
   ============================================================
   Un favori est simplement une fiche du magasin "produits" qui porte
   `favori: true`. Les fiches enregistrées avant cette fonctionnalité
   n'ont pas ce champ : elles sont lues comme "pas favori", aucune
   conversion des anciennes données n'est donc nécessaire. */

// Construit le bouton étoile d'une ligne du journal. Sans fiche produit
// retrouvée (cas qui ne devrait pas arriver), on laisse un espace vide
// de la même largeur pour garder les lignes alignées.
function htmlBoutonFavori(entree, produit) {
  if (!produit) return '<span class="btn-favori-vide" aria-hidden="true"></span>';

  const estFavori = produit.favori === true;
  return `
    <button type="button" class="btn-favori" data-id="${entree.id}"
            aria-pressed="${estFavori}" aria-label="Favori : ${echapper(entree.nomAffiche)}"
            title="${estFavori ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${estFavori ? '★' : '☆'}</button>`;
}

// Ajoute la fiche aux favoris, ou l'en retire si elle y était déjà.
// Renvoie le nouvel état (true = c'est maintenant un favori).
async function basculerFavori(produit) {
  produit.favori = !produit.favori;
  await BDD.remplacer('produits', produit);
  return produit.favori;
}

// Appui sur l'étoile d'une ligne du journal.
conteneur.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-favori');
  if (!btn) return;

  const id = Number(btn.dataset.id);
  const entree = await BDD.unePar('journal', id);
  const produit = entree ? await produitDeLEntree(entree) : null;
  if (!produit) return;

  const estFavori = await basculerFavori(produit);
  await rafraichirEcran();
  // L'écran vient d'être redessiné : on remet le focus sur la nouvelle
  // étoile pour ne pas perdre sa place (clavier, lecteur d'écran).
  const nouvelleEtoile = conteneur.querySelector(`.btn-favori[data-id="${id}"]`);
  if (nouvelleEtoile) nouvelleEtoile.focus();
  annoncer(estFavori ? `${produit.nom} ajouté aux favoris.` : `${produit.nom} retiré des favoris.`);
});

const listeFavoris = $('#liste-favoris');
const messageFavorisVide = $('#favoris-vide');

// Tous les favoris, classés par ordre alphabétique.
async function produitsFavoris() {
  const produits = await BDD.tout('produits');
  return produits
    .filter((p) => p.favori === true)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

// (Re)construit la liste des favoris dans la fenêtre "Ajouter un aliment".
async function afficherFavoris() {
  const favoris = await produitsFavoris();
  messageFavorisVide.hidden = favoris.length > 0;

  listeFavoris.innerHTML = favoris.map((p) => `
    <li class="ligne-favori">
      <button type="button" class="btn-choisir-favori" data-id="${p.id}">
        <span class="nom">${echapper(p.nom)}</span>
        <span class="detail">${formaterNombre(p.caloriesPour100g)} kcal / 100 ${uniteDe(p)}</span>
      </button>
      <button type="button" class="btn-retirer-favori" data-id="${p.id}"
              aria-label="Retirer ${echapper(p.nom)} des favoris" title="Retirer des favoris">★</button>
    </li>
  `).join('');
}

listeFavoris.addEventListener('click', async (e) => {
  // Étoile pleine à droite d'un favori : on le retire de la liste.
  const btnRetirer = e.target.closest('.btn-retirer-favori');
  if (btnRetirer) {
    const produit = await BDD.unePar('produits', Number(btnRetirer.dataset.id));
    if (!produit || !produit.favori) return;
    await basculerFavori(produit);
    await afficherFavoris();
    await rafraichirEcran(); // les étoiles du journal suivent le changement
    annoncer(`${produit.nom} retiré des favoris.`);
    return;
  }

  // Nom d'un favori : on passe directement à l'écran de confirmation
  // (le même que pour un produit scanné), le curseur dans la quantité,
  // puisque c'est la seule chose qui change d'une fois sur l'autre.
  const btnChoisir = e.target.closest('.btn-choisir-favori');
  if (btnChoisir) {
    const produit = await BDD.unePar('produits', Number(btnChoisir.dataset.id));
    if (!produit) return;
    dialogueChoix.close();
    ouvrirConfirmation(produit, 'Depuis vos favoris — valeurs modifiables avant l\'ajout');
    $('#c-quantite').focus();
    $('#c-quantite').select();
  }
});


/* ============================================================
   19. DÉTAIL D'UN ALIMENT DU JOURNAL — et modification de la quantité
   ============================================================
   Toucher un aliment du journal (son nom ou ses calories) ouvre une
   fenêtre avec ses calories et macronutriments pour la quantité
   consommée, à côté des valeurs pour 100 g. La quantité et l'unité
   (g / ml) y sont modifiables : le tableau suit la saisie, et
   "Enregistrer" met à jour la ligne et les totaux du jour. Comme la
   suppression, la modification reste possible sur un jour passé, pour
   corriger une erreur. */

const dialogueDetail = $('#dialogue-detail');
const formDetail = $('#form-detail');
const champQuantiteDetail = $('#d-quantite');

// Ligne du journal affichée dans la fenêtre de détail.
let entreeEnDetail = null;

conteneur.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-detail');
  if (!btn) return;
  await ouvrirDetail(Number(btn.dataset.id));
});

async function ouvrirDetail(id) {
  const entree = await lireEntreeComplete(id);
  if (!entree) return;
  entreeEnDetail = entree;

  const repas = REPAS.find((r) => r.id === entree.repas);
  $('#detail-nom').textContent = entree.nomAffiche;
  $('#detail-contexte').textContent = `${repas ? repas.label : ''} · ${libelleJour(entree.date)}`;
  champQuantiteDetail.value = nombreVersChamp(entree.quantiteGrammes);
  appliquerUnite(formDetail, uniteDe(entree));
  afficherTableauNutrition(entree, entree.quantiteGrammes);

  if (!dialogueDetail.open) dialogueDetail.showModal();
}

// Valeurs "consommées" d'une ligne pour une quantité donnée. Pour la
// quantité enregistrée, on reprend les valeurs de la ligne elle-même
// (exactement celles comptées dans les totaux) ; pour une autre
// quantité, on les recalcule à partir des valeurs pour 100 g.
function valeursPourQuantite(entree, quantite) {
  const e = quantite === entree.quantiteGrammes
    ? entree
    : calculerValeursEntree({ ...entree, quantiteGrammes: quantite });
  return {
    calories: e.caloriesCalculees,
    proteines: e.proteinesCalculees,
    glucides: e.glucidesCalculees,
    lipides: e.lipidesCalculees
  };
}

// Remplit le tableau "Pour X g | Pour 100 g". Une valeur inconnue (une
// ancienne ligne dont la fiche produit est introuvable) est affichée
// comme telle, jamais remplacée par un 0 trompeur. `unite` : celle en
// cours de choix dans la fenêtre (par défaut, celle de la ligne).
function afficherTableauNutrition(entree, quantite, unite = uniteDe(entree)) {
  const consomme = valeursPourQuantite(entree, quantite);
  const lignes = [
    { libelle: 'Calories',  consomme: consomme.calories,  pour100g: entree.caloriesPour100g,  unite: 'kcal' },
    { libelle: 'Protéines', consomme: consomme.proteines, pour100g: entree.proteinesPour100g, unite: 'g' },
    { libelle: 'Glucides',  consomme: consomme.glucides,  pour100g: entree.glucidesPour100g,  unite: 'g' },
    { libelle: 'Lipides',   consomme: consomme.lipides,   pour100g: entree.lipidesPour100g,   unite: 'g' }
  ];
  const cellule = (valeur, unite) => (valeur === null || valeur === undefined
    ? '<span class="valeur-inconnue">non renseigné</span>'
    : `${formaterNombre(valeur)} ${unite}`);

  $('#detail-entete-quantite').textContent = `Pour ${formaterNombre(quantite, 2)} ${unite}`;
  $('#detail-lignes').innerHTML = lignes.map((l) => `
    <tr>
      <th scope="row">${l.libelle}</th>
      <td>${cellule(l.consomme, l.unite)}</td>
      <td>${cellule(l.pour100g, l.unite)}</td>
    </tr>
  `).join('');
  $('#detail-valeurs-inconnues').hidden = lignes.every((l) => l.pour100g !== null && l.pour100g !== undefined);
}

$('#btn-fermer-detail').addEventListener('click', () => dialogueDetail.close());
brancherVerificationNombres(formDetail);

// Le tableau et les libellés suivent la saisie en cours : quantité
// tapée (tant qu'elle est valide, sinon celle enregistrée) et unité
// cochée, pour voir l'effet du changement avant de l'enregistrer.
function rafraichirTableauDetail() {
  if (!entreeEnDetail) return;
  const quantiteTapee = lireNombre(champQuantiteDetail.value);
  const quantite = quantiteTapee > 0 ? quantiteTapee : entreeEnDetail.quantiteGrammes;
  const unite = formDetail.elements.unite.value;
  afficherUnite(formDetail, unite);
  afficherTableauNutrition(entreeEnDetail, quantite, unite);
}

champQuantiteDetail.addEventListener('input', rafraichirTableauDetail);
formDetail.addEventListener('change', (e) => {
  if (e.target.name === 'unite') rafraichirTableauDetail();
});

formDetail.addEventListener('submit', async (e) => {
  const entree = entreeEnDetail; // retenue ici : la fenêtre se ferme tout de suite
  const quantite = lireNombre(champQuantiteDetail.value);
  const unite = formDetail.elements.unite.value;

  if (!entree || !(quantite > 0)) {
    e.preventDefault();
    return;
  }

  // Quantité inchangée (telle qu'elle était affichée dans le champ) :
  // on garde la valeur exacte enregistrée, sans rien recalculer.
  const quantiteInchangee = quantite === lireNombre(nombreVersChamp(entree.quantiteGrammes));
  // Rien n'a changé : la fenêtre se ferme simplement.
  if (quantiteInchangee && unite === uniteDe(entree)) return;

  await modifierEntree(entree, { quantite: quantiteInchangee ? entree.quantiteGrammes : quantite, unite });
  await rafraichirEcran();
  annoncer(`${entree.nomAffiche} : ${formaterNombre(entree.quantiteGrammes, 2)} ${unite} enregistrés.`);
});


/* ============================================================
   20. UNITÉ — grammes ou millilitres
   ============================================================
   Un liquide se mesure en ml, et son étiquette donne ses valeurs
   "pour 100 ml" : le calcul (valeur pour 100 × quantité / 100) est le
   même qu'en grammes, l'unité ne change que les libellés. Elle est
   choisie dans les fenêtres d'ajout (manuel, confirmation), enregistrée
   sur la fiche produit (proposée d'office la fois suivante) et sur
   chaque ligne du journal, et reste modifiable ensuite dans le détail
   d'un aliment (section 19, qui gère ses propres libellés). */

// Unité d'une fiche ou d'une ligne. Tout ce qui n'est pas explicitement
// en "ml" est en grammes : c'est le cas des données d'avant la Phase 7.
function uniteDe(objet) {
  return objet && objet.unite === 'ml' ? 'ml' : 'g';
}

// Remplace "g" par "ml" (ou l'inverse) dans les libellés d'un
// formulaire : chaque emplacement est un <span data-unite>.
function afficherUnite(formulaire, unite) {
  formulaire.querySelectorAll('[data-unite]').forEach((el) => { el.textContent = unite; });
}

// Coche le bouton d'unité voulu dans un formulaire et met les libellés
// à jour en conséquence.
function appliquerUnite(formulaire, unite) {
  formulaire.elements.unite.value = unite;
  afficherUnite(formulaire, unite);
}

// Quand l'utilisateur change lui-même d'unité, les libellés suivent.
[formAjout, formConfirmation].forEach((formulaire) => {
  formulaire.addEventListener('change', (e) => {
    if (e.target.name === 'unite') afficherUnite(formulaire, e.target.value);
  });
});


/* ============================================================
   21. DÉMARRAGE
   ============================================================ */

async function demarrer() {
  construireSections();
  await BDD.ouvrir();

  // Phase 7 : complète les lignes du journal enregistrées par une
  // version précédente (voir section 3). Sans effet si tout est déjà à
  // jour. Un échec ne doit pas empêcher l'application de s'ouvrir : la
  // fenêtre de détail sait aussi compléter une ligne à la demande.
  try {
    await migrerAnciennesDonnees();
  } catch (erreur) {
    console.warn('Migration des anciennes lignes du journal impossible :', erreur);
  }

  // Premier lancement : aucun objectif n'a jamais été défini. On invite
  // l'utilisateur à en choisir un avant de lui montrer le journal.
  const objectifExistant = await objectifActifMaintenant();
  if (!objectifExistant) {
    vueOnboarding.hidden = false;
  }

  await rafraichirEcran();

  if ('serviceWorker' in navigator) {
    // Ce changement a aussi lieu à la toute première installation : on ne
    // recharge que si l'on a touché « Mettre à jour ».
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (miseAJourDemandee) location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(surveillerMisesAJour).catch(() => {});
  }
}

// ---------- Nouvelle version de l'application ----------
// Le service worker la télécharge en arrière-plan, puis ATTEND : rien ne
// change par surprise. Un bandeau propose « Mettre à jour », et c'est
// l'utilisateur qui choisit le moment.
let inscriptionSw = null;
let miseAJourDemandee = false;

function surveillerMisesAJour(inscription) {
  inscriptionSw = inscription;
  // Une version attendait déjà (téléchargée lors d'une visite précédente).
  montrerMiseAJour();
  inscription.addEventListener('updatefound', () => {
    const nouveau = inscription.installing;
    if (!nouveau) return;
    nouveau.addEventListener('statechange', () => {
      if (nouveau.state === 'installed') montrerMiseAJour();
    });
  });
  // À chaque retour dans l'application, on regarde s'il y a du nouveau.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') inscription.update().catch(() => {});
  });
}

function montrerMiseAJour() {
  // Sans « controller », c'est la toute première installation : rien à proposer.
  const prete = !!(inscriptionSw && inscriptionSw.waiting && navigator.serviceWorker.controller);
  document.getElementById('bandeau-mise-a-jour').hidden = !prete;
}

document.getElementById('btn-mise-a-jour').addEventListener('click', (e) => {
  if (!inscriptionSw || !inscriptionSw.waiting) return;
  miseAJourDemandee = true;
  e.currentTarget.disabled = true;
  e.currentTarget.textContent = 'Mise à jour…';
  inscriptionSw.waiting.postMessage({ type: 'activer' });
});

demarrer();
