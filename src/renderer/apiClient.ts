import type {
  Annotation,
  ApiLecteur,
  DemandeExport,
  EtagereUtilisateur,
  JourAtteinte,
  JourStatsLecture,
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

// Livres de démonstration littéraire pour prévisualisation web immédiate si pas d'Electron
const LIVRES_DEMO_WEB: LivreBiblio[] = [
  {
    id: 'demo-1',
    chemin: 'demo-1.epub',
    titre: 'L’Art de la Typographie Moderne',
    auteur: 'Émile Janvrot',
    couverture: null,
    ajouteLe: new Date().toISOString(),
    progress: 0,
    termine: false,
    derniereLecture: null,
    existe: true,
  },
  {
    id: 'demo-2',
    chemin: 'demo-2.epub',
    titre: 'Le Silence des Bibliothèques',
    auteur: 'Marguerite Alverne',
    couverture: null,
    ajouteLe: new Date().toISOString(),
    progress: 0,
    termine: false,
    derniereLecture: null,
    existe: true,
  },
  {
    id: 'demo-3',
    chemin: 'demo-3.epub',
    titre: 'Chroniques du Papier Vélin',
    auteur: 'Antoine de Saint-Simon',
    couverture: null,
    ajouteLe: new Date().toISOString(),
    progress: 0,
    termine: false,
    derniereLecture: null,
    existe: true,
  },
];

class FallbackWebClient implements ApiLecteur {
  private getAssociations(): { livreId: string; etagereId: number }[] {
    try {
      return JSON.parse(localStorage.getItem('encre-web-associations') ?? '[]') as { livreId: string; etagereId: number }[];
    } catch {
      return [];
    }
  }

  private sauverAssociations(associations: { livreId: string; etagereId: number }[]): void {
    try {
      localStorage.setItem('encre-web-associations', JSON.stringify(associations));
    } catch {
      /* ignore */
    }
  }

  private getEtageres(): EtagereUtilisateur[] {
    try {
      return JSON.parse(localStorage.getItem('encre-web-etageres') ?? '[]') as EtagereUtilisateur[];
    } catch {
      return [];
    }
  }

  private sauverEtageres(etageres: EtagereUtilisateur[]): void {
    try {
      localStorage.setItem('encre-web-etageres', JSON.stringify(etageres));
    } catch {
      /* ignore */
    }
  }

  private getLivresStockes(): LivreBiblio[] {
    try {
      const data = localStorage.getItem('encre-web-livres');
      if (data) {
        return (JSON.parse(data) as Partial<LivreBiblio>[]).map((livre) => ({
          ...livre,
          progress: livre.progress ?? 0,
          termine: livre.termine ?? false,
          derniereLecture: livre.derniereLecture ?? null,
        })) as LivreBiblio[];
      }
    } catch {
      /* ignore */
    }
    return LIVRES_DEMO_WEB;
  }

  private sauverLivres(liste: LivreBiblio[]) {
    try {
      localStorage.setItem('encre-web-livres', JSON.stringify(liste));
    } catch {
      /* ignore */
    }
  }

  async ouvrirLivre(): Promise<LivreOuvert | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.epub,application/epub+zip';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const data = await file.arrayBuffer();
        resolve({
          livreId: file.name.toLowerCase().replace(/\\/g, '/'),
          nomFichier: file.name,
          chemin: file.name,
          data,
        });
      };
      input.click();
    });
  }

  async chargerAnnotations(): Promise<Annotation[]> {
    return [];
  }

  async sauvegarderAnnotation(s: SauvegardeAnnotation): Promise<Annotation> {
    return {
      id: Date.now(),
      livreId: s.livreId,
      cfi: s.cfi,
      texteExtrait: s.texteExtrait,
      couleur: s.couleur,
      note: s.note,
      creeLe: new Date().toISOString(),
    };
  }

  async modifierNote(): Promise<void> {}
  async supprimerAnnotation(): Promise<void> {}
  async exporterNotes(): Promise<ResultatExport> {
    return { annule: true };
  }
  async chargerPosition(): Promise<PositionLivre | null> {
    return null;
  }
  async sauvegarderPosition(livreId: string, cfi: string): Promise<PositionLivre> {
    return { livreId, cfi, majLe: new Date().toISOString() };
  }

  async listerLivres(): Promise<LivreBiblio[]> {
    return this.getLivresStockes();
  }

  async importerLivre(n: NouveauLivre): Promise<LivreBiblio> {
    const nouveau: LivreBiblio = {
      id: n.chemin.toLowerCase().replace(/\\/g, '/'),
      chemin: n.chemin,
      titre: n.titre,
      auteur: n.auteur,
      couverture: n.couverture,
      ajouteLe: new Date().toISOString(),
      progress: 0,
      termine: false,
      derniereLecture: null,
      existe: true,
    };
    const liste = this.getLivresStockes();
    const ancien = liste.find((livre) => livre.id === nouveau.id);
    if (ancien) {
      nouveau.progress = ancien.progress;
      nouveau.termine = ancien.termine;
      nouveau.derniereLecture = ancien.derniereLecture;
    }
    const filtre = liste.filter((l) => l.id !== nouveau.id);
    filtre.unshift(nouveau);
    this.sauverLivres(filtre);
    return nouveau;
  }

  async ouvrirLivreDepuisId(): Promise<LivreOuvert | null> {
    return null;
  }

  async supprimerLivre(id: string): Promise<void> {
    const liste = this.getLivresStockes().filter((l) => l.id !== id);
    this.sauverLivres(liste);
    this.sauverAssociations(this.getAssociations().filter((association) => association.livreId !== id));
  }

  async listerEtageres(): Promise<EtagereUtilisateur[]> {
    return this.getEtageres();
  }

  async creerEtagere(nom: string): Promise<EtagereUtilisateur> {
    const propre = nom.trim();
    if (!propre) throw new Error('Le nom de la catégorie est obligatoire.');
    const existante = this.getEtageres().find((etagere) => etagere.nom.toLocaleLowerCase() === propre.toLocaleLowerCase());
    if (existante) return existante;
    const etagere = { id: Date.now(), nom: propre, creeLe: new Date().toISOString() };
    this.sauverEtageres([...this.getEtageres(), etagere]);
    return etagere;
  }

  async supprimerEtagere(id: number): Promise<void> {
    this.sauverEtageres(this.getEtageres().filter((etagere) => etagere.id !== id));
    this.sauverAssociations(this.getAssociations().filter((association) => association.etagereId !== id));
  }

  async associerLivreEtagere(livreId: string, etagereId: number, associer: boolean): Promise<void> {
    const associations = this.getAssociations().filter(
      (association) => association.livreId !== livreId || association.etagereId !== etagereId,
    );
    if (associer) associations.push({ livreId, etagereId });
    this.sauverAssociations(associations);
  }

  async etageresDuLivre(livreId: string): Promise<number[]> {
    return this.getAssociations().filter((association) => association.livreId === livreId).map((association) => association.etagereId);
  }

  async modifierStatutLivre(id: string, statut: StatutLivre): Promise<void> {
    this.sauverLivres(this.getLivresStockes().map((livre) => {
      if (livre.id !== id) return livre;
      return statut === 'termine'
        ? { ...livre, termine: true }
        : { ...livre, progress: 0, termine: false };
    }));
  }

  // Pas d'Electron en prévisualisation web : pas de tirage (carte « Se relire » masquée).
  async auHasardNotes(): Promise<NoteAuHasard | null> {
    return null;
  }

  // Pas d'Electron en prévisualisation web : pas d'horloge (la mesure vit dans le main seul).
  signalerEtatLecture(): void {
    /* ignore */
  }

  async tempsAujourdHui(): Promise<TempsLectureJour> {
    const d = new Date();
    const jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { jour, secondes: 0, atteint: false };
  }

  surMajTemps(): () => void {
    return () => {};
  }

  // Pas d'Electron en prévisualisation web : objectif journalier local seulement.
  async fixerObjectif(minutes: number): Promise<number> {
    return Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 15;
  }

  async objectifJour(): Promise<number> {
    return 15;
  }

  // Pas d'Electron en prévisualisation web : 365 jours glissants vides.
  async tempsHistorique(): Promise<JourAtteinte[]> {
    const jours: JourAtteinte[] = [];
    const base = new Date();
    for (let delta = -364; delta <= 0; delta += 1) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
      jours.push({
        jour: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        atteint: false,
      });
    }
    return jours;
  }

  // Pas d'Electron en prévisualisation web : objectif annuel local seulement.
  async fixerObjectifAnnee(nombre: number): Promise<number> {
    if (!Number.isFinite(nombre)) return 3;
    return Math.min(50, Math.max(1, Math.floor(nombre)));
  }

  async anneeStats(): Promise<ObjectifAnneeStats> {
    return { annee: String(new Date().getFullYear()), termines: 0, objectif: 3 };
  }

  // Pas d'Electron en prévisualisation web : squelette 365 jours à zéro.
  async statsLecture(): Promise<StatsLecture> {
    const jours: JourStatsLecture[] = [];
    const base = new Date();
    for (let delta = -364; delta <= 0; delta += 1) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
      const jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      jours.push({ jour, minutes: 0, atteint: false });
    }
    return {
      jours,
      serieActuelle: 0,
      serieRecord: 0,
      tempsAnneeSec: 0,
      joursActifsAnnee: 0,
      livresTerminesAnnee: 0,
      totalLivresTermines: 0,
      membreDepuis: null,
    };
  }
}

const fallback = new FallbackWebClient();

export function obtenirApi(): ApiLecteur {
  if (typeof window !== 'undefined' && window.api) {
    return window.api;
  }
  return fallback;
}
