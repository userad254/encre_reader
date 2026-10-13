// Types partagés main <-> renderer (C5 : UNE seule définition, importée des
// deux côtés, jamais dupliquée).

// Un highlight ancré (D4 : CFI + texte garde-fou, jamais d'offset écran).
export interface Annotation {
  id: number; // id SQLite (0 = pas encore sauvé, jamais en pratique côté renderer)
  livreId: string; // Livre d'appartenance (T1 : nom du fichier, pas de bibliothèque)
  cfi: string; // Ancre CFI produite par l'API publique foliate (getCFI)
  texteExtrait: string; // Garde-fou D4 : texte au moment du surlignage
  couleur: string; // Couleur de l'aplat (T1 : toujours 'yellow', C4)
  note: string | null; // T3d : note libre, donnée livre → SQLite (null = vide)
  creeLe: string; // Date ISO8601 de création
}

// Position de lecture d'un livre (D4/CA6 : schéma distinct des highlights, DECISIONS.md).
export interface PositionLivre {
  livreId: string;
  cfi: string; // Ancre CFI de dernière page consultée
  majLe: string; // Date ISO8601 de dernière mise à jour
  fraction?: number; // T5a1 : fraction foliate chargée avec la position
  termine?: boolean; // T5a3 : un livre terminé reprend au début, sauf CFI imposé
}

// Livre ouvert : le main lit le disque, le renderer reçoit des octets.
// Le renderer sandboxé ne touche JAMAIS au disque (traite les warnings iframe d'U2).
export interface LivreOuvert {
  livreId: string; // T3b2 : chemin absolu normalisé (identité-livre actée, plus le nom)
  nomFichier: string;
  chemin: string; // T3b2 : chemin absolu d'origine (le main seul y a accès)
  data: ArrayBuffer; // Contenu .epub brut (Blob côté renderer)
}

// Ce que le renderer envoie pour sauver un highlight (l'id/date sont mis par SQLite).
export interface SauvegardeAnnotation {
  livreId: string;
  cfi: string;
  texteExtrait: string;
  couleur: string;
  note: string | null; // T3d : surligner() crée note vide (null), édition via modifierNote
}

// La couverture voyage en ArrayBuffer (copie du BLOB SQLite) ou null (placeholder).
// Entrée de bibliothèque T3b2 (identité-livre = chemin absolu normalisé, DECISIONS.md).
export interface LivreBiblio {
  id: string; // Chemin absolu normalisé (minuscule, `/` sur Windows)
  chemin: string; // Chemin absolu d'origine (lecture disque côté main)
  titre: string; // Extrait via book.metadata foliate (D5), jamais parsé maison
  auteur: string | null; // Premier auteur foliate, ou null si inconnu
  couverture: ArrayBuffer | null; // Image de book.getCover() foliate (D5), ou null
  ajouteLe: string; // Date ISO8601 d'import
  progress: number; // T5a : fraction foliate persistée
  termine: boolean; // T5a : état de complétion
  derniereLecture: string | null; // Dernière mise à jour de position, pour le tri renderer
  existe: boolean; // Calculé à la volée (existsSync) : faux = entrée orpheline
}

export interface EtagereUtilisateur {
  id: number;
  nom: string;
  creeLe: string | null;
}

export type StatutLivre = 'termine' | 'a-lire';

// Ce que le renderer envoie pour importer (titre/auteur/couverture déjà extraits
// via l'API foliate côté renderer — foliate exige le DOM, le main n'en a pas, D5/C3).
export interface NouveauLivre {
  chemin: string;
  titre: string;
  auteur: string | null;
  couverture: ArrayBuffer | null;
}

// Chapitre d'export T3e (regroupement calculé en T3d — tocRef + resolveCFI —
// réutilisé tel quel par l'export, jamais recalculé, C2).
export interface ChapitreExport {
  titre: string;
  annotations: Annotation[]; // Dans l'ordre du livre (tri T3d)
}

// Demande d'export Markdown (T3e : schéma figé "Export Libraryna", DECISIONS.md).
export interface DemandeExport {
  livreId: string;
  chapitres: ChapitreExport[];
}

// Résultat d'export (T3e : annulé = dialogue fermé → ni fichier ni erreur).
export interface ResultatExport {
  annule: boolean;
  chemin?: string; // Présent si écriture réussie
}

// Note tirée au hasard + sa source (T4f "Se relire" : LEFT JOIN car lignes
// orphelines pré-T3b2 → repli "Inconnu", jamais de chapitre — YAGNI).
export interface NoteAuHasard extends Annotation {
  livreTitre: string;
  livreAuteur: string;
}

// Mesure du temps de lecture du jour (Phase 7/T7a : horloge tenue par le main,
// jamais de heartbeat renderer ; l'UI viendra en T7b).
export interface TempsLectureJour {
  jour: string; // AAAA-MM-JJ en heure locale
  secondes: number; // Total accumulé du jour (segments lecture montée + focused)
  atteint: boolean; // secondes >= objectif du moment (T7b : presets, 15 par défaut)
}

// Un jour et son atteinte (Phase 7/T7b : streak depuis les 7 derniers jours).
export interface JourAtteinte {
  jour: string; // AAAA-MM-JJ en heure locale
  atteint: boolean;
}

// Stats annuelles (Phase 7/T7c : livres datés termine_le de l'année + objectif poussé).
export interface ObjectifAnneeStats {
  annee: string; // AAAA en heure locale (côté main)
  termines: number; // COUNT livres WHERE termine_le commence par annee
  objectif: number; // Objectif annuel retenu par le main (3 par défaut)
}

// Un jour de lecture pour les stats (Phase 8/T8a : heatmap 12 mois glissants).
export interface JourStatsLecture {
  jour: string; // AAAA-MM-JJ en heure locale
  minutes: number; // floor(secondes / 60) — même arrondi que le widget sidebar
  atteint: boolean; // secondes >= objectif du flush (stocké, jamais recalculé)
}

// Agrégats de statistiques (Phase 8/T8a : calculés à chaque appel depuis les
// tables existantes — temps_lecture, livres.termine_le, annotations — sans
// nouvelle table, sans nouvelle mesure, sans cache).
export interface StatsLecture {
  jours: JourStatsLecture[]; // 365 jours glissants jusqu'à aujourd'hui, ordre chronologique
  serieActuelle: number; // Atteints consécutifs jusqu'à aujourd'hui (repli hier, règle T7b)
  serieRecord: number; // Plus longue suite de atteint=1 (tout l'historique)
  tempsAnneeSec: number; // Somme des secondes de l'année civile courante
  joursActifsAnnee: number; // Jours secondes>0 de l'année civile courante
  livresTerminesAnnee: number; // COUNT livres WHERE termine_le commence par l'année (même source que T7c)
  totalLivresTermines: number; // COUNT livres WHERE termine = 1 (legacy inclus)
  membreDepuis: string | null; // MIN(jour) temps_lecture, repli MIN(cree_le) annotations (AAAA-MM-JJ), null si vide
}

// Pont IPC exposé par le preload (sécurisé : fonctions nommées, pas d'ipc brut).
export interface ApiLecteur {
  ouvrirLivre(): Promise<LivreOuvert | null>; // Dialogue + lecture disque (main)
  chargerAnnotations(livreId: string): Promise<Annotation[]>; // Lecture SQLite (main)
  sauvegarderAnnotation(s: SauvegardeAnnotation): Promise<Annotation>; // Écriture SQLite (main)
  modifierNote(id: number, note: string | null): Promise<void>; // T3d : UPDATE note SQLite (main)
  supprimerAnnotation(id: number): Promise<void>; // T3d : DELETE highlight SQLite (main)
  exporterNotes(d: DemandeExport): Promise<ResultatExport>; // T3e : Markdown via dialogue (main)
  chargerPosition(livreId: string): Promise<PositionLivre | null>; // Lecture position SQLite (main)
  sauvegarderPosition(livreId: string, cfi: string, fraction: number): Promise<PositionLivre>; // Position + fraction SQLite (main)
  listerLivres(): Promise<LivreBiblio[]>; // T3b2 : grille bibliothèque (main)
  importerLivre(n: NouveauLivre): Promise<LivreBiblio>; // T3b2 : ajoute un chemin (main)
  ouvrirLivreDepuisId(id: string): Promise<LivreOuvert | null>; // T3b2 : null = orphelin
  modifierStatutLivre(id: string, statut: StatutLivre): Promise<void>; // T5a2 : terminer ou remettre à lire
  supprimerLivre(id: string): Promise<void>; // T3b2 : retire la carte (annotations gardées)
  listerEtageres(): Promise<EtagereUtilisateur[]>;
  creerEtagere(nom: string): Promise<EtagereUtilisateur>;
  supprimerEtagere(id: number): Promise<void>;
  associerLivreEtagere(livreId: string, etagereId: number, associer: boolean): Promise<void>;
  etageresDuLivre(livreId: string): Promise<number[]>;
  auHasardNotes(exclusions: number[]): Promise<NoteAuHasard | null>; // T4f : note au hasard (null = vide)
  signalerEtatLecture(actif: boolean): void; // T7a : montage/démontage vue lecture (fire-and-forget)
  tempsAujourdHui(): Promise<TempsLectureJour>; // T7a : total du jour depuis SQLite (main)
  surMajTemps(ecouter: (t: TempsLectureJour) => void): () => void; // T7a+T7b : push à chaque flush
  fixerObjectif(minutes: number): Promise<number>; // T7b : pousse l'objectif au main (atteint calculé au flush)
  objectifJour(): Promise<number>; // T7b : objectif courant du main (15 par défaut)
  tempsHistorique(): Promise<JourAtteinte[]>; // T7b : 7 derniers jours { jour, atteint } pour le streak
  fixerObjectifAnnee(nombre: number): Promise<number>; // T7c : pousse l'objectif annuel au main (rend la valeur)
  anneeStats(): Promise<ObjectifAnneeStats>; // T7c : { annee, termines, objectif } depuis SQLite + valeur poussée
  statsLecture(): Promise<StatsLecture>; // T8a : agrégats 365j + séries + année + bibliothèque (AUCUNE UI)
}
