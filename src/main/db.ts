import Database from 'better-sqlite3';
import type { Annotation, EtagereUtilisateur, JourAtteinte, JourStatsLecture, LivreBiblio, NoteAuHasard, NouveauLivre, PositionLivre, SauvegardeAnnotation, StatsLecture, StatutLivre } from '../shared/types';

// Ligne brute SQLite (snake_case) : convertie en Annotation (camelCase) en sortie —
// les types partagés sont définis une seule fois et importés des deux côtés.
interface LigneAnnotation {
  id: number;
  livre_id: string;
  cfi: string;
  texte_extrait: string;
  couleur: string;
  note: string | null; // Colonne ajoutée après coup : absente des bases créées avant → `?? null` en sortie
  cree_le: string;
}

// Ligne brute SQLite pour la position de lecture (table distincte des highlights).
interface LignePosition {
  livre_id: string;
  cfi: string;
  maj_le: string;
  fraction: number;
  termine: number;
}

// Ligne brute SQLite pour l'horloge de lecture (une ligne par jour local).
interface LigneTemps {
  jour: string;
  secondes: number;
  objectif_min: number;
  atteint: number;
  maj_le: string | null;
}

// Ligne brute SQLite pour la bibliothèque (l'identité d'un livre est son chemin normalisé).
interface LigneLivre {
  id: string;
  chemin: string;
  titre: string;
  auteur: string | null;
  couverture: Buffer | null;
  ajoute_le: string;
  progress: number | null;
  termine: number | null;
  derniere_lecture?: string | null;
}

// Schéma SQL initial (surlignage + position : la position de lecture vit dans une table distincte des highlights).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  livre_id TEXT NOT NULL,      -- le highlight appartient à un livre (au début : simple nom du fichier)
  cfi TEXT NOT NULL,           -- ancre CFI : position logique dans le livre, jamais un offset écran
  texte_extrait TEXT NOT NULL, -- texte recopié au surlignage, garde-fou si le CFI ne résout plus
  couleur TEXT NOT NULL DEFAULT 'yellow', -- une seule couleur jaune (pas de sélecteur sans besoin réel)
  note TEXT,                         -- note libre attachée au highlight (null = vide)
  cree_le TEXT NOT NULL         -- ISO8601
);
CREATE INDEX IF NOT EXISTS idx_annotations_livre ON annotations(livre_id);

CREATE TABLE IF NOT EXISTS position (
  livre_id TEXT PRIMARY KEY,   -- un seul enregistrement de position par livre
  cfi TEXT NOT NULL,           -- ancre CFI de reprise de lecture
  maj_le TEXT NOT NULL         -- ISO8601
);

CREATE TABLE IF NOT EXISTS livres (
  id TEXT PRIMARY KEY,         -- chemin absolu normalisé (identité du livre)
  chemin TEXT NOT NULL UNIQUE, -- chemin absolu d'origine (lecture disque)
  titre TEXT NOT NULL,         -- titre via les métadonnées foliate, jamais parsé à la main
  auteur TEXT,                 -- premier auteur foliate, null si inconnu
  couverture BLOB,             -- image via book.getCover() foliate, null = placeholder
  ajoute_le TEXT NOT NULL,     -- ISO8601
  progress REAL DEFAULT 0,     -- fraction lue (0 = début, 1 = fin)
  termine INTEGER DEFAULT 0,   -- terminé automatiquement à 98 % de progression
  termine_le TEXT              -- date ISO8601 du passage à terminé (NULL = jamais ou remis à lire)
);
`;

const SCHEMA_ETAGERES = `
CREATE TABLE IF NOT EXISTS etageres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL UNIQUE,
  cree_le TEXT
);
CREATE TABLE IF NOT EXISTS livre_etagere (
  livre_id TEXT NOT NULL,
  etagere_id INTEGER NOT NULL,
  PRIMARY KEY (livre_id, etagere_id)
);
`;

// Horloge de lecture : une ligne par jour local.
const SCHEMA_TEMPS = `
CREATE TABLE IF NOT EXISTS temps_lecture (
  jour TEXT PRIMARY KEY,              -- AAAA-MM-JJ en heure locale
  secondes INTEGER NOT NULL,          -- total accumulé du jour
  objectif_min INTEGER NOT NULL DEFAULT 15, -- 15 minutes par défaut (l'interface propose 5/10/15/20/30/45/60)
  atteint INTEGER NOT NULL DEFAULT 0, -- recalculé à chaque flush (secondes >= objectif)
  maj_le TEXT                         -- ISO8601 du dernier flush
);
`;

let base: Database.Database | null = null;

// Ouvre (ou crée) lecteur.db et applique le schéma. Appelée une fois au démarrage (main).
export function initDb(chemin: string): void {
  base = new Database(chemin);
  base.exec(SCHEMA);
  base.exec(SCHEMA_ETAGERES);
  base.exec(SCHEMA_TEMPS);
  migrerNotes(); // bases existantes sans la colonne note
  migrerProgression(); // bases existantes sans les colonnes de mesure
  migrerTermineLe(); // bases existantes sans la colonne de datation
  migrerTempsLecture(); // bases existantes sans la table ou avec une table incomplète
}

// Ajoute la colonne note (la note est une donnée du livre : elle vit en SQLite,
// pas dans le stockage local du navigateur).
// Idempotent : lit PRAGMA table_info avant ALTER, donc sûr au redémarrage (pas de numéro de version).
function migrerNotes(): void {
  const colonnes = db().prepare('PRAGMA table_info(annotations)').all() as { name: string }[];
  if (!colonnes.some((c) => c.name === 'note')) {
    db().exec('ALTER TABLE annotations ADD COLUMN note TEXT');
  }
}

function migrerProgression(): void {
  const colonnes = db().prepare('PRAGMA table_info(livres)').all() as { name: string }[];
  if (!colonnes.some((c) => c.name === 'progress')) {
    db().exec('ALTER TABLE livres ADD COLUMN progress REAL DEFAULT 0');
  }
  if (!colonnes.some((c) => c.name === 'termine')) {
    db().exec('ALTER TABLE livres ADD COLUMN termine INTEGER DEFAULT 0');
  }
}

// Migre vers l'objectif annuel. Idempotent : PRAGMA table_info avant ALTER
// (même convention que les autres migrations : pas de numéro de version). Les livres déjà
// termine=1 gardent termine_le NULL = hors compte annuel (décision documentée dans DECISIONS.md).
function migrerTermineLe(): void {
  const colonnes = db().prepare('PRAGMA table_info(livres)').all() as { name: string }[];
  if (!colonnes.some((c) => c.name === 'termine_le')) {
    db().exec('ALTER TABLE livres ADD COLUMN termine_le TEXT');
  }
}
// PRAGMA table_info avant chaque ALTER (même convention que les autres migrations : pas de numéro de version).
function migrerTempsLecture(): void {
  const colonnes = db().prepare('PRAGMA table_info(temps_lecture)').all() as { name: string }[];
  const noms = new Set(colonnes.map((c) => c.name));
  if (!noms.has('secondes')) db().exec('ALTER TABLE temps_lecture ADD COLUMN secondes INTEGER NOT NULL DEFAULT 0');
  if (!noms.has('objectif_min')) db().exec('ALTER TABLE temps_lecture ADD COLUMN objectif_min INTEGER NOT NULL DEFAULT 15');
  if (!noms.has('atteint')) db().exec('ALTER TABLE temps_lecture ADD COLUMN atteint INTEGER NOT NULL DEFAULT 0');
  if (!noms.has('maj_le')) db().exec('ALTER TABLE temps_lecture ADD COLUMN maj_le TEXT');
}

// Rend la base ou lève si initDb n'a pas été appelée (erreur de programmation, pas de null discret).
function db(): Database.Database {
  if (!base) throw new Error('Base SQLite non initialisée (initDb manquant).');
  return base;
}

// Convertit une ligne SQL en type partagé (le renderer ne voit que Annotation).
function versAnnotation(ligne: LigneAnnotation): Annotation {
  return {
    id: ligne.id,
    livreId: ligne.livre_id,
    cfi: ligne.cfi,
    texteExtrait: ligne.texte_extrait,
    couleur: ligne.couleur,
    note: ligne.note ?? null, // bases créées avant la colonne → vide, pas d'erreur
    creeLe: ligne.cree_le,
  };
}

// Lit tous les highlights d'un livre, dans l'ordre de création (relus depuis SQLite : ils survivent à la réouverture).
export function chargerAnnotations(livreId: string): Annotation[] {
  const lignes = db()
    .prepare('SELECT * FROM annotations WHERE livre_id = ? ORDER BY id')
    .all(livreId) as LigneAnnotation[];
  return lignes.map(versAnnotation);
}

// Sauve un highlight et rend l'Annotation complète (id + date assignés par SQLite).
export function sauvegarderAnnotation(s: SauvegardeAnnotation): Annotation {
  const creeLe = new Date().toISOString();
  const res = db()
    .prepare(
      'INSERT INTO annotations (livre_id, cfi, texte_extrait, couleur, note, cree_le) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(s.livreId, s.cfi, s.texteExtrait, s.couleur, s.note, creeLe);
  return { id: Number(res.lastInsertRowid), livreId: s.livreId, cfi: s.cfi, texteExtrait: s.texteExtrait, couleur: s.couleur, note: s.note, creeLe };
}

// Met à jour la note d'un highlight (la note est stockée en SQLite avec le highlight).
export function modifierNote(id: number, note: string | null): void {
  db().prepare('UPDATE annotations SET note = ? WHERE id = ?').run(note, id);
}

// Supprime un highlight (suppression définitive, sans corbeille — voir README).
export function supprimerAnnotation(id: number): void {
  db().prepare('DELETE FROM annotations WHERE id = ?').run(id);
}

// Lit la position de lecture enregistrée d'un livre (pour rouvrir où on s'était arrêté).
export function chargerPosition(livreId: string): PositionLivre | null {
  const ligne = db()
    .prepare(
          `SELECT position.livre_id, position.cfi, position.maj_le,
              COALESCE(livres.progress, 0) AS fraction, COALESCE(livres.termine, 0) AS termine
       FROM position LEFT JOIN livres ON livres.id = position.livre_id
       WHERE position.livre_id = ?`,
    )
    .get(livreId) as LignePosition | undefined;
  if (!ligne) return null;
  return {
    livreId: ligne.livre_id,
    cfi: ligne.cfi,
    majLe: ligne.maj_le,
    fraction: ligne.fraction,
    termine: ligne.termine === 1,
  };
}

// Enregistre ou met à jour la position courante d'un livre (une seule ligne par livre).
export function sauvegarderPosition(
  livreId: string,
  cfi: string,
  fraction: number,
  fractionAtterrissage: number,
): PositionLivre {
  const majLe = new Date().toISOString();
  const progression = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const atterrissage = Number.isFinite(fractionAtterrissage)
    ? Math.min(1, Math.max(0, fractionAtterrissage))
    : progression;
  db()
    .prepare(
      `INSERT INTO position (livre_id, cfi, maj_le) VALUES (?, ?, ?)
       ON CONFLICT(livre_id) DO UPDATE SET cfi = excluded.cfi, maj_le = excluded.maj_le`,
    )
    .run(livreId, cfi, majLe);
  const etat = db().prepare('SELECT termine FROM livres WHERE id = ?').get(livreId) as
    | { termine: number | null }
    | undefined;
  if (etat?.termine === 1 && atterrissage < 0.01 && progression >= 0.01 && progression < 0.98) {
    db().prepare('UPDATE livres SET termine = 0, termine_le = NULL WHERE id = ?').run(livreId);
    console.log(`[progress] ${livreId.slice(-8)} auto-unfinish (relecture depuis le début)`);
  }
  db()
    .prepare(
      `UPDATE livres SET progress = ?,
        termine = CASE WHEN ? >= 0.98 THEN 1 ELSE termine END,
        termine_le = CASE WHEN ? >= 0.98 AND COALESCE(termine, 0) = 0 THEN ? ELSE termine_le END
        WHERE id = ?`,
    )
    .run(progression, progression, progression, majLe, livreId);
  const ligne = db().prepare('SELECT termine FROM livres WHERE id = ?').get(livreId) as
    | { termine: number | null }
    | undefined;
  console.log(`[progress] ${livreId.slice(-8)} fraction=${progression} termine=${ligne?.termine ?? 0}`);
  return { livreId, cfi, majLe, fraction: progression };
}

// Convertit une ligne SQL en LivreBiblio (le BLOB Buffer devient un ArrayBuffer
// neuf transférable par IPC ; `existe` est résolu par l'appelant via existsSync).
function versLivre(ligne: LigneLivre, existe: boolean): LivreBiblio {
  const couverture = ligne.couverture ? Uint8Array.from(ligne.couverture).buffer as ArrayBuffer : null;
  return {
    id: ligne.id,
    chemin: ligne.chemin,
    titre: ligne.titre,
    auteur: ligne.auteur,
    couverture,
    ajouteLe: ligne.ajoute_le,
    progress: ligne.progress ?? 0,
    termine: ligne.termine === 1,
    derniereLecture: ligne.derniere_lecture ?? null,
    existe,
  };
}

// Lit une entrée bibliothèque par son id (ouverture depuis la grille).
export function chargerLivre(id: string, existe: boolean): LivreBiblio | null {
  const ligne = db().prepare('SELECT * FROM livres WHERE id = ?').get(id) as LigneLivre | undefined;
  if (!ligne) return null;
  return versLivre(ligne, existe);
}

// Lit le titre/auteur d'un livre pour l'en-tête d'export (format Markdown fixe).
// Retourne null si le livre n'est pas en bibliothèque (ouvert direct, jamais importé).
export function chargerMetaLivre(id: string): { titre: string; auteur: string | null } | null {
  const ligne = db().prepare('SELECT titre, auteur FROM livres WHERE id = ?').get(id) as
    | { titre: string; auteur: string | null }
    | undefined;
  if (!ligne) return null;
  return { titre: ligne.titre, auteur: ligne.auteur };
}

// Liste la bibliothèque, imports récents d'abord (grille d'accueil).
export function listerLivres(existe: (chemin: string) => boolean): LivreBiblio[] {
  const lignes = db()
    .prepare(
      `SELECT livres.*, position.maj_le AS derniere_lecture
       FROM livres LEFT JOIN position ON position.livre_id = livres.id
       ORDER BY livres.ajoute_le DESC, livres.id`,
    )
    .all() as LigneLivre[];
  return lignes.map((l) => versLivre(l, existe(l.chemin)));
}

export function modifierStatutLivre(id: string, statut: StatutLivre): void {
  // termine_le est posé au passage à terminé, NULL au retour à lire. Un livre déjà
  // terminé (ancien, termine_le NULL) re-marqué reste NULL (pas de re-datation).
  if (statut === 'termine') {
    db()
      .prepare(
        `UPDATE livres SET termine = 1,
          termine_le = CASE WHEN COALESCE(termine, 0) = 0 THEN ? ELSE termine_le END
          WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
    return;
  }
  db().prepare('UPDATE livres SET termine = 0, progress = 0, termine_le = NULL WHERE id = ?').run(id);
}

// Livres terminés datés de l'année (termine_le commence par AAAA).
export function compterTerminesAnnee(annee: string): number {
  const ligne = db()
    .prepare('SELECT COUNT(*) AS n FROM livres WHERE termine_le LIKE ?')
    .get(`${annee}%`) as { n: number } | undefined;
  return ligne?.n ?? 0;
}

// Importe un livre : titre/auteur/couverture déjà extraits via foliate côté
// renderer (foliate exige le DOM, le main ne fait que persister — aucun parseur ajouté côté main).
// Ré-importer le même chemin rafraîchit les métadonnées sans perdre ajoute_le.
export function importerLivre(id: string, n: NouveauLivre): LivreBiblio {
  const ajouteLe = new Date().toISOString();
  const couverture = n.couverture ? Buffer.from(n.couverture) : null;
  db()
    .prepare(
      `INSERT INTO livres (id, chemin, titre, auteur, couverture, ajoute_le)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET chemin = excluded.chemin, titre = excluded.titre,
         auteur = excluded.auteur, couverture = excluded.couverture`,
    )
    .run(id, n.chemin, n.titre, n.auteur, couverture, ajouteLe);
  const ligne = db().prepare('SELECT * FROM livres WHERE id = ?').get(id) as LigneLivre;
  return versLivre(ligne, true);
}

// Retire une carte de la bibliothèque (annotations et position gardées :
// ré-importer le même chemin retrouve highlights et position).
export function supprimerLivre(id: string): void {
  db().prepare('DELETE FROM livres WHERE id = ?').run(id);
}

export function listerEtageres(): EtagereUtilisateur[] {
  const lignes = db().prepare('SELECT id, nom, cree_le FROM etageres ORDER BY nom COLLATE NOCASE, id').all() as
    { id: number; nom: string; cree_le: string | null }[];
  return lignes.map((ligne) => ({ id: ligne.id, nom: ligne.nom, creeLe: ligne.cree_le }));
}

export function creerEtagere(nom: string): EtagereUtilisateur {
  const propre = nom.trim();
  if (!propre) throw new Error('Le nom de la catégorie est obligatoire.');
  const creeLe = new Date().toISOString();
  db().prepare('INSERT INTO etageres (nom, cree_le) VALUES (?, ?) ON CONFLICT(nom) DO NOTHING').run(propre, creeLe);
  const ligne = db().prepare('SELECT id, nom, cree_le FROM etageres WHERE nom = ?').get(propre) as
    { id: number; nom: string; cree_le: string | null } | undefined;
  if (!ligne) throw new Error('Impossible de créer la catégorie.');
  return { id: ligne.id, nom: ligne.nom, creeLe: ligne.cree_le };
}

export function supprimerEtagere(id: number): void {
  const supprimer = db().transaction(() => {
    db().prepare('DELETE FROM livre_etagere WHERE etagere_id = ?').run(id);
    db().prepare('DELETE FROM etageres WHERE id = ?').run(id);
  });
  supprimer();
}

export function associerLivreEtagere(livreId: string, etagereId: number, associer: boolean): void {
  if (associer) {
    db()
      .prepare('INSERT INTO livre_etagere (livre_id, etagere_id) VALUES (?, ?) ON CONFLICT(livre_id, etagere_id) DO NOTHING')
      .run(livreId, etagereId);
    return;
  }
  db().prepare('DELETE FROM livre_etagere WHERE livre_id = ? AND etagere_id = ?').run(livreId, etagereId);
}

export function etageresDuLivre(livreId: string): number[] {
  const lignes = db().prepare('SELECT etagere_id FROM livre_etagere WHERE livre_id = ?').all(livreId) as
    { etagere_id: number }[];
  return lignes.map((ligne) => ligne.etagere_id);
}

// Tire une annotation au hasard en excluant les ids déjà montrés (carte « Se relire »).
// LEFT JOIN car les lignes très anciennes sans entrée bibliothèque → repli "Inconnu", jamais de vide discret.
export function noteAuHasard(exclusions: number[]): NoteAuHasard | null {
  const propres = [...new Set(exclusions.filter((n) => Number.isInteger(n)))];
  const clauseExclusion = propres.length > 0 ? `WHERE annotations.id NOT IN (${propres.map(() => '?').join(', ')})` : '';
  const ligne = db()
    .prepare(
      `SELECT annotations.*, livres.titre AS livre_titre, livres.auteur AS livre_auteur
       FROM annotations LEFT JOIN livres ON livres.id = annotations.livre_id
       ${clauseExclusion}
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get(...propres) as (LigneAnnotation & { livre_titre: string | null; livre_auteur: string | null }) | undefined;
  if (!ligne) return null;
  return {
    ...versAnnotation(ligne),
    livreTitre: ligne.livre_titre?.trim() ? ligne.livre_titre : 'Inconnu',
    livreAuteur: ligne.livre_auteur?.trim() ? ligne.livre_auteur : 'Inconnu',
  };
}

// Convertit une ligne temps_lecture en objet (le main ne manipule que du typé).
function versTemps(ligne: LigneTemps): { jour: string; secondes: number; objectifMin: number; atteint: boolean } {
  return {
    jour: ligne.jour,
    secondes: ligne.secondes,
    objectifMin: ligne.objectif_min,
    atteint: ligne.atteint === 1,
  };
}

// Lit le total d'un jour local (null = aucun segment flushé ce jour-là).
export function lireTempsJour(jour: string): { jour: string; secondes: number; objectifMin: number; atteint: boolean } | null {
  const ligne = db().prepare('SELECT * FROM temps_lecture WHERE jour = ?').get(jour) as LigneTemps | undefined;
  return ligne ? versTemps(ligne) : null;
}

// Ajoute un delta au jour local (UPSERT : secondes += delta, objectif_min =
// l'objectif courant poussé par le renderer, atteint recalculé contre
// lui). Rend la ligne à jour.
export function ajouterTempsLecture(
  jour: string,
  deltaSecondes: number,
  objectifMin: number,
): { jour: string; secondes: number; objectifMin: number; atteint: boolean } {
  const delta = Number.isFinite(deltaSecondes) ? Math.max(0, Math.floor(deltaSecondes)) : 0;
  const objectif = Number.isFinite(objectifMin) && objectifMin > 0 ? Math.floor(objectifMin) : 15;
  if (delta <= 0) {
    return lireTempsJour(jour) ?? { jour, secondes: 0, objectifMin: objectif, atteint: false };
  }
  const majLe = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO temps_lecture (jour, secondes, objectif_min, atteint, maj_le)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(jour) DO UPDATE SET secondes = secondes + excluded.secondes,
         objectif_min = excluded.objectif_min, maj_le = excluded.maj_le`,
    )
    .run(jour, delta, objectif, majLe);
  db()
    .prepare('UPDATE temps_lecture SET atteint = CASE WHEN secondes >= objectif_min * 60 THEN 1 ELSE 0 END WHERE jour = ?')
    .run(jour);
  const ligne = db().prepare('SELECT * FROM temps_lecture WHERE jour = ?').get(jour) as LigneTemps;
  return versTemps(ligne);
}

// Lit les 365 jours glissants { jour, atteint } (ordre chronologique,
// jours sans ligne = non atteint).
export function lireHistoriqueAtteinte(): JourAtteinte[] {
  const debut = jourLocalDecale(-364);
  const lignes = db()
    .prepare('SELECT jour, atteint FROM temps_lecture WHERE jour >= ? ORDER BY jour')
    .all(debut) as { jour: string; atteint: number }[];
  const parJour = new Map(lignes.map((l) => [l.jour, l.atteint === 1]));
  const jours: JourAtteinte[] = [];
  for (let delta = -364; delta <= 0; delta += 1) {
    const jour = jourLocalDecale(delta);
    jours.push({ jour, atteint: parJour.get(jour) === true });
  }
  return jours;
}

// Date locale AAAA-MM-JJ décalée de deltaJours (calculée ici plutôt que dans
// temps.ts, qui importe déjà ce module — évite un cycle d'imports).
function jourLocalDecale(deltaJours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deltaJours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Agrégats de statistiques (requêtes directes sur les tables existantes,
// recalculés à chaque appel — table minuscule, aucun cache).
export function lireStatsLecture(): StatsLecture {
  const aujourdhui = jourLocalDecale(0);
  const annee = aujourdhui.slice(0, 4);
  const debut = jourLocalDecale(-364); // 365 jours glissants, aujourd'hui inclus

  const lignes = db()
    .prepare('SELECT jour, secondes, atteint FROM temps_lecture WHERE jour >= ? ORDER BY jour')
    .all(debut) as { jour: string; secondes: number; atteint: number }[];
  const parJour = new Map(lignes.map((l) => [l.jour, l]));

  // 365 entrées calendaires (jours sans ligne = 0 min, non atteint).
  const jours: JourStatsLecture[] = [];
  for (let delta = -364; delta <= 0; delta += 1) {
    const jour = jourLocalDecale(delta);
    const ligne = parJour.get(jour);
    const secondes = ligne?.secondes ?? 0;
    jours.push({ jour, minutes: Math.floor(secondes / 60), atteint: (ligne?.atteint ?? 0) === 1 });
  }

  // Série actuelle : jours atteints consécutifs jusqu'à aujourd'hui (repli sur hier si aujourd'hui pas atteint).
  const atteintLe = (jour: string): boolean => parJour.get(jour)?.atteint === 1;
  let curseur = atteintLe(aujourdhui) ? aujourdhui : jourLocalDecale(-1);
  let serieActuelle = 0;
  while (atteintLe(curseur)) {
    serieActuelle += 1;
    const [a, m, j] = curseur.split('-').map(Number);
    const d = new Date(a, (m || 1) - 1, j || 1);
    d.setDate(d.getDate() - 1);
    curseur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Record : plus longue suite de atteint=1 sur tout l'historique (jours stockés
  // triés ; les trous calendaires coupent la suite, comme la série actuelle).
  const tous = db()
    .prepare('SELECT jour, atteint FROM temps_lecture ORDER BY jour')
    .all() as { jour: string; atteint: number }[];
  let serieRecord = 0;
  let enCours = 0;
  let precedent: string | null = null;
  for (const l of tous) {
    if (l.atteint === 1 && (precedent === null || lendemainDe(precedent) === l.jour)) {
      enCours += 1;
    } else if (l.atteint === 1) {
      enCours = 1;
    } else {
      enCours = 0;
    }
    if (enCours > serieRecord) serieRecord = enCours;
    precedent = l.jour;
  }

  // Année civile courante : somme + jours actifs (secondes>0).
  const an = db()
    .prepare(
      `SELECT COALESCE(SUM(secondes), 0) AS s,
        SUM(CASE WHEN secondes > 0 THEN 1 ELSE 0 END) AS n
        FROM temps_lecture WHERE jour LIKE ?`,
    )
    .get(`${annee}%`) as { s: number; n: number } | undefined;

  // Bibliothèque : terminés datés de l'année (même source que l'objectif annuel) + total (anciens inclus).
  const total = db()
    .prepare('SELECT COUNT(*) AS n FROM livres WHERE COALESCE(termine, 0) = 1')
    .get() as { n: number } | undefined;

  // Ancienneté : premier jour mesuré, repli première annotation (uniformisé AAAA-MM-JJ).
  const premierJour = db().prepare('SELECT MIN(jour) AS m FROM temps_lecture').get() as { m: string | null } | undefined;
  let membreDepuis: string | null = premierJour?.m ?? null;
  if (membreDepuis === null) {
    const premiereNote = db().prepare('SELECT MIN(cree_le) AS m FROM annotations').get() as { m: string | null } | undefined;
    membreDepuis = premiereNote?.m ? premiereNote.m.slice(0, 10) : null;
  }

  return {
    jours,
    serieActuelle,
    serieRecord,
    tempsAnneeSec: an?.s ?? 0,
    joursActifsAnnee: an?.n ?? 0,
    livresTerminesAnnee: compterTerminesAnnee(annee),
    totalLivresTermines: total?.n ?? 0,
    membreDepuis,
  };
}

// Lendemain calendaire d'un jour AAAA-MM-JJ (record : un trou coupe la suite).
function lendemainDe(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(a, (m || 1) - 1, j || 1);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
