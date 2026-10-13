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
  // Lit les highlights SQLite d'un livre (main) — ils survivent à la fermeture et à la réouverture.
  chargerAnnotations(livreId: string): Promise<Annotation[]> {
    return ipcRenderer.invoke('annotations:charger', livreId);
  },
  // Sauve un highlight en SQLite (main) et rend l'Annotation complète.
  sauvegarderAnnotation(s: SauvegardeAnnotation): Promise<Annotation> {
    return ipcRenderer.invoke('annotations:sauvegarder', s);
  },
  // Met à jour la note d'un highlight en SQLite (main) — la note appartient au livre.
  modifierNote(id: number, note: string | null): Promise<void> {
    return ipcRenderer.invoke('annotations:modifierNote', id, note);
  },
  // Supprime un highlight en SQLite (main) — suppression définitive, sans corbeille.
  supprimerAnnotation(id: number): Promise<void> {
    return ipcRenderer.invoke('annotations:supprimer', id);
  },
  // Exporte les notes en Markdown via le dialogue du main (format fixe, voir types partagés).
  exporterNotes(d: DemandeExport): Promise<ResultatExport> {
    return ipcRenderer.invoke('notes:exporter', d);
  },
  // Lit la position de lecture SQLite d'un livre (main) — pour reprendre où on s'était arrêté.
  chargerPosition(livreId: string): Promise<PositionLivre | null> {
    return ipcRenderer.invoke('position:charger', livreId);
  },
  // Sauve la position courante en SQLite (main).
  sauvegarderPosition(livreId: string, cfi: string, fraction: number): Promise<PositionLivre> {
    return ipcRenderer.invoke('position:sauvegarder', livreId, cfi, fraction);
  },
  // Liste la bibliothèque SQLite (main) — grille d'accueil.
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
  // Met à jour uniquement les états déclarables (terminé / à lire : « en cours » se mesure, ne se déclare pas).
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
  // Tire une note au hasard hors exclusions (main, carte « Se relire ») — null si vide.
  auHasardNotes(exclusions: number[]): Promise<NoteAuHasard | null> {
    return ipcRenderer.invoke('notes:auHasard', exclusions);
  },
  // Signale le montage/démontage de la vue lecture (main, horloge) — envoi sans réponse attendue.
  signalerEtatLecture(actif: boolean): void {
    ipcRenderer.send('lecture:etat', actif);
  },
  // Lit le total de lecture du jour depuis SQLite (main).
  tempsAujourdHui(): Promise<TempsLectureJour> {
    return ipcRenderer.invoke('temps:aujourdhui');
  },
  // Notification poussée à chaque flush de l'horloge (main) — suivie par l'anneau et le widget d'objectif.
  surMajTemps(ecouter: (t: TempsLectureJour) => void): () => void {
    const relais = (_e: unknown, t: TempsLectureJour) => ecouter(t);
    ipcRenderer.on('temps:maj', relais);
    return () => {
      ipcRenderer.removeListener('temps:maj', relais);
    };
  },
  // Pousse l'objectif journalier au main — rend la valeur stockée.
  fixerObjectif(minutes: number): Promise<number> {
    return ipcRenderer.invoke('objectifs:fixer', minutes);
  },
  // Lit l'objectif journalier courant du main — 15 par défaut si rien fixé.
  objectifJour(): Promise<number> {
    return ipcRenderer.invoke('objectifs:jour');
  },
  // Lit les derniers jours { jour, atteint } pour la série de jours consécutifs.
  tempsHistorique(): Promise<JourAtteinte[]> {
    return ipcRenderer.invoke('temps:historique');
  },
  // Pousse l'objectif annuel au main — rend la valeur retenue.
  fixerObjectifAnnee(nombre: number): Promise<number> {
    return ipcRenderer.invoke('objectifs:fixerAnnee', nombre);
  },
  // Lit { annee, termines, objectif } pour la ligne annuelle du widget.
  anneeStats(): Promise<ObjectifAnneeStats> {
    return ipcRenderer.invoke('objectifs:anneeStats');
  },
  // Lit les agrégats de statistiques (année, séries, heatmap) — calculés à la demande.
  statsLecture(): Promise<StatsLecture> {
    return ipcRenderer.invoke('stats:lecture');
  },
};

contextBridge.exposeInMainWorld('api', api);
