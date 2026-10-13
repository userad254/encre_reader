import { ajouterTempsLecture, lireTempsJour } from './db';
import type { TempsLectureJour } from '../shared/types';

// T7a : horloge de lecture, source de vérité = main (Phase 7, DECISIONS.md).
// Compte quand la vue lecture est montée ET la fenêtre focused. Pause : blur,
// minimiser, bibliothèque, fermeture. Pas de heartbeat renderer, pas d'idle
// detection (YAGNI). Accumulation par segments horodatés : chaque changement
// d'état clôt le segment courant et en ouvre un nouveau si (lecture ET focus).

// T7b : objectif courant poussé par le renderer (canal objectifs:fixer).
// 15 par défaut tant que rien n'est fixé ; utilisé tel quel au prochain flush.
export const OBJECTIF_MIN_DEFAUT = 15;
let objectifMinCourant = OBJECTIF_MIN_DEFAUT;

// T7c : objectif annuel poussé par le renderer (canal objectifs:fixerAnnee).
// 3 par défaut ; le main ne fait que le retenir (le renderer le persiste).
export const OBJECTIF_ANNEE_DEFAUT = 3;
export const OBJECTIF_ANNEE_MIN = 1;
export const OBJECTIF_ANNEE_MAX = 50;
let objectifAnneeCourant = OBJECTIF_ANNEE_DEFAUT;
const FLUSH_MS = 30000; // Flush debouncé : SQLite n'est touché qu'au flush, jamais en continu

export type RaisonSegment = 'focus' | 'blur' | 'etat' | 'quit';

let lectureActive = false; // Vue lecture montée (signal renderer lecture:etat)
let fenetreFocus = true; // Fenêtre focused (focus/blur/minimize/restore)
let debutSegment: number | null = null; // Horodatage ms du segment ouvert, null = rien ne compte
let secondesEnAttente = 0; // Secondes closes non flushées
let minuteurFlush: ReturnType<typeof setTimeout> | null = null;
let diffuser: (t: TempsLectureJour) => void = () => {}; // Push temps:maj à chaque flush (widget + anneau T7b)

// Jour local AAAA-MM-JJ (le jour calendaire de l'utilisateur, pas UTC).
export function jourLocal(d = new Date()): string {
  const a = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

function doitCompter(): boolean {
  return lectureActive && fenetreFocus;
}

function ouvrirSegment(raison: RaisonSegment): void {
  if (debutSegment !== null || !doitCompter()) return;
  debutSegment = Date.now();
  console.log(`[temps] segment open reason=${raison}`);
}

function fermerSegment(raison: RaisonSegment): void {
  if (debutSegment === null) return;
  const ecoule = Math.floor((Date.now() - debutSegment) / 1000);
  debutSegment = null;
  if (ecoule > 0) secondesEnAttente += ecoule;
  console.log(`[temps] segment close reason=${raison}`);
  if (secondesEnAttente > 0) demanderFlush();
}

// Tout changement d'état : clôt le segment courant, en ouvre un nouveau si comptable.
function reevaluer(raison: RaisonSegment): void {
  fermerSegment(raison);
  ouvrirSegment(raison);
}

function demanderFlush(): void {
  if (minuteurFlush) return;
  minuteurFlush = setTimeout(() => {
    minuteurFlush = null;
    flusher();
  }, FLUSH_MS);
}

// Checkpoint : fige le segment ouvert sans le fermer (la lecture continue),
// persiste l'attente en SQLite (UPSERT du jour) et pousse au renderer.
function flusher(): void {
  if (debutSegment !== null) {
    const ecoule = Math.floor((Date.now() - debutSegment) / 1000);
    if (ecoule > 0) secondesEnAttente += ecoule;
    debutSegment = Date.now();
  }
  if (secondesEnAttente <= 0) return;
  const delta = secondesEnAttente;
  secondesEnAttente = 0;
  const ligne = ajouterTempsLecture(jourLocal(), delta, objectifMinCourant);
  const total: TempsLectureJour = { jour: ligne.jour, secondes: ligne.secondes, atteint: ligne.atteint };
  console.log(`[temps] jour=${total.jour} +${delta}s total=${total.secondes} atteint=${total.atteint ? 1 : 0}`);
  diffuser(total);
}

// Câblage unique au démarrage (main) : état focus initial + push vers le renderer.
export function initialiserHorloge(opts: { focusInitial: boolean; diffuser: (t: TempsLectureJour) => void }): void {
  fenetreFocus = opts.focusInitial;
  diffuser = opts.diffuser;
}

// Signal renderer (montage = true, démontage = false de la vue lecture).
export function signalerEtatLecture(actif: boolean): void {
  if (lectureActive === actif) return;
  lectureActive = actif;
  reevaluer('etat');
}

// Focus/blur (+ minimize/restore rabattus dessus par le main) de la BrowserWindow.
export function signalerFocusFenetre(focus: boolean): void {
  if (fenetreFocus === focus) return;
  fenetreFocus = focus;
  reevaluer(focus ? 'focus' : 'blur');
}

// Flush synchrone avant de quitter (better-sqlite3 est synchrone : rien n'est perdu).
export function flusherAvantQuitter(): void {
  if (minuteurFlush) {
    clearTimeout(minuteurFlush);
    minuteurFlush = null;
  }
  if (debutSegment !== null) fermerSegment('quit');
  flusher();
}

// T7b : le renderer pousse l'objectif (presets) ; valeur invalide = ignorée.
// Rend la valeur stockée (le renderer la confirme via objectifs:jour).
export function fixerObjectif(minutes: number): number {
  if (Number.isFinite(minutes) && minutes > 0) objectifMinCourant = Math.floor(minutes);
  return objectifMinCourant;
}

// T7b : objectif courant du main (15 par défaut si rien fixé).
export function lireObjectif(): number {
  return objectifMinCourant;
}

// T7c : le renderer pousse l'objectif annuel (stepper 1-50) ; valeur invalide
// = ignorée. Rend la valeur retenue.
export function fixerObjectifAnnee(nombre: number): number {
  if (Number.isFinite(nombre)) {
    objectifAnneeCourant = Math.min(
      OBJECTIF_ANNEE_MAX,
      Math.max(OBJECTIF_ANNEE_MIN, Math.floor(nombre)),
    );
  }
  return objectifAnneeCourant;
}

// T7c : objectif annuel retenu (3 par défaut si rien poussé).
export function lireObjectifAnnee(): number {
  return objectifAnneeCourant;
}

// Total du jour depuis SQLite (sans l'attente non flushée : la relance reprend
// exactement ce qui est persisté, critère T7a).
export function tempsAujourdHui(): TempsLectureJour {
  const jour = jourLocal();
  const ligne = lireTempsJour(jour);
  if (!ligne) return { jour, secondes: 0, atteint: false };
  return { jour: ligne.jour, secondes: ligne.secondes, atteint: ligne.atteint };
}
