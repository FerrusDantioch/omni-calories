/* Omni-Calories — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   Tests automatiques d'Omni-Calories.
   Ils ouvrent l'application dans un vrai navigateur (Chromium, piloté
   par Playwright), font les gestes d'une personne (premier lancement,
   ajout d'un aliment, changement de quantité…) et vérifient les calculs.
   Rien n'est envoyé sur internet : la recherche Open Food Facts est
   remplacée par une fausse réponse fournie par le test.

   Lancer (Playwright doit être installé) :  node tests/tester.js
   ============================================================ */
'use strict';
const { lancer, section, verifier, nouvellePage, controlesCommuns } = require('./outils.js');

const texte = (p, sel) => p.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());

async function ajouterManuel(p, repas, { nom, quantite, calories, proteines = '0', glucides = '', lipides = '', ml = false }) {
  await p.click(`.btn-ajouter-repas[data-repas="${repas}"]`);
  await p.click('#btn-choix-manuel');
  await p.fill('#f-nom', nom);
  if (ml) await p.check('#form-ajout input[name="unite"][value="ml"]');
  await p.fill('#f-quantite', quantite);
  await p.fill('#f-calories', calories);
  await p.fill('#f-proteines', proteines);
  if (glucides) await p.fill('#f-glucides', glucides);
  if (lipides) await p.fill('#f-lipides', lipides);
  await p.click('#form-ajout [type="submit"]');
  await p.waitForTimeout(400);
}

lancer('Omni-Calories', async () => {
  await controlesCommuns({ serviceWorker: 'sw.js' });

  const { ctx, p } = await nouvellePage();
  await p.waitForTimeout(800);

  await section('Calculs (nombres à virgule, valeurs pour 100 g)', async () => {
    const r = await p.evaluate(() => ({
      virgule: lireNombre('54,4'), point: lireNombre('54.4'), espaces: lireNombre(' 54,4 '),
      lettres: Number.isNaN(lireNombre('abc')), negatif: Number.isNaN(lireNombre('-3')), deuxVirgules: Number.isNaN(lireNombre('5,4,4')),
      kcal: pourQuantite(539, 54.4), inconnu: pourQuantite(null, 100), affichage: formaterNombre(1234.56)
    }));
    verifier(r.virgule === 54.4 && r.point === 54.4 && r.espaces === 54.4, '« 54,4 », « 54.4 » et « 54,4 » avec espaces sont lus', r);
    verifier(r.lettres && r.negatif && r.deuxVirgules, 'texte, nombre négatif et « 5,4,4 » refusés');
    verifier(r.kcal === 293.2, '54,4 g à 539 kcal/100 g = 293,2 kcal', r.kcal);
    verifier(r.inconnu === null, 'une valeur inconnue reste inconnue (jamais 0)');
    verifier(r.affichage.replace(/\s/g, ' ') === '1 234,6', 'affichage à la française', r.affichage);
  });

  await section('Premier lancement : objectif du jour', async () => {
    verifier(await p.isVisible('#vue-onboarding'), 'l’écran d’accueil demande un objectif');
    await p.fill('#ob-calories', '2000');
    await p.fill('#ob-proteines', '100');
    await p.click('#form-onboarding [type="submit"]');
    await p.waitForTimeout(500);
    verifier(await p.isVisible('#vue-journal'), 'le journal du jour s’affiche');
    verifier((await texte(p, '#objectif-resume')).includes('2'), 'l’objectif est rappelé', await texte(p, '#objectif-resume'));
  });

  await section('Ajouter des aliments', async () => {
    await ajouterManuel(p, 'petit-dejeuner', { nom: 'Flocons d’avoine', quantite: '50', calories: '370', proteines: '13,5' });
    await ajouterManuel(p, 'dejeuner', { nom: 'Jus d’orange', quantite: '250', calories: '45', proteines: '0,7', ml: true });
    const kcal = await texte(p, '#calories-valeurs');
    // 50 g × 370/100 = 185 ; 250 ml × 45/100 = 112,5 → 297,5 kcal
    verifier(/297,5|298/.test(kcal), 'total : 185 + 112,5 = 297,5 kcal', kcal);
    const prot = await texte(p, '#proteines-valeurs');
    verifier(/8,5|8,6|9/.test(prot), 'protéines : 6,75 + 1,75 = 8,5 g', prot);
    const lignes = await p.$$eval('.liste-aliments li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ')));
    verifier(lignes.some((l) => l.includes('ml')), 'le jus est compté en ml', lignes);
  });

  await section('Une saisie fausse est refusée avec un message', async () => {
    await p.click('.btn-ajouter-repas[data-repas="diner"]');
    await p.click('#btn-choix-manuel');
    await p.fill('#f-nom', 'Erreur');
    await p.fill('#f-quantite', 'beaucoup');
    await p.fill('#f-calories', '100');
    await p.fill('#f-proteines', '1');
    await p.click('#form-ajout [type="submit"]');
    const message = await p.$eval('#f-quantite', (c) => c.validationMessage);
    verifier(/nombre/i.test(message), 'message : « Saisissez un nombre… »', message);
    await p.click('#btn-annuler-ajout');
  });

  await section('Les données restent après fermeture', async () => {
    await p.reload();
    await p.waitForTimeout(1000);
    verifier(!(await p.isVisible('#vue-onboarding')), 'pas de nouvel écran d’accueil');
    verifier(/297,5|298/.test(await texte(p, '#calories-valeurs')), 'le total du jour est conservé');
  });

  await ctx.close();
});
