// Types partagés main <-> renderer : UNE seule définition, importée des deux
// côtés, jamais dupliquée.

// Un highlight ancré (CFI + texte recopié en garde-fou, jamais d'offset écran).
export interface Annotation {
  id: number; // id SQLite (0 = pas encore sauvé, jamais en pratique côté renderer)
  livreId: string; // Livre d'appartenance (à l'origine : simple nom du fichier, avant la bibliothèque)
  cfi: string; // Ancre CFI produite par l'API publique foliate (getCFI)
  texteExtrait: string; // Texte recopié au moment du surlignage, garde-fou si le CFI ne résout plus
  couleur: string; // Couleur de l'aplat (une seule : jaune — pas de sélecteur sans besoin réel)
  note: string | null; // Note libre, stockée en SQLite avec le highlight (null = vide)
  creeLe: string; // Date ISO8601 de création
}

// Position de lecture d'un livre (table distincte des highlights : reprendre n'est pas surligner).
export interface PositionLivre {
  livreId: string;
  cfi: string; // Ancre CFI de dernière page consultée
  majLe: string; // Date ISO8601 de dernière mise à jour
  fraction?: number; // Fraction lue chargée avec la position (0 = début, 1 = fin)
  termine?: boolean; // Un livre terminé reprend au début, sauf passage imposé
}

// Livre ouvert : le main lit le disque, le renderer reçoit des octets.
// Le renderer sandboxé ne touche JAMAIS au disque (l'EPUB voyage en Blob via IPC, sécurité web conservée).
export interface LivreOuvert {
  livreId: string; // Chemin absolu normalisé (identité du livre, plus le simple nom)
  nomFichier: string;
  chemin: string; // Chemin absolu d'origine (le main seul y a accès)
  data: ArrayBuffer; // Contenu .epub brut (Blob côté renderer)
}

// Ce que le renderer envoie pour sauver un highlight (l'id/date sont mis par SQLite).
export interface SauvegardeAnnotation {
  livreId: string;
  cfi: string;
  texteExtrait: string;
  couleur: string;
  note: string | null; // Surligner crée une note vide (null), éditée ensuite via modifierNote
}

// La couverture voyage en ArrayBuffer (copie du BLOB SQLite) ou null (placeholder).
// Entrée de bibliothèque (l'identité d'un livre est son chemin absolu normalisé).
export interface LivreBiblio {
  id: string; // Chemin absolu normalisé (minuscule, `/` sur Windows)
  chemin: string; // Chemin absolu d'origine (lecture disque côté main)
  titre: string; // Extrait via les métadonnées foliate, jamais parsé à la main
  auteur: string | null; // Premier auteur foliate, ou null si inconnu
  couverture: ArrayBuffer | null; // Image via book.getCover() foliate, ou null
  ajouteLe: string; // Date ISO8601 d'import
  progress: number; // Fraction lue persistée (0 = début, 1 = fin)
  termine: boolean; // État de complétion
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
// via foliate côté renderer — foliate exige le DOM, le main n'en a pas : le main persiste seulement).
export interface NouveauLivre {
  chemin: string;
  titre: string;
  auteur: string | null;
  couverture: ArrayBuffer | null;
}

// Chapitre d'export (regroupement calculé une fois côté panneau notes —
// tocRef + resolveCFI — réutilisé tel quel par l'export, jamais recalculé).
export interface ChapitreExport {
  titre: string;
  annotations: Annotation[]; // Dans l'ordre du livre
}

// Demande d'export Markdown (format fixe « Export Libraryna », voir DECISIONS.md).
export interface DemandeExport {
  livreId: string;
  chapitres: ChapitreExport[];
}

// Résultat d'export (annulé = dialogue fermé → ni fichier ni erreur).
export interface ResultatExport {
  annule: boolean;
  chemin?: string; // Présent si écriture réussie
}

// Note tirée au hasard + sa source (carte « Se relire » : LEFT JOIN car les
// lignes très anciennes sans entrée bibliothèque → repli "Inconnu", jamais de vide discret).
export interface NoteAuHasard extends Annotation {
  livreTitre: string;
  livreAuteur: string;
}

// Mesure du temps de lecture du jour (horloge tenue par le main,
// jamais de battement côté renderer).
export interface TempsLectureJour {
  jour: string; // AAAA-MM-JJ en heure locale
  secondes: number; // Total accumulé du jour (vue lecture montée + fenêtre au focus)
  atteint: boolean; // secondes >= objectif du moment (boutons 5–60 min, 15 par défaut)
}

// Un jour et son atteinte (série de jours consécutifs depuis les derniers jours).
export interface JourAtteinte {
  jour: string; // AAAA-MM-JJ en heure locale
  atteint: boolean;
}

// Stats annuelles (livres datés termine_le de l'année + objectif poussé par le renderer).
export interface ObjectifAnneeStats {
  annee: string; // AAAA en heure locale (côté main)
  termines: number; // COUNT livres WHERE termine_le commence par annee
  objectif: number; // Objectif annuel retenu par le main (3 par défaut)
}

// Un jour de lecture pour les stats (heatmap 12 mois glissants).
export interface JourStatsLecture {
  jour: string; // AAAA-MM-JJ en heure locale
  minutes: number; // floor(secondes / 60) — même arrondi que le widget
  atteint: boolean; // secondes >= objectif du flush (stocké, jamais recalculé)
}

// Agrégats de statistiques (calculés à chaque appel depuis les tables
// existantes — temps_lecture, livres.termine_le, annotations — sans
// nouvelle table, sans nouvelle mesure, sans cache).
export interface StatsLecture {
  jours: JourStatsLecture[]; // 365 jours glissants jusqu'à aujourd'hui, ordre chronologique
  serieActuelle: number; // Jours atteints consécutifs jusqu'à aujourd'hui (repli sur hier si aujourd'hui pas atteint)
  serieRecord: number; // Plus longue suite de atteint=1 (tout l'historique)
  tempsAnneeSec: number; // Somme des secondes de l'année civile courante
  joursActifsAnnee: number; // Jours secondes>0 de l'année civile courante
  livresTerminesAnnee: number; // COUNT livres WHERE termine_le commence par l'année (même source que l'objectif annuel)
  totalLivresTermines: number; // COUNT livres WHERE termine = 1 (anciens inclus)
  membreDepuis: string | null; // MIN(jour) temps_lecture, repli MIN(cree_le) annotations (AAAA-MM-JJ), null si vide
}

// Pont IPC exposé par le preload (sécurisé : fonctions nommées, pas d'ipc brut).
export interface ApiLecteur {
  ouvrirLivre(): Promise<LivreOuvert | null>; // Dialogue + lecture disque (main)
  chargerAnnotations(livreId: string): Promise<Annotation[]>; // Lecture SQLite (main)
  sauvegarderAnnotation(s: SauvegardeAnnotation): Promise<Annotation>; // Écriture SQLite (main)
  modifierNote(id: number, note: string | null): Promise<void>; // UPDATE de la note en SQLite (main)
  supprimerAnnotation(id: number): Promise<void>; // DELETE du highlight en SQLite (main)
  exporterNotes(d: DemandeExport): Promise<ResultatExport>; // Markdown via le dialogue d'enregistrement (main)
  chargerPosition(livreId: string): Promise<PositionLivre | null>; // Lecture position SQLite (main)
  sauvegarderPosition(livreId: string, cfi: string, fraction: number): Promise<PositionLivre>; // Position + fraction SQLite (main)
  listerLivres(): Promise<LivreBiblio[]>; // Grille bibliothèque (main)
  importerLivre(n: NouveauLivre): Promise<LivreBiblio>; // Ajoute un chemin à la bibliothèque (main)
  ouvrirLivreDepuisId(id: string): Promise<LivreOuvert | null>; // null = entrée orpheline (fichier déplacé ou supprimé)
  modifierStatutLivre(id: string, statut: StatutLivre): Promise<void>; // Terminer ou remettre à lire
  supprimerLivre(id: string): Promise<void>; // Retire la carte (annotations et position gardées)
  listerEtageres(): Promise<EtagereUtilisateur[]>;
  creerEtagere(nom: string): Promise<EtagereUtilisateur>;
  supprimerEtagere(id: number): Promise<void>;
  associerLivreEtagere(livreId: string, etagereId: number, associer: boolean): Promise<void>;
  etageresDuLivre(livreId: string): Promise<number[]>;
  auHasardNotes(exclusions: number[]): Promise<NoteAuHasard | null>; // Note au hasard (null = aucune note)
  signalerEtatLecture(actif: boolean): void; // Montage/démontage de la vue lecture, sans réponse (main)
  tempsAujourdHui(): Promise<TempsLectureJour>; // Total du jour depuis SQLite (main)
  surMajTemps(ecouter: (t: TempsLectureJour) => void): () => void; // Notification poussée à chaque flush de l'horloge
  fixerObjectif(minutes: number): Promise<number>; // Pousse l'objectif journalier au main (atteinte calculée au flush)
  objectifJour(): Promise<number>; // Objectif journalier courant du main (15 par défaut)
  tempsHistorique(): Promise<JourAtteinte[]>; // Derniers jours { jour, atteint } pour la série
  fixerObjectifAnnee(nombre: number): Promise<number>; // Pousse l'objectif annuel au main (rend la valeur)
  anneeStats(): Promise<ObjectifAnneeStats>; // { annee, termines, objectif } depuis SQLite + valeur poussée
  statsLecture(): Promise<StatsLecture>; // Agrégats 365 jours + séries + année + bibliothèque
}
