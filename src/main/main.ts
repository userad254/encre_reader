import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  chargerAnnotations,
  chargerLivre,
  chargerMetaLivre,
  chargerPosition,
  associerLivreEtagere,
  compterTerminesAnnee,
  creerEtagere,
  etageresDuLivre,
  importerLivre,
  initDb,
  lireHistoriqueAtteinte,
  lireStatsLecture,
  listerEtageres,
  listerLivres,
  modifierNote,
  modifierStatutLivre,
  noteAuHasard,
  sauvegarderAnnotation,
  sauvegarderPosition,
  supprimerEtagere,
  supprimerAnnotation,
  supprimerLivre,
} from './db';
import type { DemandeExport, JourAtteinte, LivreOuvert, NouveauLivre, ObjectifAnneeStats, ResultatExport, SauvegardeAnnotation, StatsLecture, StatutLivre, TempsLectureJour } from '../shared/types';
import { fixerObjectif, fixerObjectifAnnee, flusherAvantQuitter, initialiserHorloge, lireObjectif, lireObjectifAnnee, signalerEtatLecture, signalerFocusFenetre, tempsAujourdHui } from './temps';

let fenetre: BrowserWindow | null = null;
const fractionAtterrissageParLivre = new Map<string, number | null>();

if (app.isPackaged) app.setName('Encre');

function marquerOuverture(livreId: string): void {
  fractionAtterrissageParLivre.set(livreId, null);
}

function sauvegarderPositionAvecAtterrissage(livreId: string, cfi: string, fraction: number) {
  const progression = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const atterrissage = fractionAtterrissageParLivre.get(livreId);
  if (atterrissage === undefined || atterrissage === null) {
    fractionAtterrissageParLivre.set(livreId, progression);
    return sauvegarderPosition(livreId, cfi, progression, progression);
  }
  return sauvegarderPosition(livreId, cfi, progression, atterrissage);
}

// Crée la fenêtre avec les verrous de sécurité (traite les warnings iframe d'U2 :
// on garde webSecurity, pas d'accès disque côté renderer, EPUB en Blob via IPC).
function creerFenetre(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png');
  fenetre = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'Encre', // T4a : nom d'app (token APP_NAME côté renderer)
    icon: iconPath,
    backgroundColor: '#f7f4ee',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, // Le renderer ne voit que window.api (pas require)
      nodeIntegration: false, // Pas de Node dans le renderer
      sandbox: true, // Renderer bac-à-sable (iframes blob foliate isolées, cf. U2)
    },
  });
  fenetre.setMenuBarVisibility(false);
  // T7a : horloge de lecture (Phase 7) — le main est la source de vérité : la vue
  // lecture signale son montage/démontage, la fenêtre son focus. Pause : blur,
  // minimiser, bibliothèque, fermeture (règle de mesure actée, DECISIONS.md).
  initialiserHorloge({
    focusInitial: fenetre.isFocused(),
    diffuser: (t: TempsLectureJour) => fenetre?.webContents.send('temps:maj', t),
  });
  fenetre.on('focus', () => signalerFocusFenetre(true));
  fenetre.on('blur', () => signalerFocusFenetre(false));
  fenetre.on('minimize', () => signalerFocusFenetre(false)); // Minimiser = pause (blur ne suffit pas partout)
  fenetre.on('restore', () => signalerFocusFenetre(true));
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const chargerDev = async () => {
      try {
        await fenetre?.loadURL(devUrl);
      } catch {
        setTimeout(() => void fenetre?.loadURL(devUrl), 600);
      }
    };
    void chargerDev();
  } else {
    void fenetre.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')); // Prod : build statique
  }
}

// Identité-livre T3b2 (décision actée : chemin absolu normalisé — Windows : minuscule,
// séparateurs `/`). Stable tant que le fichier ne bouge pas ; pas de hash (YAGNI).
function normaliserChemin(chemin: string): string {
  return chemin.toLowerCase().replace(/\\/g, '/');
}

// Lit un fichier EPUB en ArrayBuffer exact (copie hors pool Buffer).
function lireEpub(chemin: string): ArrayBuffer {
  const brut = fs.readFileSync(chemin);
  return brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength) as ArrayBuffer;
}

// Dialogue + lecture disque (main seul : le renderer sandboxé n'y a pas droit).
async function ouvrirLivre(): Promise<LivreOuvert | null> {
  if (!fenetre) return null;
  const choix = await dialog.showOpenDialog(fenetre, {
    properties: ['openFile'],
    filters: [{ name: 'EPUB', extensions: ['epub'] }],
  });
  if (choix.canceled || choix.filePaths.length === 0) return null;
  const chemin = choix.filePaths[0];
  const data = lireEpub(chemin);
  const nomFichier = path.basename(chemin);
  // T3b2 : id = chemin normalisé (une seule identité, grille et ouverture directe
  // partagent highlights/position ; les lignes pré-T3b2 clés au nom sont orphelines).
  const livreId = normaliserChemin(chemin);
  marquerOuverture(livreId);
  return { livreId, nomFichier, chemin, data };
}

// Ouvre un livre depuis la bibliothèque (T3b2 : null = entrée orpheline —
// chemin déplacé/supprimé — la carte affiche "introuvable", C4 : pas de throw).
async function ouvrirLivreDepuisId(id: string): Promise<LivreOuvert | null> {
  const entree = chargerLivre(id, true);
  if (!entree || !fs.existsSync(entree.chemin)) return null;
  const data = lireEpub(entree.chemin);
  marquerOuverture(entree.id);
  return { livreId: entree.id, nomFichier: path.basename(entree.chemin), chemin: entree.chemin, data };
}

// Rend la couleur stockée au format hex du schéma (T3e : schéma exige <hex> mais
// SQLite ne connaît que le jaune unique — correspondance assumée, pas de sélecteur).
function versHexCouleur(couleur: string): string {
  if (couleur === 'yellow') return '#FFFF00';
  return couleur; // Couleur future inconnue : valeur brute plutôt qu'invention (C3)
}

// Nettoie un titre pour un nom de fichier Windows (T3e : dialogue "enregistrer").
function nomFichierSain(titre: string): string {
  const nettoye = titre.replace(/[<>:"/\\|?*]/g, '_').trim();
  return nettoye ? nettoye : 'notes';
}

// Exporte les notes d'un livre en Markdown (T3e : schéma figé "Export Libraryna").
// Source de vérité = SQLite (relit les annotations, apparie par id) ; le regroupement
// par chapitre vient du renderer (calculé en T3d, jamais recalculé ici, C2).
// Le main écrit le fichier via le dialogue "enregistrer", jamais le renderer (sandbox).
async function exporterNotes(demande: DemandeExport): Promise<ResultatExport> {
  if (!fenetre) return { annule: true }; // Sans fenêtre : pas de dialogue → annulé, pas d'erreur
  const meta = chargerMetaLivre(demande.livreId);
  const titre = meta?.titre ?? demande.livreId; // Livre hors bibliothèque : id en repli
  const auteur = meta?.auteur ?? 'Inconnu';
  const choix = await dialog.showSaveDialog(fenetre, {
    defaultPath: `${nomFichierSain(titre)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (choix.canceled || !choix.filePath) return { annule: true }; // Annulé : ni fichier ni erreur
  const reference = chargerAnnotations(demande.livreId);
  const parId = new Map(reference.map((a) => [a.id, a]));
  const lignes: string[] = [
    `book: ${titre}`,
    `author: ${auteur}`,
    `bookId: ${demande.livreId}`,
    `exportedAt: ${new Date().toISOString()}`,
    '',
  ];
  for (const chap of demande.chapitres) {
    const items = chap.annotations.map((a) => parId.get(a.id)).filter((a) => a !== undefined);
    if (items.length === 0) continue; // Chapitre vidé depuis (suppression entre-temps) : omis, pas d'erreur
    lignes.push(`## ${chap.titre}`, '');
    for (const a of items) {
      for (const l of a.texteExtrait.split(/\r?\n/)) lignes.push(`> ${l}`);
      if (a.note?.trim()) lignes.push(`_note : ${a.note.trim().replace(/\r?\n/g, ' ')}_`);
      lignes.push(`cfi: ${a.cfi} · couleur: ${versHexCouleur(a.couleur)} · ${a.creeLe}`, '');
    }
  }
  fs.writeFileSync(choix.filePath, lignes.join('\n'), 'utf-8');
  return { annule: false, chemin: choix.filePath };
}

// Déclare les canaux IPC de T1/T2 (position distincte des annotations, DECISIONS.md)
// + T3b2 (bibliothèque : lister/importer/ouvrir/supprimer, identité = chemin normalisé).
function declarerIpc(): void {
  ipcMain.handle('livre:ouvrir', () => ouvrirLivre());
  ipcMain.handle('annotations:charger', (_e, livreId: string) => chargerAnnotations(livreId));
  ipcMain.handle('annotations:sauvegarder', (_e, s: SauvegardeAnnotation) => sauvegarderAnnotation(s));
  ipcMain.handle('annotations:modifierNote', (_e, id: number, note: string | null) => modifierNote(id, note));
  ipcMain.handle('annotations:supprimer', (_e, id: number) => supprimerAnnotation(id));
  ipcMain.handle('position:charger', (_e, livreId: string) => chargerPosition(livreId));
  ipcMain.handle('position:sauvegarder', (_e, livreId: string, cfi: string, fraction: number) => sauvegarderPositionAvecAtterrissage(livreId, cfi, fraction));
  ipcMain.handle('livres:lister', () => listerLivres((chemin) => fs.existsSync(chemin)));
  ipcMain.handle('livres:importer', (_e, n: NouveauLivre) => importerLivre(normaliserChemin(n.chemin), n));
  ipcMain.handle('livres:ouvrirDepuisId', (_e, id: string) => ouvrirLivreDepuisId(id));
  ipcMain.handle('livres:modifierStatut', (_e, id: string, statut: StatutLivre) => modifierStatutLivre(id, statut));
  ipcMain.handle('livres:supprimer', (_e, id: string) => supprimerLivre(id));
  ipcMain.handle('etageres:lister', () => listerEtageres());
  ipcMain.handle('etageres:creer', (_e, nom: string) => creerEtagere(nom));
  ipcMain.handle('etageres:supprimer', (_e, id: number) => supprimerEtagere(id));
  ipcMain.handle('etageres:associer', (_e, livreId: string, etagereId: number, associer: boolean) =>
    associerLivreEtagere(livreId, etagereId, associer),
  );
  ipcMain.handle('etageres:duLivre', (_e, livreId: string) => etageresDuLivre(livreId));
  ipcMain.handle('notes:exporter', (_e, d: DemandeExport) => exporterNotes(d));
  ipcMain.handle('notes:auHasard', (_e, exclusions: number[]) => noteAuHasard(exclusions ?? []));
  ipcMain.on('lecture:etat', (_e, actif: boolean) => signalerEtatLecture(actif === true)); // T7a : fire-and-forget, pas de réponse
  ipcMain.handle('temps:aujourdhui', () => tempsAujourdHui()); // T7a : { jour, secondes, atteint } depuis SQLite
  ipcMain.handle('objectifs:fixer', (_e, minutes: number) => fixerObjectif(minutes)); // T7b : stocke l'objectif (rend la valeur)
  ipcMain.handle('objectifs:jour', () => lireObjectif()); // T7b : objectif courant (15 par défaut)
  ipcMain.handle('temps:historique', (): JourAtteinte[] => lireHistoriqueAtteinte()); // T7b : 7 derniers jours pour le streak
  ipcMain.handle('objectifs:fixerAnnee', (_e, nombre: number) => fixerObjectifAnnee(nombre)); // T7c : stocke l'objectif annuel (rend la valeur)
  ipcMain.handle('objectifs:anneeStats', (): ObjectifAnneeStats => { // T7c : { annee, termines, objectif }
    const annee = String(new Date().getFullYear());
    return { annee, termines: compterTerminesAnnee(annee), objectif: lireObjectifAnnee() };
  });
  ipcMain.handle('stats:lecture', (): StatsLecture => lireStatsLecture()); // T8a : agrégats 365j + séries + année (AUCUNE UI)
}

// Démarrage : base SQLite dans userData (elle survit à la fermeture de l'app = CA6).
void app.whenReady().then(() => {
  initDb(path.join(app.getPath('userData'), 'lecteur.db'));
  declarerIpc();
  creerFenetre();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
  });
});

// Quitte sur Linux/macOS à la fermeture ; sur Windows on laisse le comportement Électron.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// T7a : flush synchrone de l'horloge avant de quitter (le segment ouvert est clos, raison quit).
app.on('before-quit', () => {
  flusherAvantQuitter();
});
