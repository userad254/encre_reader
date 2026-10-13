import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EtagereUtilisateur, LivreBiblio, LivreOuvert, NoteAuHasard, ObjectifAnneeStats, StatutLivre } from '../shared/types';
import { obtenirApi } from './apiClient';
import { initialesProfil, lireNomProfil } from './Profil';
import logoUrl from './assets/logo.png';

export const APP_NAME = 'Encre';

// T7b : objectif journalier (presets minutes). localStorage = source du choix
// utilisateur ; null = jamais fixé → widget "Objectifs" cliquable.
const CLE_OBJECTIF_JOUR = 'encre-objectif-jour';
const PRESETS_OBJECTIF = [5, 10, 15, 20, 30, 45, 60];

function lireObjectifLocal(): number | null {
  try {
    const brut = localStorage.getItem(CLE_OBJECTIF_JOUR);
    if (!brut) return null;
    const n = Math.floor(Number(brut));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// T7c : objectif annuel (stepper 1-50). Toujours défini : défaut 3.
const CLE_OBJECTIF_ANNEE = 'encre-objectif-annee';
const OBJECTIF_ANNEE_DEFAUT = 3;
const OBJECTIF_ANNEE_MIN = 1;
const OBJECTIF_ANNEE_MAX = 50;

function lireObjectifAnneeLocal(): number {
  try {
    const brut = localStorage.getItem(CLE_OBJECTIF_ANNEE);
    if (brut) {
      const n = Math.floor(Number(brut));
      if (Number.isFinite(n)) return Math.min(OBJECTIF_ANNEE_MAX, Math.max(OBJECTIF_ANNEE_MIN, n));
    }
  } catch {
    /* ignore */
  }
  return OBJECTIF_ANNEE_DEFAUT;
}

// T4f "Se relire" : ids déjà montrés (anti-répétition immédiate), cap 10.
const CLE_NOTES_RECENTES = 'encre-notes-recentes';
const MAX_NOTES_RECENTES = 10;

function lireNotesRecentes(): number[] {
  try {
    const brut = localStorage.getItem(CLE_NOTES_RECENTES);
    if (!brut) return [];
    const lus = JSON.parse(brut) as unknown;
    if (!Array.isArray(lus)) return [];
    return lus.filter((n): n is number => Number.isInteger(n));
  } catch {
    return [];
  }
}

function memoriserNoteMontree(id: number): number[] {
  const sansDoublon = [id, ...lireNotesRecentes().filter((n) => n !== id)].slice(0, MAX_NOTES_RECENTES);
  try {
    localStorage.setItem(CLE_NOTES_RECENTES, JSON.stringify(sansDoublon));
  } catch {
    /* ignore */
  }
  return sansDoublon;
}

interface PropsBiblio {
  surOuvrirLivre(choix: LivreOuvert, cfiCible?: string, reprendreDepuisDebut?: boolean): void;
  theme?: 'clair' | 'sombre';
  surBasculerTheme?: () => void;
  surOuvrirProfil(): void; // T8b : entrée profil en pied de sidebar → vue pleine
}

type ModePickerCategories =
  | { type: 'livre'; livreId: string }
  | { type: 'etagere'; etagereId: number }
  | { type: 'creer' };

function PickerCategories({
  livres,
  modeInitial,
  surFermer,
  surEtageresChangees,
}: {
  livres: LivreBiblio[];
  modeInitial: ModePickerCategories;
  surFermer: () => void;
  surEtageresChangees: () => Promise<void>;
}) {
  const api = obtenirApi();
  const [mode, setMode] = useState(modeInitial);
  const [etageres, setEtageres] = useState<EtagereUtilisateur[]>([]);
  const [categoriesCochees, setCategoriesCochees] = useState<Set<number>>(new Set());
  const [livresCoches, setLivresCoches] = useState<Set<string>>(new Set());
  const [nomNouveau, setNomNouveau] = useState('');
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let actif = true;
    void (async () => {
      try {
        const liste = await api.listerEtageres();
        if (actif) setEtageres(liste);
        if (mode.type === 'livre') {
          const ids = await api.etageresDuLivre(mode.livreId);
          if (actif) setCategoriesCochees(new Set(ids));
        } else if (mode.type === 'etagere') {
          const associations = await Promise.all(livres.map(async (livre) => ({
            id: livre.id,
            ids: await api.etageresDuLivre(livre.id),
          })));
          if (actif) {
            setLivresCoches(new Set(associations.filter((item) => item.ids.includes(mode.etagereId)).map((item) => item.id)));
          }
        }
      } catch (cause) {
        if (actif) setErreur(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { actif = false; };
  }, [mode, livres]);

  async function basculerEtagere(etagereId: number, coche: boolean): Promise<void> {
    if (mode.type !== 'livre') return;
    await api.associerLivreEtagere(mode.livreId, etagereId, coche);
    setCategoriesCochees((precedent) => {
      const suivant = new Set(precedent);
      if (coche) suivant.add(etagereId);
      else suivant.delete(etagereId);
      return suivant;
    });
    await surEtageresChangees();
  }

  async function basculerLivre(livreId: string, coche: boolean): Promise<void> {
    if (mode.type !== 'etagere') return;
    await api.associerLivreEtagere(livreId, mode.etagereId, coche);
    setLivresCoches((precedent) => {
      const suivant = new Set(precedent);
      if (coche) suivant.add(livreId);
      else suivant.delete(livreId);
      return suivant;
    });
    await surEtageresChangees();
  }

  async function creerNouvelleEtagere(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const nom = nomNouveau.trim();
    if (!nom) return;
    try {
      const nouvelle = await api.creerEtagere(nom);
      const liste = await api.listerEtageres();
      setEtageres(liste);
      setNomNouveau('');
      setErreur('');
      if (mode.type === 'livre') {
        await api.associerLivreEtagere(mode.livreId, nouvelle.id, true);
        setCategoriesCochees((precedent) => new Set(precedent).add(nouvelle.id));
      } else {
        setMode({ type: 'etagere', etagereId: nouvelle.id });
        setLivresCoches(new Set());
      }
      await surEtageresChangees();
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const livreCible = mode.type === 'livre' ? livres.find((livre) => livre.id === mode.livreId) : null;
  const etagereCible = mode.type === 'etagere' ? etageres.find((etagere) => etagere.id === mode.etagereId) : null;

  return createPortal(
    <div className="encre-picker-fond" onMouseDown={(e) => { if (e.target === e.currentTarget) surFermer(); }}>
      <section className="encre-picker-carte" role="dialog" aria-modal="true" aria-labelledby="encre-picker-titre">
        <header className="encre-picker-entete">
          <h2 id="encre-picker-titre">
            {mode.type === 'livre' ? `Catégories de ${livreCible?.titre ?? 'ce livre'}` :
              mode.type === 'etagere' ? `Livres de ${etagereCible?.nom ?? 'la catégorie'}` : 'Mes catégories'}
          </h2>
          <button type="button" className="encre-picker-fermer" onClick={surFermer} title="Fermer" aria-label="Fermer">×</button>
        </header>

        {mode.type === 'livre' ? (
          <div className="encre-picker-liste" role="group" aria-label="Catégories du livre">
            {etageres.length === 0 ? <p className="encre-picker-vide">Aucune catégorie pour l'instant</p> : null}
            {etageres.map((etagere) => (
              <label className="encre-picker-option" key={etagere.id}>
                <input type="checkbox" checked={categoriesCochees.has(etagere.id)} onChange={(e) => void basculerEtagere(etagere.id, e.target.checked)} />
                <span>{etagere.nom}</span>
              </label>
            ))}
          </div>
        ) : mode.type === 'etagere' ? (
          <div className="encre-picker-liste" role="group" aria-label={`Livres de ${etagereCible?.nom ?? 'la catégorie'}`}>
            {livres.map((livre) => (
              <label className="encre-picker-option" key={livre.id}>
                <input type="checkbox" checked={livresCoches.has(livre.id)} onChange={(e) => void basculerLivre(livre.id, e.target.checked)} />
                <span>{livre.titre}</span>
                <small>{livre.auteur ?? 'Auteur inconnu'}</small>
              </label>
            ))}
            {livres.length === 0 ? <p className="encre-picker-vide">Aucun livre dans la bibliothèque</p> : null}
          </div>
        ) : (
          <div className="encre-picker-liste" role="group" aria-label="Catégories existantes">
            {etageres.map((etagere) => (
              <div className="encre-picker-option" key={etagere.id}>
                <span>{etagere.nom}</span>
                <button type="button" onClick={() => setMode({ type: 'etagere', etagereId: etagere.id })}>Choisir</button>
              </div>
            ))}
            {etageres.length === 0 ? <p className="encre-picker-vide">Aucune catégorie pour l'instant</p> : null}
          </div>
        )}

        <form className="encre-picker-creer" onSubmit={(e) => void creerNouvelleEtagere(e)}>
          <input
            type="text"
            value={nomNouveau}
            onChange={(e) => setNomNouveau(e.target.value)}
            placeholder="Nouvelle catégorie"
            aria-label="Nouvelle catégorie"
            maxLength={80}
          />
          <button type="submit" disabled={!nomNouveau.trim()}>Créer</button>
        </form>
        {erreur ? <p className="encre-picker-erreur" role="alert">{erreur}</p> : null}
      </section>
    </div>,
    document.body,
  );
}

function texteMeta(valeur: unknown, repli: string): string {
  if (typeof valeur === 'string' && valeur.trim()) return valeur.trim();
  if (valeur && typeof valeur === 'object') {
    const premier = Object.values(valeur as Record<string, unknown>).find(
      (v) => typeof v === 'string' && (v as string).trim(),
    );
    if (typeof premier === 'string') return premier.trim();
  }
  return repli;
}

function useBlobUrl(buffer: ArrayBuffer | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!buffer) {
      setUrl(null);
      return;
    }
    const blob = new Blob([buffer]);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [buffer]);

  return url;
}

/**
 * Composant Livre 3D posé sur étagère (comme sur les images de référence)
 */
function LivreEtagere({
  livre,
  orphelin,
  afficherProgression = false,
  onOuvrir,
  onSupprimer,
  onModifierStatut,
  onOuvrirPicker,
}: {
  livre: LivreBiblio;
  orphelin: boolean;
  afficherProgression?: boolean;
  onOuvrir: (reprendreDepuisDebut?: boolean) => void;
  onSupprimer: (e: React.MouseEvent) => void;
  onModifierStatut: (statut: StatutLivre) => Promise<void>;
  onOuvrirPicker: () => void;
}) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const url = useBlobUrl(livre.couverture);
  const initiale = (livre.titre.trim().charAt(0) || 'E').toUpperCase();

  // Palette de teintes d'art pour les reliures sans couverture
  const teintes = [
    'linear-gradient(145deg, #2b3a4a, #1a2430)',
    'linear-gradient(145deg, #5c3a21, #3d2412)',
    'linear-gradient(145deg, #2d4a3e, #1c3027)',
    'linear-gradient(145deg, #4a2b3d, #2f1826)',
    'linear-gradient(145deg, #3a3b40, #222326)',
  ];
  const teinteIndex = Math.abs(livre.titre.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % teintes.length;

  async function marquerALire(): Promise<void> {
    await onModifierStatut('a-lire');
    setMenuOuvert(false);
    if (livre.termine) onOuvrir(true);
  }

  return (
    <div className={`encre-item-livre ${orphelin ? 'orphelin' : ''}`}>
      <button
        type="button"
        className="encre-livre-bouton"
        onClick={() => onOuvrir()}
        title={orphelin ? 'Fichier introuvable — cliquer pour relocaliser' : `Lire « ${livre.titre} »`}
      >
        <div className="encre-livre-corps">
          {/* Tranche / reliure gauche avec reflet de pliure */}
          <div className="encre-reliure-gauche" />

          {/* Couverture du livre */}
          <div className="encre-couverture-cadre">
            {url ? (
              <img src={url} alt={livre.titre} className="encre-couverture-image" />
            ) : (
              <div className="encre-couverture-art" style={{ background: teintes[teinteIndex] }}>
                <span className="encre-lettrine-art">{initiale}</span>
                <div className="encre-titre-art">{livre.titre}</div>
                <div className="encre-auteur-art">{livre.auteur ?? 'Édition Encre'}</div>
              </div>
            )}
            {/* Lustre & reflet satiné */}
            <div className="encre-vernis-reflet" />
          </div>

          {/* Ombre de contact au pied du livre sur l'étagère */}
          <div className="encre-ombre-contact" />
        </div>
      </button>

      {afficherProgression && (
        <div className="encre-progression-livre" aria-label={`Progression : ${Math.round(Math.max(0, Math.min(1, livre.progress)) * 100)} %`}>
          <span style={{ width: `${Math.max(0, Math.min(1, livre.progress)) * 100}%` }} />
        </div>
      )}

      {/* Métadonnées épurées sous le livre */}
      <div className="encre-livre-infos">
        <div className="encre-livre-titre-texte" title={livre.titre}>
          {livre.titre}
        </div>
        <div className="encre-livre-auteur-texte" title={livre.auteur ?? 'Auteur inconnu'}>
          {livre.auteur ?? 'Auteur inconnu'}
        </div>
        {orphelin && <span className="encre-badge-relocaliser">Relocaliser</span>}
      </div>

      <div className="encre-livre-menu-ancre">
        <button
          type="button"
          className="encre-livre-menu-toggle"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const largeurMenu = Math.min(204, window.innerWidth - 16);
            const gauche = Math.max(8, Math.min(rect.right - largeurMenu, window.innerWidth - largeurMenu - 8));
            const haut = rect.bottom + 4 + 152 <= window.innerHeight
              ? rect.bottom + 4
              : Math.max(8, rect.top - 156);
            setMenuPosition({ top: haut, left: gauche });
            setMenuOuvert((ouvert) => !ouvert);
          }}
          title="Actions du livre"
          aria-label={`Actions pour ${livre.titre}`}
          aria-haspopup="menu"
          aria-expanded={menuOuvert}
        >
          ⋯
        </button>
        {menuOuvert && (
          createPortal(
            <div className="encre-livre-menu encre-livre-menu-categories" style={menuPosition} role="menu" aria-label={`Actions pour ${livre.titre}`}>
              <button type="button" role="menuitem" onClick={() => { onModifierStatut('termine'); setMenuOuvert(false); }}>
                Marquer terminé
              </button>
              <button type="button" role="menuitem" onClick={() => void marquerALire()}>
                {livre.termine ? 'Relire depuis le début' : 'Marquer à lire'}
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOuvert(false); onOuvrirPicker(); }}>
                Ajouter à une catégorie
              </button>
              <button type="button" role="menuitem" className="encre-livre-menu-supprimer" onClick={onSupprimer}>
                Retirer de la bibliothèque
              </button>
            </div>,
            document.body,
          )
        )}
      </div>
    </div>
  );
}

/**
 * Une Étagère d'art complète avec sa tablette 3D en bois sablé/ivoire
 */
function EtagereRang({
  titre,
  livres,
  orphelins,
  afficherProgression = false,
  onOuvrir,
  onSupprimer,
  onModifierStatut,
  onOuvrirPicker,
  surVoirTout,
}: {
  titre: string;
  livres: LivreBiblio[];
  orphelins: Set<string>;
  afficherProgression?: boolean;
  onOuvrir: (id: string, orphelin: boolean, reprendreDepuisDebut?: boolean) => void;
  onSupprimer: (e: React.MouseEvent, id: string, titre: string) => void;
  onModifierStatut: (id: string, statut: StatutLivre) => Promise<void>;
  onOuvrirPicker: (livreId: string) => void;
  surVoirTout: () => void;
}) {
  const livresVisibles = livres.slice(0, 6);

  return (
    <div className="encre-etagere-bloc">
      <div className="encre-etagere-header">
        <h3 className="encre-etagere-titre-section">{titre}</h3>
        <button type="button" className="encre-etagere-lien-tout" onClick={surVoirTout}>
          Toute l’étagère →
        </button>
      </div>

      <div className="encre-etagere-scene">
        {/* Rangée de livres reposant sur la tablette */}
        <div className={`encre-etagere-livres ${livres.length === 0 ? 'vide' : ''}`}>
          {livres.length === 0 && <div className="encre-etagere-vide">Aucun livre pour l'instant</div>}
          {livresVisibles.map((livre) => {
            const orphelin = orphelins.has(livre.id) || !livre.existe;
            return (
              <LivreEtagere
                key={livre.id}
                livre={livre}
                orphelin={orphelin}
                afficherProgression={afficherProgression}
                onOuvrir={(reprendreDepuisDebut) => onOuvrir(livre.id, orphelin, reprendreDepuisDebut)}
                onSupprimer={(e) => onSupprimer(e, livre.id, livre.titre)}
                onModifierStatut={(statut) => onModifierStatut(livre.id, statut)}
                onOuvrirPicker={() => onOuvrirPicker(livre.id)}
              />
            );
          })}
        </div>

        {/* Tablette architecturale en biseau 3D */}
        <div className="encre-tablette-3d">
          <div className="encre-tablette-face-superieure" />
          <div className="encre-tablette-biseau-lumineux" />
          <div className="encre-tablette-ombre-portee" />
        </div>
      </div>
    </div>
  );
}

/**
 * Carte "Se relire" (T4f) : une note du corpus tirée au hasard, porte vers le livre.
 * Tirage au montage (ouverture app + retour bibliothèque). Masquée si vide.
 */
function CarteSeRelire({ surOuvrirPassage }: { surOuvrirPassage: (note: NoteAuHasard) => void }) {
  const api = obtenirApi();
  const [note, setNote] = useState<NoteAuHasard | null>(null);
  const [exclusions, setExclusions] = useState<number[]>(() => lireNotesRecentes());

  async function tirer(avecExclusions: number[]): Promise<void> {
    try {
      const tiree = await api.auHasardNotes(avecExclusions);
      if (!tiree) return; // Vide ou tout vu : on garde la carte courante (ou rien au 1er tirage)
      setNote(tiree);
      setExclusions(memoriserNoteMontree(tiree.id));
    } catch {
      /* ignore : la carte reste masquée ou inchangée, bibliothèque intacte */
    }
  }

  useEffect(() => {
    void tirer(lireNotesRecentes());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!note) return null;

  const citation = note.note?.trim() || note.texteExtrait;

  return (
    <section className="encre-relire-epigraphe" aria-label="Note du jour">
      <div className="encre-relire-contenu">
        <span className="encre-relire-label">Note du jour</span>
        <button
          type="button"
          className="encre-relire-citation-bouton"
          onClick={() => surOuvrirPassage(note)}
          title="Ouvrir le passage"
          aria-label="Ouvrir le passage"
        >
          <span className="encre-relire-extrait">« {citation} »</span>
        </button>
        <div className="encre-relire-source" title={`${note.livreTitre} — ${note.livreAuteur}`}>
          {note.livreTitre} — {note.livreAuteur}
        </div>
      </div>
      <div className="encre-relire-actions">
        <button
          type="button"
          className="encre-relire-action"
          onClick={() => surOuvrirPassage(note)}
          title="Ouvrir le passage"
          aria-label="Ouvrir le passage"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 12h15M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="encre-relire-action"
          onClick={() => void tirer(exclusions)}
          title="Une autre"
          aria-label="Une autre"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5.6 9a7 7 0 0 1 11.8-2L20 9M4 15l2.6 2a7 7 0 0 0 11.8-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </section>
  );
}

export function Bibliotheque({ surOuvrirLivre, theme = 'clair', surBasculerTheme, surOuvrirProfil }: PropsBiblio) {
  const api = obtenirApi();

  const [livres, setLivres] = useState<LivreBiblio[]>([]);
  const [orphelins, setOrphelins] = useState<Set<string>>(new Set());
  const [statut, setStatut] = useState('');
  const [recherche, setRecherche] = useState('');
  const [ongletActif, setOngletActif] = useState<'etagères' | 'tous' | 'categorie'>('etagères');
  const [enGlissement, setEnGlissement] = useState(false);
  const [etageresUtilisateur, setEtageresUtilisateur] = useState<EtagereUtilisateur[]>([]);
  const [categorieActiveId, setCategorieActiveId] = useState<number | null>(null);
  const [livresParEtagere, setLivresParEtagere] = useState<Map<number, Set<string>>>(new Map());
  const [filtreSysteme, setFiltreSysteme] = useState<'enCours' | 'aLire' | 'termines' | null>(null);
  const [modePicker, setModePicker] = useState<ModePickerCategories | null>(null);
  const [dernierLivreId, setDernierLivreId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('encre-dernier-livre-id');
    } catch {
      return null;
    }
  });

  // T7b : widget objectif journalier (aucune horloge locale : tout vient du main).
  const [objectifFixe, setObjectifFixe] = useState<number | null>(() => lireObjectifLocal());
  const [secondesJour, setSecondesJour] = useState(0);
  const [streak, setStreak] = useState(0);
  const [popoverObjectifsOuvert, setPopoverObjectifsOuvert] = useState(false);
  const popoverObjectifsRef = useRef<HTMLDivElement | null>(null);
  // T7c : ligne annuelle du widget (toujours définie, défaut 3).
  const [objectifAnnee, setObjectifAnnee] = useState(() => lireObjectifAnneeLocal());
  const [statsAnnee, setStatsAnnee] = useState<ObjectifAnneeStats | null>(null);
  // T8b : nom du profil (relit localStorage à chaque montage de la vue).
  const [nomProfil] = useState(() => lireNomProfil());

  async function charger(): Promise<void> {
    try {
      const liste = await api.listerLivres();
      setLivres(liste);
      setStatut('');
    } catch (err: unknown) {
      setStatut(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function chargerEtageresUtilisateur(): Promise<void> {
    try {
      setEtageresUtilisateur(await api.listerEtageres());
    } catch (err: unknown) {
      setStatut(`Erreur catégories : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function chargerAssociationsEtageres(): Promise<void> {
    try {
      const associations = await Promise.all(livres.map(async (livre) => ({
        livreId: livre.id,
        categories: await api.etageresDuLivre(livre.id),
      })));
      const parEtagere = new Map<number, Set<string>>();
      for (const etagere of etageresUtilisateur) parEtagere.set(etagere.id, new Set());
      for (const association of associations) {
        for (const etagereId of association.categories) parEtagere.get(etagereId)?.add(association.livreId);
      }
      setLivresParEtagere(parEtagere);
    } catch (err: unknown) {
      setStatut(`Erreur catégories : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  useEffect(() => {
    void charger();
    void chargerEtageresUtilisateur();
  }, []);

  // T7b : au montage, pousse le choix local au main (si jamais fixé), confirme
  // l'objectif + le total persisté (relance), puis suit temps:maj en temps réel.
  // Pas de timer local : blur = pause côté main.
  // T7c : pousse aussi l'objectif annuel (toujours défini, défaut 3) et charge
  // les stats annuelles (relance stable via termine_le SQLite).
  // T8b : le streak vient de stats:lecture (serieActuelle, divergence résolue).
  useEffect(() => {
    let actif = true;
    void (async () => {
      try {
        const local = lireObjectifLocal();
        if (local !== null) await api.fixerObjectif(local);
        await api.fixerObjectifAnnee(lireObjectifAnneeLocal());
        const [confirme, t, stats, annuelles] = await Promise.all([
          api.objectifJour(),
          api.tempsAujourdHui(),
          api.statsLecture(),
          api.anneeStats(),
        ]);
        if (!actif) return;
        if (local !== null && Number.isFinite(confirme) && confirme > 0) {
          setObjectifFixe(Math.floor(confirme));
        }
        setSecondesJour(t.secondes);
        setStreak(stats.serieActuelle);
        setStatsAnnee(annuelles);
        if (Number.isFinite(annuelles.objectif) && annuelles.objectif > 0) {
          setObjectifAnnee(Math.min(OBJECTIF_ANNEE_MAX, Math.max(OBJECTIF_ANNEE_MIN, Math.floor(annuelles.objectif))));
        }
      } catch {
        /* ignore : le widget garde ses valeurs locales */
      }
    })();
    const desabonner = api.surMajTemps((t) => {
      setSecondesJour(t.secondes);
      void api.statsLecture().then((s) => setStreak(s.serieActuelle)).catch(() => {});
    });
    return () => {
      actif = false;
      desabonner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // T7b : le popover se ferme au clic extérieur.
  useEffect(() => {
    if (!popoverObjectifsOuvert) return;
    const fermer = (e: MouseEvent) => {
      if (popoverObjectifsRef.current && !popoverObjectifsRef.current.contains(e.target as Node)) {
        setPopoverObjectifsOuvert(false);
      }
    };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, [popoverObjectifsOuvert]);

  async function choisirObjectif(minutes: number): Promise<void> {
    setObjectifFixe(minutes);
    try {
      localStorage.setItem(CLE_OBJECTIF_JOUR, String(minutes));
    } catch {
      /* ignore */
    }
    try {
      const confirme = await api.fixerObjectif(minutes);
      if (Number.isFinite(confirme) && confirme > 0) setObjectifFixe(Math.floor(confirme));
    } catch {
      /* ignore : le widget garde le choix local */
    }
  }

  // T7c : relit { annee, termines, objectif } (montage + après changement de statut).
  async function rafraichirAnnee(): Promise<void> {
    try {
      setStatsAnnee(await api.anneeStats());
    } catch {
      /* ignore : la ligne annuelle garde ses valeurs */
    }
  }

  // T7c : stepper annuel 1-50 → localStorage + push main + refetch stats.
  async function choisirObjectifAnnee(delta: -1 | 1): Promise<void> {
    const suivant = Math.min(OBJECTIF_ANNEE_MAX, Math.max(OBJECTIF_ANNEE_MIN, objectifAnnee + delta));
    setObjectifAnnee(suivant);
    try {
      localStorage.setItem(CLE_OBJECTIF_ANNEE, String(suivant));
    } catch {
      /* ignore */
    }
    try {
      await api.fixerObjectifAnnee(suivant);
    } catch {
      /* ignore : le widget garde le choix local */
    }
    await rafraichirAnnee();
  }

  useEffect(() => {
    void chargerAssociationsEtageres();
  }, [livres, etageresUtilisateur]);

  async function importer(): Promise<void> {
    const choix = await api.ouvrirLivre();
    if (!choix) return;

    try {
      setStatut(`Lecture de ${choix.nomFichier}…`);
      const blob = new Blob([choix.data], { type: 'application/epub+zip' });
      const fichier = new File([blob], choix.nomFichier, { type: 'application/epub+zip' });
      const { makeBook } = (await import('foliate-js/view.js')) as {
        makeBook: (f: File) => Promise<{
          metadata?: { title?: unknown; author?: { name?: unknown }[] | { name?: unknown } };
          getCover?: () => Promise<Blob | null>;
        }>;
      };
      const livre = await makeBook(fichier);
      const meta = livre.metadata ?? {};
      const titre = texteMeta(meta.title, choix.nomFichier);
      const brutAuteur = Array.isArray(meta.author) ? meta.author[0]?.name : meta.author?.name;
      const auteurTexte = texteMeta(brutAuteur, '');
      const couv = (await livre.getCover?.()) ?? null;
      const couverture = couv ? await couv.arrayBuffer() : null;

      const nouveau = await api.importerLivre({
        chemin: choix.chemin,
        titre,
        auteur: auteurTexte ? auteurTexte : null,
        couverture,
      });

      try {
        localStorage.setItem('encre-dernier-livre-id', nouveau.id);
        setDernierLivreId(nouveau.id);
      } catch {
        /* ignore */
      }

      await charger();
    } catch (err: unknown) {
      setStatut(`Erreur à l'import : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function ouvrir(id: string, orphelin: boolean, reprendreDepuisDebut = false): Promise<void> {
    if (orphelin) {
      await importer();
      return;
    }
    try {
      const choix = await api.ouvrirLivreDepuisId(id);
      if (!choix) {
        setOrphelins((p) => new Set(p).add(id));
        setStatut('Fichier introuvable sur le disque. Veuillez le relocaliser.');
        return;
      }
      try {
        localStorage.setItem('encre-dernier-livre-id', id);
        setDernierLivreId(id);
      } catch {
        /* ignore */
      }
      surOuvrirLivre(choix, undefined, reprendreDepuisDebut);
    } catch (err: unknown) {
      setStatut(`Erreur d'ouverture : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // T4f : même flux que ouvrir(), mais le CFI de la note prime sur la position
  // sauvegardée pour cette ouverture (priorité gérée côté Lecteur via cfiCible).
  async function ouvrirPassage(note: NoteAuHasard): Promise<void> {
    try {
      const choix = await api.ouvrirLivreDepuisId(note.livreId);
      if (!choix) {
        setOrphelins((p) => new Set(p).add(note.livreId));
        setStatut('Fichier introuvable sur le disque. Veuillez le relocaliser.');
        return;
      }
      try {
        localStorage.setItem('encre-dernier-livre-id', note.livreId);
        setDernierLivreId(note.livreId);
      } catch {
        /* ignore */
      }
      surOuvrirLivre(choix, note.cfi);
    } catch (err: unknown) {
      setStatut(`Erreur d'ouverture : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function supprimer(e: React.MouseEvent, id: string, titre: string): Promise<void> {
    e.stopPropagation();
    if (!window.confirm(`Retirer « ${titre} » de votre bibliothèque ? Vos notes resteront conservées.`)) return;
    await api.supprimerLivre(id);
    if (dernierLivreId === id) {
      try {
        localStorage.removeItem('encre-dernier-livre-id');
        setDernierLivreId(null);
      } catch {
        /* ignore */
      }
    }
    await charger();
  }

  async function modifierStatut(id: string, statutLivre: StatutLivre): Promise<void> {
    await api.modifierStatutLivre(id, statutLivre);
    await charger();
    await rafraichirAnnee(); // T7c : la ligne annuelle suit immédiatement (termine_le daté/annulé)
  }

  async function supprimerCategorie(etagere: EtagereUtilisateur): Promise<void> {
    if (!window.confirm(`Supprimer la catégorie « ${etagere.nom} » ? Les livres resteront dans la bibliothèque.`)) return;
    await api.supprimerEtagere(etagere.id);
    if (categorieActiveId === etagere.id) {
      setCategorieActiveId(null);
      setOngletActif('etagères');
    }
    await chargerEtageresUtilisateur();
  }

  function ouvrirCategorie(etagereId: number): void {
    setCategorieActiveId(etagereId);
    setFiltreSysteme(null);
    setOngletActif('categorie');
  }

  function voirTouteEtagereSysteme(filtre: 'enCours' | 'aLire' | 'termines'): void {
    setFiltreSysteme(filtre);
    setCategorieActiveId(null);
    setOngletActif('tous');
  }

  async function fermerPickerCategories(): Promise<void> {
    setModePicker(null);
    await chargerEtageresUtilisateur();
    await chargerAssociationsEtageres();
  }

  const livresFiltres = useMemo(() => {
    if (!recherche.trim()) return livres;
    const q = recherche.toLowerCase();
    return livres.filter((l) => l.titre.toLowerCase().includes(q) || (l.auteur && l.auteur.toLowerCase().includes(q)));
  }, [livres, recherche]);

  const dernierLivre = useMemo(() => {
    if (livres.length === 0) return null;
    if (dernierLivreId) {
      const trouve = livres.find((l) => l.id === dernierLivreId);
      if (trouve) return trouve;
    }
    return livres[0];
  }, [livres, dernierLivreId]);

  const dernierLivreCouvUrl = useBlobUrl(dernierLivre?.couverture ?? null);
  const livresDeLaCategorie = useMemo(() => {
    const ids = categorieActiveId === null ? undefined : livresParEtagere.get(categorieActiveId);
    return ids ? livresFiltres.filter((livre) => ids.has(livre.id)) : [];
  }, [livresFiltres, livresParEtagere, categorieActiveId]);
  const categorieActive = etageresUtilisateur.find((etagere) => etagere.id === categorieActiveId) ?? null;

  const { enCours, aLire, termines } = useMemo(() => {
    const enCours = livresFiltres
      .filter((livre) => livre.progress >= 0.01 && !livre.termine)
      .sort((a, b) => (b.derniereLecture ?? '').localeCompare(a.derniereLecture ?? ''));
    return {
      enCours,
      aLire: livresFiltres.filter((livre) => livre.progress < 0.01 && !livre.termine),
      termines: livresFiltres.filter((livre) => livre.termine),
    };
  }, [livresFiltres]);

  const livresVueComplete = ongletActif === 'categorie'
    ? livresDeLaCategorie
    : filtreSysteme === 'enCours'
      ? enCours
      : filtreSysteme === 'aLire'
        ? aLire
        : filtreSysteme === 'termines'
          ? termines
          : livresFiltres;
  const etageresRemplies = etageresUtilisateur
    .filter((etagere) => (livresParEtagere.get(etagere.id)?.size ?? 0) > 0)
    .sort((a, b) => (a.creeLe ?? '').localeCompare(b.creeLe ?? '') || a.id - b.id);

  return (
    <div
      className={`encre-app-wrapper ${enGlissement ? 'drag-actif' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setEnGlissement(true);
      }}
      onDragLeave={() => setEnGlissement(false)}
      onDrop={(e) => {
        e.preventDefault();
        setEnGlissement(false);
        void importer();
      }}
    >
      {/* CADRE / TABLETTE EN RELIEF (Style Readowl / Sanctuary) */}
      <div className="encre-sanctuaire-panneau">
        {/* 1. SIDEBAR FEUTRÉE (À GAUCHE) */}
        <aside className="encre-sanctuaire-sidebar">
          <div className="encre-sidebar-haut">
            {/* Logo Readowl-like avec chouette/plume & typographie noble */}
            <div className="encre-logo-entete">
              <div className="encre-logo-icone">
                <img src={logoUrl} width={30} height={30} alt="" />
              </div>
              <span className="encre-logo-titre">{APP_NAME}</span>
            </div>

            {/* Navigation principale */}
            <nav className="encre-menu-nav">
              <button
                type="button"
                className={`encre-menu-bouton ${ongletActif === 'etagères' ? 'actif' : ''}`}
                onClick={() => setOngletActif('etagères')}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
                  <path d="M6 6v12M18 6v12" strokeLinecap="round" opacity="0.3" />
                </svg>
                <span>Mes Étagères</span>
              </button>

              <button
                type="button"
                className={`encre-menu-bouton ${ongletActif === 'tous' ? 'actif' : ''}`}
                onClick={() => setOngletActif('tous')}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
                <span>Tous les livres</span>
                {livres.length > 0 && <span className="encre-compte-bulle">{livres.length}</span>}
              </button>

            </nav>

            <section className="encre-sidebar-categories" aria-label="Mes catégories">
              <div className="encre-sidebar-categories-entete">
                <span>Mes catégories</span>
                <button
                  type="button"
                  className="encre-sidebar-categorie-creer"
                  onClick={() => setModePicker({ type: 'creer' })}
                  title="Créer une catégorie"
                  aria-label="Créer une catégorie"
                >
                  + Catégorie
                </button>
              </div>
              <div className="encre-sidebar-categories-liste">
                {etageresUtilisateur.map((etagere) => (
                  <div className={`encre-sidebar-categorie ${ongletActif === 'categorie' && categorieActiveId === etagere.id ? 'actif' : ''}`} key={etagere.id}>
                    <button type="button" className="encre-sidebar-categorie-nom" onClick={() => ouvrirCategorie(etagere.id)} title={etagere.nom}>
                      <span>{etagere.nom}</span>
                    </button>
                    <button
                      type="button"
                      className="encre-sidebar-categorie-action"
                      onClick={() => setModePicker({ type: 'etagere', etagereId: etagere.id })}
                      title={`Ajouter ou retirer des livres de ${etagere.nom}`}
                      aria-label={`Modifier les livres de ${etagere.nom}`}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="encre-sidebar-categorie-action supprimer"
                      onClick={() => void supprimerCategorie(etagere)}
                      title={`Supprimer ${etagere.nom}`}
                      aria-label={`Supprimer ${etagere.nom}`}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                ))}
                {etageresUtilisateur.length === 0 && <span className="encre-sidebar-categories-vide">Aucune catégorie</span>}
              </div>
            </section>
          </div>

          <div className="encre-sidebar-spacer" />

          {/* Bas de sidebar : Carte "Continuer la lecture" (comme Readowl) */}
          <div className="encre-sidebar-bas">
            {dernierLivre && (
              <div
                className="encre-carte-continuer"
                onClick={() => void ouvrir(dernierLivre.id, !dernierLivre.existe)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void ouvrir(dernierLivre.id, !dernierLivre.existe);
                }}
              >
                <div className="encre-continuer-label">Continuer la lecture</div>
                <div className="encre-continuer-livre">
                  <div className="encre-continuer-couv">
                    {dernierLivreCouvUrl ? (
                      <img src={dernierLivreCouvUrl} alt={dernierLivre.titre} />
                    ) : (
                      <div className="encre-continuer-sans-couv">
                        {(dernierLivre.titre.trim().charAt(0) || 'E').toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div
                    className="encre-continuer-barre-progression"
                    aria-label={`Progression : ${Math.round(Math.max(0, Math.min(1, dernierLivre.progress)) * 100)} %`}
                  >
                    <span style={{ width: `${Math.max(0, Math.min(1, dernierLivre.progress)) * 100}%` }} />
                  </div>
                </div>
              </div>
            )}

              {/* T8b : entrée profil (à la place de « Lecteur / Édition privée ») */}
            <div className="encre-lecteur-profil">
              <button
                type="button"
                className="encre-profil-entree"
                onClick={surOuvrirProfil}
                title="Voir mon profil de lecture"
              >
                <span className="encre-profil-avatar encre-profil-avatar-initiales" aria-hidden="true">
                  {initialesProfil(nomProfil)}
                </span>
                <span className="encre-profil-texte">
                  <span className="encre-profil-nom">{nomProfil || 'Lecteur'}</span>
                </span>
                <span className="encre-profil-chevron" aria-hidden="true">›</span>
              </button>
              {surBasculerTheme && (
                <button
                  type="button"
                  className="encre-theme-toggle-discret"
                  onClick={surBasculerTheme}
                  title={theme === 'sombre' ? 'Passer en mode Papier' : 'Passer en mode Encre'}
                >
                  {theme === 'sombre' ? '☀️' : '🌙'}
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* 2. ZONE PRINCIPALE DES ÉTAGÈRES (À DROITE) */}
        <main className="encre-sanctuaire-contenu">
          {/* Barre supérieure intégrée façon Readowl */}
          <header className="encre-barre-recherche-haut">
            {/* Filtres d'onglets pilule */}
            <div className="encre-onglets-pilule">
              <button
                type="button"
                className={`encre-pilule-btn ${ongletActif === 'etagères' ? 'actif' : ''}`}
                onClick={() => setOngletActif('etagères')}
              >
                Étagères
              </button>
              <button
                type="button"
                className={`encre-pilule-btn ${ongletActif === 'tous' ? 'actif' : ''}`}
                onClick={() => setOngletActif('tous')}
              >
                Tous les livres
              </button>
            </div>

            {/* Champ de recherche avec loupe */}
            <div className="encre-champ-loupe">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Rechercher dans ma bibliothèque..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              {recherche && (
                <button type="button" className="encre-clear-btn" onClick={() => setRecherche('')}>
                  ×
                </button>
              )}
            </div>

            {/* Bouton d'importation discret */}
            <button type="button" className="encre-btn-ajouter-livre" onClick={() => void importer()}>
              <span>+ Ajouter</span>
            </button>

            {/* T8c : chip objectifs en en-tête (coup d'œil, popover ré-ancrée dessous) */}
            <div ref={popoverObjectifsRef} className="encre-chip-objectifs-ancre">
              <button
                type="button"
                className="encre-chip-objectifs"
                onClick={() => setPopoverObjectifsOuvert((o) => !o)}
                title={
                  objectifFixe !== null
                    ? `Objectif du jour : ${Math.min(objectifFixe, Math.floor(secondesJour / 60))}/${objectifFixe} min · série ${streak} j${statsAnnee ? ` · Objectif ${statsAnnee.annee} : ${statsAnnee.termines}/${statsAnnee.objectif} livres` : ''}`
                    : 'Définir un objectif de lecture'
                }
                aria-label="Objectifs de lecture"
                aria-expanded={popoverObjectifsOuvert}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="encre-objectifs-anneau">
                  <circle cx="8" cy="8" r="6.5" fill="none" strokeWidth="2" className="encre-anneau-fond" />
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    fill="none"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="encre-anneau-progres"
                    strokeDasharray={2 * Math.PI * 6.5}
                    strokeDashoffset={2 * Math.PI * 6.5 * (1 - (objectifFixe !== null && objectifFixe > 0 ? Math.min(1, secondesJour / (objectifFixe * 60)) : 0))}
                  />
                </svg>
                {objectifFixe !== null ? (
                  <>
                    <span className="encre-chip-objectifs-minutes">
                      {Math.min(objectifFixe, Math.floor(secondesJour / 60))}/{objectifFixe} min
                    </span>
                    <span className="encre-chip-objectifs-serie">· {streak} j</span>
                    {statsAnnee && (
                      <>
                        <span className="encre-chip-objectifs-sep" aria-hidden="true" />
                        <span className="encre-chip-objectifs-livres">
                          {statsAnnee.termines}/{statsAnnee.objectif}
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="encre-chip-objectifs-minutes">Objectifs</span>
                )}
              </button>
              {popoverObjectifsOuvert && (
                <div className="encre-popover-objectifs encre-popover-objectifs-entete" role="dialog" aria-label="Objectifs de lecture">
                  <span className="encre-label-reglage">Objectif du jour</span>
                  <div className="encre-segments encre-objectifs-presets">
                    {PRESETS_OBJECTIF.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`encre-segment-bouton ${objectifFixe === m ? 'encre-segment-actif' : ''}`}
                        onClick={() => void choisirObjectif(m)}
                        title={`${m} minutes par jour`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {/* T7c : stepper annuel 1-50 */}
                  <span className="encre-label-reglage">Objectif de l’année</span>
                  <div className="encre-stepper-annee">
                    <button
                      type="button"
                      className="encre-stepper-bouton"
                      onClick={() => void choisirObjectifAnnee(-1)}
                      disabled={objectifAnnee <= OBJECTIF_ANNEE_MIN}
                      title="Diminuer l'objectif annuel"
                      aria-label="Diminuer l'objectif annuel"
                    >
                      −
                    </button>
                    <span className="encre-stepper-valeur" aria-live="polite">
                      {objectifAnnee}
                    </span>
                    <button
                      type="button"
                      className="encre-stepper-bouton"
                      onClick={() => void choisirObjectifAnnee(1)}
                      disabled={objectifAnnee >= OBJECTIF_ANNEE_MAX}
                      title="Augmenter l'objectif annuel"
                      aria-label="Augmenter l'objectif annuel"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>
          </header>

          {statut ? <div className="encre-statut-toast">{statut}</div> : null}

          <CarteSeRelire surOuvrirPassage={(note) => void ouvrirPassage(note)} />

          {/* SCROLL DES ÉTAGÈRES */}
          <div className="encre-scroll-rayonnages">
            {livres.length === 0 && (
              /* ÉCRAN D'ACCUEIL AVEC ÉTAGÈRE CENTRALE */
              <div className="encre-accueil-vide">
                <div className="encre-drop-socle">
                  <div className="encre-drop-icone-chouette">
                    <svg viewBox="0 0 32 32" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="11" cy="14" r="5" />
                      <circle cx="21" cy="14" r="5" />
                      <path d="M16 13v2" strokeLinecap="round" />
                      <path d="M6 14c-1-3 1-7 5-8 3 0 5 2 5 2s2-2 5-2c4 1 6 5 5 8" strokeLinecap="round" />
                      <path d="M11 19c2 2 8 2 10 0" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h3 className="encre-drop-titre">Votre bibliothèque est prête</h3>
                  <p className="encre-drop-desc">
                    Glissez vos livres au format <strong>.epub</strong> ici pour les ajouter à votre bibliothèque.
                  </p>
                </div>

                {/* Tablette d'étagère socle sous la dropzone */}
                <div className="encre-tablette-3d" style={{ maxWidth: 480, margin: '0 auto' }}>
                  <div className="encre-tablette-face-superieure" />
                  <div className="encre-tablette-biseau-lumineux" />
                  <div className="encre-tablette-ombre-portee" />
                </div>
              </div>
            )}
            {ongletActif === 'etagères' ? (
              /* 1. DISPOSITION SUR ÉTAGÈRES (IMAGE 1) */
              <div className="encre-ensemble-etageres">
                <EtagereRang
                  titre="En cours de lecture"
                  livres={enCours}
                  orphelins={orphelins}
                  afficherProgression
                  onOuvrir={ouvrir}
                  onSupprimer={supprimer}
                  onModifierStatut={modifierStatut}
                  onOuvrirPicker={(livreId) => setModePicker({ type: 'livre', livreId })}
                  surVoirTout={() => voirTouteEtagereSysteme('enCours')}
                />

                <EtagereRang
                  titre="À lire ensuite"
                  livres={aLire}
                  orphelins={orphelins}
                  onOuvrir={ouvrir}
                  onSupprimer={supprimer}
                  onModifierStatut={modifierStatut}
                  onOuvrirPicker={(livreId) => setModePicker({ type: 'livre', livreId })}
                  surVoirTout={() => voirTouteEtagereSysteme('aLire')}
                />

                <EtagereRang
                  titre="Terminés"
                  livres={termines}
                  orphelins={orphelins}
                  onOuvrir={ouvrir}
                  onSupprimer={supprimer}
                  onModifierStatut={modifierStatut}
                  onOuvrirPicker={(livreId) => setModePicker({ type: 'livre', livreId })}
                  surVoirTout={() => voirTouteEtagereSysteme('termines')}
                />

                {etageresRemplies.map((etagere) => {
                  const ids = livresParEtagere.get(etagere.id) ?? new Set<string>();
                  const livresCategorie = livresFiltres.filter((livre) => ids.has(livre.id));
                  return (
                    <EtagereRang
                      key={etagere.id}
                      titre={etagere.nom}
                      livres={livresCategorie}
                      orphelins={orphelins}
                      onOuvrir={ouvrir}
                      onSupprimer={supprimer}
                      onModifierStatut={modifierStatut}
                      onOuvrirPicker={(livreId) => setModePicker({ type: 'livre', livreId })}
                      surVoirTout={() => ouvrirCategorie(etagere.id)}
                    />
                  );
                })}

                {livresFiltres.length === 0 && (
                  <div className="encre-recherche-vide">
                    Aucun livre ne correspond à « {recherche} ».
                  </div>
                )}
              </div>
            ) : livres.length > 0 ? (
              /* Grille complète (bibliothèque ou catégorie sélectionnée) */
              <div className="encre-galerie-cimaises">
                {livresVueComplete.map((livre) => {
                  const orphelin = orphelins.has(livre.id) || !livre.existe;
                  return (
                    <div key={livre.id} className="encre-cimaise-item">
                      <LivreEtagere
                        livre={livre}
                        orphelin={orphelin}
                        onOuvrir={(reprendreDepuisDebut) => void ouvrir(livre.id, orphelin, reprendreDepuisDebut)}
                        onSupprimer={(e) => void supprimer(e, livre.id, livre.titre)}
                        onModifierStatut={(statut) => modifierStatut(livre.id, statut)}
                        onOuvrirPicker={() => setModePicker({ type: 'livre', livreId: livre.id })}
                      />
                      <div className="encre-tablette-fine" />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </main>
      </div>
      {modePicker && (
        <PickerCategories
          livres={livres}
          modeInitial={modePicker}
          surFermer={() => void fermerPickerCategories()}
          surEtageresChangees={chargerEtageresUtilisateur}
        />
      )}
    </div>
  );
}
