/* Spike jetable U2 (C7) : l'ancrage CFI de foliate-js tient-il CA6-lite (D4) ?
 * Regle C3/C4 : AUCUN calcul de CFI maison — tout passe par l'API PUBLIQUE
 * de foliate-js (getCFI, addAnnotation, goTo, resolveCFI). S'il manquait une
 * API, on le constaterait au lieu de bricoler (garde-fou U2).
 * Stockage en memoire uniquement : pas de persistance (C7, CA6-lite = police
 * seulement, pas fermeture/reouverture).
 */

const FOLIATE_VIEW_URL = 'https://cdn.jsdelivr.net/npm/foliate-js@1.0.1/view.js';
const FOLIATE_OVERLAYER_URL = 'https://cdn.jsdelivr.net/npm/foliate-js@1.0.1/overlayer.js';
const TAILLES_POLICE = [16, 20, 24]; // Paliers du bouton "Changer police" (D1)

/* Shim compat : le parseur EPUB de foliate-js utilise Object/Map.groupBy
 * (ES2024, Chrome 117+). Sans ca, l'ouverture leve sur Chrome plus ancien. */
if (typeof Object.groupBy !== 'function') {
  Object.groupBy = (items, keyFn) => {
    const out = {};
    let i = 0;
    for (const item of items) (out[keyFn(item, i++)] ??= []).push(item);
    return out;
  };
}
if (typeof Map.groupBy !== 'function') {
  Map.groupBy = (items, keyFn) => {
    const out = new Map();
    let i = 0;
    for (const item of items) {
      const k = keyFn(item, i++);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(item);
    }
    return out;
  };
}

const $ = (id) => document.getElementById(id);
const fileInput = $('file'), surlignerBtn = $('surligner');
const policeBtn = $('police'), taillePoliceEl = $('taille-police');
const restaurerBtn = $('restaurer'), prevBtn = $('prev'), nextBtn = $('next');
const wrap = $('viewer-wrap'), statutEl = $('statut'), listeEl = $('liste');
const alerteEl = $('alerte');

let foliateMod = null;   // Module view.js charge depuis le CDN
let Dessin = null;       // Classe Overlayer (fonctions de dessin), depuis le CDN
let vue = null;          // L'element <foliate-view> affiche
let tailleIndex = 0;     // Position dans TAILLES_POLICE
const surlignages = [];  // Memoire volatile : { cfi, texte, etat } (D4)

/* Affiche un message d'etat sous le viewer. */
function statut(msg) {
  statutEl.textContent = msg;
}

/* Remonte les erreurs JS/CDN a l'ecran (diagnostic sans console). */
window.addEventListener('error', (e) => {
  statut(`ERREUR JS : ${e?.message ?? e} — console (F12) pour le detail.`);
});

/* Remonte les promesses rejetees non attrapees (sinon silencieuses). */
window.addEventListener('unhandledrejection', (e) => {
  statut(`ERREUR promesse : ${e?.reason?.message ?? e?.reason ?? e} — console (F12).`);
});

/* Affiche un avertissement persistant (banniere separee de #statut, que les
 * erreurs moteur en cascade reecrivent sans cesse). */
function alerter(msg) {
  alerteEl.textContent = msg;
}

/* Annonce que le script tourne + rappelle l'obligation HTTP (lecon spike-render :
 * foliate-js est bloque en file:// par Chrome, iframes blob sandboxees). */
statut('Pret — servez ce dossier en HTTP (`python -m http.server`), puis choisissez un .epub.');
if (location.protocol === 'file:') {
  alerter("BLOQUE : page ouverte en file:// — foliate-js n'y marchera PAS "
    + "(viewer vide, navigation et restauration inertes). Servez en HTTP : "
    + "`python -m http.server 8000` dans spike-cfi/, puis http://localhost:8000/");
}

/* Construit le CSS de taille de police injecte dans le CONTENU (D1 : le zoom
 * change la taille effective et declenche une re-pagination, jamais de scale). */
function stylePolice() {
  return `html { font-size: ${TAILLES_POLICE[tailleIndex]}px !important; }`;
}

/* Applique la taille courante au moteur : setStyles() re-pagine en gardant
 * l'ancre de lecture (D1). */
function appliquerPolice() {
  if (!vue) return;
  vue.renderer.setStyles(stylePolice());
  taillePoliceEl.textContent = TAILLES_POLICE[tailleIndex] + 'px';
}

/* Charge un .epub local et l'affiche en pagine foliate. Le unzip/OPF/resolution
 * est delegue au moteur (D5 : pas de parsing maison). */
async function chargerLivre(fichier) {
  try {
    if (!foliateMod) foliateMod = await import(FOLIATE_VIEW_URL);
    if (!Dessin) Dessin = (await import(FOLIATE_OVERLAYER_URL)).Overlayer;
  } catch (e) {
    statut(`ERREUR : CDN foliate-js inaccessible (${e?.message ?? e}).`);
    return;
  }
  try {
    try { vue?.close?.(); } catch { /* ignore */ }
    vue?.remove?.();
    vue = document.createElement('foliate-view');
    wrap.appendChild(vue);
    statut('Ouverture du livre…');
    const livre = await foliateMod.makeBook(fichier);
    await vue.open(livre);
    vue.addEventListener('draw-annotation', peindreAnnotation);
    vue.addEventListener('relocate', rejouerApresRendu); // Replay après chaque rendu (vrai CA6)
    surlignages.length = 0;
    tailleIndex = 0;
    appliquerPolice();
    afficherListe();
    await vue.goTo(0);
    statut('Livre ouvert. Selectionnez du texte a la souris, puis « Surligner la selection ».');
  } catch (e) {
    statut(`ERREUR chargement : ${e?.name ? e.name + ' : ' : ''}${e?.message ?? e}`);
  }
}

/* Lit la selection souris dans la section affichee. Ne calcule RIEN en CFI ici :
 * retourne juste l'index de section + le Range + le texte (C3/C4). */
function lireSelection() {
  if (!vue) return null;
  const contenu = vue.renderer.getContents()[0];
  if (!contenu?.doc) return null;
  const sel = contenu.doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const texte = range.toString().trim();
  if (!texte) return null;
  return { index: contenu.index, range, texte };
}

/* Cree un highlight : CFI via l'API PUBLIQUE getCFI (D4, C3/C4 : aucun calcul
 * maison), stockage memoire { cfi, texte } (D4 : le texte est le garde-fou),
 * peinture immediate via l'API publique addAnnotation. */
async function surligner() {
  if (!vue) return statut("Chargez d'abord un .epub.");
  const sel = lireSelection();
  if (!sel) return statut('Selectionnez d\'abord du texte a la souris DANS le livre.');
  try {
    const cfi = vue.getCFI(sel.index, sel.range);
    vue.resolveCFI(cfi); // Validation immediate : le CFI doit se resoudre des sa creation (D4)
    surlignages.push({ cfi, texte: sel.texte, etat: '—' });
    await appliquerHighlightsSurDOM(); // Peinture via le replay (D4)
    statut(`Surligne (${surlignages.length}) : CFI=${cfi}`);
  } catch (e) {
    statut(`ERREUR surlignage : ${e?.name ? e.name + ' : ' : ''}${e?.message ?? e}`);
  }
}

/* Peint un aplat jaune quand foliate demande comment dessiner une annotation.
 * Appele par le moteur (evenement draw-annotation) pour addAnnotation (D4). */
function peindreAnnotation(e) {
  e.detail.draw(Dessin.highlight, { color: 'yellow' });
}

/* RENDER-TIME REPLAY (vrai CA6/D4) : recolore chaque CFI stocké sur le DOM
 * fraîchement créé, via l'API PUBLIQUE uniquement (C3/C4 : aucun calcul
 * maison). `domCourant` = paramètre documentaire (le DOM vient du moteur
 * via getContents(), pas du caller) — gardé pour expliciter le contrat
 * "on rejoue APRÈS chaque rendu, sur le DOM courant".
 * Retourne { ok, echec } et logge le compteur en console (exigence tâche). */
async function appliquerHighlightsSurDOM(domCourant) {
  if (!vue) return { ok: 0, echec: 0 };
  void domCourant; // Le DOM courant est lu via vue.renderer.getContents() (API publique)
  let ok = 0, echec = 0;
  const contenus = vue.renderer.getContents();
  for (const h of surlignages) {
    try {
      const { index, anchor } = vue.resolveCFI(h.cfi); // Relocalisation publique, SANS navigation (garde-fou U2 : possible)
      const contenu = contenus.find((c) => c.index === index);
      if (!contenu?.doc) { h.etat = 'PERDU'; echec++; continue; } // Section non chargée = pas peignable ici (nominal)
      const range = anchor(contenu.doc); // Range dans le DOM FRAÎCHEMENT créé
      if (!range || range.collapsed && !range.toString()) { h.etat = 'PERDU'; echec++; continue; }
      await vue.addAnnotation({ value: h.cfi }); // Peinture via draw-annotation -> peindreAnnotation (D4)
      h.etat = verifierTexte(h.texte, range.toString());
      if (h.etat === 'PERDU') echec++;
      else ok++;
    } catch {
      h.etat = 'PERDU';
      echec++;
    }
  }
  afficherListe();
  console.log(`[replay] ${ok} CFI relocalisé(s) avec succès, ${echec} échoué(s) / ${surlignages.length} stocké(s).`);
  return { ok, echec };
}

/* Hook post-rendu : foliate recrée le DOM à chaque changement de section ;
 * on rejoue les highlights sur le DOM frais (vrai cas CA6, pas survie passive). */
async function rejouerApresRendu() {
  if (!vue || !surlignages.length) return;
  await appliquerHighlightsSurDOM();
}

/* Passe a la taille suivante (16→20→24→16) et re-pagine (D1). Le replay
 * automatique repeint apres le re-layout ; sinon, bouton « Restaurer ». */
function changerPolice() {
  if (!vue) return statut("Chargez d'abord un .epub.");
  tailleIndex = (tailleIndex + 1) % TAILLES_POLICE.length;
  appliquerPolice();
  statut(`Police ${TAILLES_POLICE[tailleIndex]}px — re-layout fait. Le replay repeint seul, sinon « Restaurer ».`);
}

/* Normalise un texte pour comparaison (espaces/sauts de ligne equivalents).
 * Sert au garde-fou texte de D4. */
function normaliser(texte) {
  return texte.replace(/\s+/g, ' ').trim();
}

/* Compare le texte stocke (D4) au texte retrouve via le CFI : OK = identique,
 * DECALE = inclusion (meme passage, bornes differentes), PERDU = sinon. */
function verifierTexte(attendu, retrouve) {
  if (!retrouve) return 'PERDU';
  const a = normaliser(attendu), b = normaliser(retrouve);
  if (!a || !b) return 'PERDU';
  if (a === b) return 'OK';
  if (b.length > 10 && a.includes(b)) return 'DÉCALÉ';
  if (a.length > 10 && b.includes(a)) return 'DÉCALÉ';
  return 'PERDU';
}

/* Relit le passage pointe par un CFI via l'API PUBLIQUE resolveCFI (D4, C3/C4 :
 * aucune resolution maison), pour verification contre le texte stocke. */
function texteRelocalise(cfi) {
  const { index, anchor } = vue.resolveCFI(cfi);
  const contenus = vue.renderer.getContents();
  const contenu = contenus.find((c) => c.index === index) ?? contenus[0];
  if (!contenu?.doc) return null;
  const ancre = anchor(contenu.doc);
  if (!ancre || ancre.startContainer === undefined) return null;
  return ancre.toString();
}

/* Bouton "Restaurer" : inutile pour le test render-time (le replay est
 * automatique après chaque rendu). Gardé pour debug manuel : rejoue juste
 * appliquerHighlightsSurDOM sur la page courante, SANS naviguer (D4). */
async function restaurerHighlights() {
  if (!vue) return statut("Chargez d'abord un .epub.");
  if (!surlignages.length) return statut('Aucun highlight stocke.');
  const { ok, echec } = await appliquerHighlightsSurDOM();
  statut(`Replay manuel sur page courante : ${ok} OK, ${echec} PERDU/non chargé(s). Voir console (F12) pour le détail succès/échec.`);
}

/* Affiche la liste memoire des CFI + leur etat de relocalisation (D4). */
function afficherListe() {
  listeEl.innerHTML = '';
  surlignages.forEach((h, i) => {
    const li = document.createElement('li');
    const extrait = h.texte.length > 60 ? h.texte.slice(0, 60) + '…' : h.texte;
    const classe = h.etat === 'DÉCALÉ' ? 'DECALE' : h.etat;
    li.innerHTML = `#${i + 1} « ${extrait} »<br>${h.cfi} — <span class="etat-${classe}">${h.etat}</span>`;
    listeEl.appendChild(li);
  });
}

/* Tourne la page dans un sens (-1 = precedente, +1 = suivante).
 * Instrument de test : placer des highlights sur plusieurs sections.
 * Le DOM est recréé par foliate au changement de section : le replay se fait
 * via l'événement 'relocate' (rejouerApresRendu) + rappel explicite ici sur
 * le DOM fraîchement créé (vrai cas CA6). */
async function allerPage(sens) {
  if (!vue) return;
  try {
    if (sens < 0) await vue.prev();
    else await vue.next();
    await appliquerHighlightsSurDOM(); // Replay post-rendu sur DOM frais
  } catch (e) {
    statut(`ERREUR navigation : ${e?.message ?? e}`);
  }
}

fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  await chargerLivre(f);
});
surlignerBtn.addEventListener('click', surligner);
policeBtn.addEventListener('click', changerPolice);
restaurerBtn.addEventListener('click', restaurerHighlights);
prevBtn.addEventListener('click', () => allerPage(-1));
nextBtn.addEventListener('click', () => allerPage(1));
