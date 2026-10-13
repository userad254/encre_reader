import { contextBridge, ipcRenderer } from 'electron';
import type {
  Annotation,
  ApiLecteur,
  DemandeExport,
  EtagereUtilisateur,
  JourAtteinte,
  LivreBiblio,
  LivreOuvert,
  NoteAuHasard,
  NouveauLivre,
  ObjectifAnneeStats,
  PositionLivre,
  ResultatExport,
  SauvegardeAnnotation,
  StatsLecture,
  StatutLivre,
  TempsLectureJour,
} from '../shared/types';

// Pont IPC sécurisé (seul code avec ipcRenderer : le renderer ne voit que window.api).
const api: ApiLecteur = {
  // Ouvre le dialogue + lit le .epub (main), rend octets + id.
  ouvrirLivre(): Promise<LivreOuvert | null> {
    return ipcRenderer.invoke('livre:ouvrir');
  },
  // Lit les highlights SQLite d'un livre (main) — survie fermeture/réouverture (CA6).
  chargerAnnotations(livreId: string): Promise<Annotation[]> {
    return ipcRenderer.invoke('annotations:charger', livreId);
  },
  // Sauve un highlight en SQLite (main) et rend l'Annotation complète.
  sauvegarderAnnotation(s: SauvegardeAnnotation): Promise<Annotation> {
    return ipcRenderer.invoke('annotations:sauvegarder', s);
  },
  // Met à jour la note d'un highlight en SQLite (main) — T3d, donnée livre.
  modifierNote(id: number, note: string | null): Promise<void> {
    return ipcRenderer.invoke('annotations:modifierNote', id, note);
  },
  // Supprime un highlight en SQLite (main) — T3d, hard delete sans corbeille.
  supprimerAnnotation(id: number): Promise<void> {
    return ipcRenderer.invoke('annotations:supprimer', id);
  },
  // Exporte les notes en Markdown via le dialogue du main (T3e : schéma figé).
  exporterNotes(d: DemandeExport): Promise<ResultatExport> {
    return ipcRenderer.invoke('notes:exporter', d);
  },
  // Lit la position de lecture SQLite d'un livre (main) — reprise de lecture (CA6).
  chargerPosition(livreId: string): Promise<PositionLivre | null> {
    return ipcRenderer.invoke('position:charger', livreId);
  },
  // Sauve la position courante en SQLite (main).
  sauvegarderPosition(livreId: string, cfi: string, fraction: number): Promise<PositionLivre> {
    return ipcRenderer.invoke('position:sauvegarder', livreId, cfi, fraction);
  },
  // Liste la bibliothèque SQLite (main) — grille d'accueil T3b2.
  listerLivres(): Promise<LivreBiblio[]> {
    return ipcRenderer.invoke('livres:lister');
  },
  // Ajoute un chemin à la bibliothèque (main) — métadonnées déjà extraites via foliate.
  importerLivre(n: NouveauLivre): Promise<LivreBiblio> {
    return ipcRenderer.invoke('livres:importer', n);
  },
  // Lit un livre de la bibliothèque (main) — null si entrée orpheline.
  ouvrirLivreDepuisId(id: string): Promise<LivreOuvert | null> {
    return ipcRenderer.invoke('livres:ouvrirDepuisId', id);
  },
  // Met à jour uniquement les états déclarables T5a2.
  modifierStatutLivre(id: string, statut: StatutLivre): Promise<void> {
    return ipcRenderer.invoke('livres:modifierStatut', id, statut);
  },
  // Retire une carte de la bibliothèque (main).
  supprimerLivre(id: string): Promise<void> {
    return ipcRenderer.invoke('livres:supprimer', id);
  },
  listerEtageres(): Promise<EtagereUtilisateur[]> {
    return ipcRenderer.invoke('etageres:lister');
  },
  creerEtagere(nom: string): Promise<EtagereUtilisateur> {
    return ipcRenderer.invoke('etageres:creer', nom);
  },
  supprimerEtagere(id: number): Promise<void> {
    return ipcRenderer.invoke('etageres:supprimer', id);
  },
  associerLivreEtagere(livreId: string, etagereId: number, associer: boolean): Promise<void> {
    return ipcRenderer.invoke('etageres:associer', livreId, etagereId, associer);
  },
  etageresDuLivre(livreId: string): Promise<number[]> {
    return ipcRenderer.invoke('etageres:duLivre', livreId);
  },
  // Tire une note au hasard hors exclusions (main) — T4f, null si vide.
  auHasardNotes(exclusions: number[]): Promise<NoteAuHasard | null> {
    return ipcRenderer.invoke('notes:auHasard', exclusions);
  },
  // Signale le montage/démontage de la vue lecture (main) — T7a, fire-and-forget.
  signalerEtatLecture(actif: boolean): void {
    ipcRenderer.send('lecture:etat', actif);
  },
  // Lit le total du jour depuis SQLite (main) — T7a.
  tempsAujourdHui(): Promise<TempsLectureJour> {
    return ipcRenderer.invoke('temps:aujourdhui');
  },
  // Push à chaque flush (main) — T7a : le renderer l'ignore, il servira en T7b.
  surMajTemps(ecouter: (t: TempsLectureJour) => void): () => void {
    const relais = (_e: unknown, t: TempsLectureJour) => ecouter(t);
    ipcRenderer.on('temps:maj', relais);
    return () => {
      ipcRenderer.removeListener('temps:maj', relais);
    };
  },
  // Pousse l'objectif journalier au main (T7b) — rend la valeur stockée.
  fixerObjectif(minutes: number): Promise<number> {
    return ipcRenderer.invoke('objectifs:fixer', minutes);
  },
  // Lit l'objectif courant du main (T7b) — 15 par défaut si rien fixé.
  objectifJour(): Promise<number> {
    return ipcRenderer.invoke('objectifs:jour');
  },
  // Lit les 7 derniers jours { jour, atteint } pour le streak (T7b).
  tempsHistorique(): Promise<JourAtteinte[]> {
    return ipcRenderer.invoke('temps:historique');
  },
  // Pousse l'objectif annuel au main (T7c) — rend la valeur retenue.
  fixerObjectifAnnee(nombre: number): Promise<number> {
    return ipcRenderer.invoke('objectifs:fixerAnnee', nombre);
  },
  // Lit { annee, termines, objectif } pour la ligne annuelle du widget (T7c).
  anneeStats(): Promise<ObjectifAnneeStats> {
    return ipcRenderer.invoke('objectifs:anneeStats');
  },
  // Lit les agrégats de statistiques (T8a) — AUCUNE UI, vérification console.
  statsLecture(): Promise<StatsLecture> {
    return ipcRenderer.invoke('stats:lecture');
  },
};

contextBridge.exposeInMainWorld('api', api);
