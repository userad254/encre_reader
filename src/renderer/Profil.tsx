import { useEffect, useRef, useState } from 'react';
import type { JourStatsLecture, StatsLecture } from '../shared/types';
import { obtenirApi } from './apiClient';

// T8b : vue profil (pleine vue, pas de popover). Nom local, heatmap 12 mois
// glissants, 4 chips depuis stats:lecture. Pas de métrique pages.

const CLE_NOM_PROFIL = 'encre-nom-profil';

export function lireNomProfil(): string {
  try {
    return localStorage.getItem(CLE_NOM_PROFIL) ?? '';
  } catch {
    return '';
  }
}

// Initiales serif (2 max) déduites du nom, « E » si vide.
export function initialesProfil(nom: string): string {
  const parties = nom.trim().split(/\s+/).filter(Boolean);
  if (parties.length === 0) return 'E';
  const lettres = parties.slice(0, 2).map((p) => (p[0] ?? '').toUpperCase());
  return lettres.join('') || 'E';
}

// « 2024-05-01 » → « mai 2024 » (sous-ligne « Lecteur depuis … »).
function moisAnnee(jourIso: string): string {
  const [a, m] = jourIso.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
    new Date(a, (m || 1) - 1, 1),
  );
}

// 84600s → « 23 h 30 », 2400s → « 40 min ».
function formaterTempsAnnee(secondes: number): string {
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const COLONNES = 53;

// Rampe ocre : 0 / 1-14 / 15-29 / 30-59 / 60+ min.
function niveauCellule(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

function dateDuJour(jour: string): Date {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, (m || 1) - 1, j || 1);
}

// « 24 min · mar. 3 oct. »
function texteTooltip(cellule: JourStatsLecture): string {
  const d = dateDuJour(cellule.jour);
  return `${cellule.minutes} min · ${JOURS_COURTS[d.getDay()]} ${d.getDate()} ${MOIS_COURTS[d.getMonth()]}`;
}

interface Cellule {
  cle: string;
  donnees: JourStatsLecture | null;
}

// 365 jours → 53×7 cases : colonnes = semaines (lundi en haut), cases vides
// avant le premier jour pour caler le lundi, bourrage après si besoin.
function disposerCellules(jours: JourStatsLecture[]): Cellule[] {
  const decalage = (dateDuJour(jours[0].jour).getDay() + 6) % 7;
  const cellules: Cellule[] = [];
  for (let i = 0; i < decalage; i += 1) cellules.push({ cle: `vide-avant-${i}`, donnees: null });
  for (const j of jours) cellules.push({ cle: j.jour, donnees: j });
  let k = 0;
  while (cellules.length < COLONNES * 7) {
    cellules.push({ cle: `vide-apres-${k}`, donnees: null });
    k += 1;
  }
  return cellules;
}

// Labels mois : un par mois présent, centré au milieu de son étendue.
function etiquettesMois(jours: JourStatsLecture[], decalage: number): Map<number, string> {
  const etendues = new Map<string, { min: number; max: number; mois: number }>();
  jours.forEach((j, i) => {
    const col = Math.floor((decalage + i) / 7);
    const cle = j.jour.slice(0, 7);
    const d = dateDuJour(j.jour);
    const e = etendues.get(cle);
    if (e) {
      e.min = Math.min(e.min, col);
      e.max = Math.max(e.max, col);
    } else {
      etendues.set(cle, { min: col, max: col, mois: d.getMonth() });
    }
  });
  const placees = new Map<number, string>();
  for (const e of etendues.values()) {
    let col = Math.floor((e.min + e.max) / 2);
    while (placees.has(col) && col <= e.max) col += 1; // Collision : décale à droite
    if (col < COLONNES && !placees.has(col)) placees.set(col, MOIS_COURTS[e.mois]);
  }
  return placees;
}

export function Profil({ surRetour }: { surRetour: () => void }) {
  const api = obtenirApi();
  const [stats, setStats] = useState<StatsLecture | null>(null);
  const [objectifAnnee, setObjectifAnnee] = useState<number | null>(null);
  const [nom, setNom] = useState(() => lireNomProfil());
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState('');
  const annulationRef = useRef(false);

  useEffect(() => {
    let actif = true;
    void api.statsLecture().then((s) => {
      if (actif) setStats(s);
    }).catch(() => {});
    // L'objectif vit en mémoire main (poussé au montage bibliothèque, toujours
    // visitée avant le profil dans le flux de l'app).
    void api.anneeStats().then((a) => {
      if (actif && Number.isFinite(a.objectif) && a.objectif > 0) setObjectifAnnee(Math.floor(a.objectif));
    }).catch(() => {});
    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ouvrirEdition(): void {
    annulationRef.current = false;
    setBrouillon(nom);
    setEdition(true);
  }

  function sauverNom(): void {
    const propre = brouillon.trim();
    try {
      localStorage.setItem(CLE_NOM_PROFIL, propre);
    } catch {
      /* ignore */
    }
    setNom(propre);
    setEdition(false);
  }

  function annulerEdition(): void {
    annulationRef.current = true;
    setEdition(false);
  }

  const cellules = stats ? disposerCellules(stats.jours) : [];
  const decalage = stats ? (dateDuJour(stats.jours[0].jour).getDay() + 6) % 7 : 0;
  const mois = stats ? etiquettesMois(stats.jours, decalage) : new Map<number, string>();

  return (
    <div className="encre-app-wrapper">
      <div className="encre-sanctuaire-panneau">
        <main className="encre-profil-contenu">
          <button type="button" className="encre-profil-retour" onClick={surRetour} title="Retourner à la bibliothèque">
            ← Bibliothèque
          </button>

          <header className="encre-profil-entete">
            <span className="encre-profil-avatar-grand" aria-hidden="true">
              {initialesProfil(nom)}
            </span>
            <div className="encre-profil-identite">
              {edition ? (
                <input
                  className="encre-profil-nom-input"
                  value={brouillon}
                  onChange={(e) => setBrouillon(e.target.value)}
                  onBlur={() => {
                    if (!annulationRef.current) sauverNom();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sauverNom();
                    else if (e.key === 'Escape') {
                      e.preventDefault();
                      annulerEdition();
                    }
                  }}
                  maxLength={40}
                  autoFocus
                  aria-label="Nom du profil"
                />
              ) : (
                <button
                  type="button"
                  className="encre-profil-nom-grand"
                  onDoubleClick={ouvrirEdition}
                  title="Double-cliquer pour modifier le nom"
                >
                  {nom || 'Lecteur'}
                </button>
              )}
              {stats?.membreDepuis && (
                <div className="encre-profil-depuis">Lecteur depuis {moisAnnee(stats.membreDepuis)}</div>
              )}
            </div>
          </header>

          {stats && (
            <>
              <section className="encre-profil-section" aria-label="Activité de lecture">
                <div className="encre-heat-scroll">
                  <div className="encre-heat-table">
                    <div className="encre-heat-jours" aria-hidden="true">
                      {['Lun', '', 'Mer', '', 'Ven', '', ''].map((j, i) => (
                        <span key={i}>{j}</span>
                      ))}
                    </div>
                    <div className="encre-heat-corps">
                      <div className="encre-heat-mois" aria-hidden="true">
                        {Array.from({ length: COLONNES }, (_, col) => (
                          <span key={col}>{mois.get(col) ?? ''}</span>
                        ))}
                      </div>
                      <div className="encre-heat-grille">
                        {cellules.map((c) => (
                          <span key={c.cle} className={`encre-heat-cellule n${c.donnees ? niveauCellule(c.donnees.minutes) : 0}`}>
                            {c.donnees && <span className="encre-heat-tip">{texteTooltip(c.donnees)}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="encre-chips">
                <div className="encre-chip">
                  <span className="encre-chip-titre">Série</span>
                  <span className="encre-chip-valeur">{stats.serieActuelle} j</span>
                  <span className="encre-chip-sous">record : {stats.serieRecord} j</span>
                </div>
                <div className="encre-chip">
                  <span className="encre-chip-titre">Temps cette année</span>
                  <span className="encre-chip-valeur">{formaterTempsAnnee(stats.tempsAnneeSec)}</span>
                </div>
                <div className="encre-chip">
                  <span className="encre-chip-titre">Livres terminés</span>
                  <span className="encre-chip-valeur">{stats.livresTerminesAnnee}</span>
                  {objectifAnnee !== null && <span className="encre-chip-sous">/ {objectifAnnee}</span>}
                </div>
                <div className="encre-chip">
                  <span className="encre-chip-titre">Jours actifs</span>
                  <span className="encre-chip-valeur">{stats.joursActifsAnnee}</span>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
