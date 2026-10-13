import { useEffect, useRef, useState } from 'react';
import type { Annotation, LivreOuvert } from '../shared/types';

export interface DemandeOuverture extends LivreOuvert {
  nonce: number;
  cfiCible?: string; // CFI de la note « Se relire », prioritaire sur la position pour cette ouverture
  reprendreDepuisDebut?: boolean;
}

export type Theme = 'clair' | 'sombre';

interface PropsLecteur {
  ouvertureDemandee?: DemandeOuverture | null;
  surRetourBiblio?: () => void;
  themeInitial?: Theme;
  surChangerTheme?: (t: Theme) => void;
}

const PALETTE_SURLIGNAGE = [
  { nom: 'Ambre solaire', val: '#f7d570' },
  { nom: 'Vert sauge', val: '#b0deb9' },
  { nom: 'Lavande', val: '#d3c7f3' },
  { nom: 'Pêche buvard', val: '#f7bdae' },
];

const COULEUR_DEFAUT = PALETTE_SURLIGNAGE[0].val;
const TAILLES_POLICE = [16, 20, 24];
const INTERLIGNES = [1.4, 1.7, 2.0];
export const CONFIG_LARGEURS = [
  { nom: 'Étroite', maxWidth: '48em', maxInlineSize: '650px', gap: '6%', margin: '48px' },
  { nom: 'Confort', maxWidth: '72em', maxInlineSize: '950px', gap: '5%', margin: '36px' },
  { nom: 'Pleine', maxWidth: '100%', maxInlineSize: '3000px', gap: '3%', margin: '20px' },
];

const CLE_REGLAGES = 'encre-reglages-lecture';

// Objectif journalier (minutes). Source = stockage local, confirmé via IPC.
const CLE_OBJECTIF_JOUR = 'encre-objectif-jour';
const OBJECTIF_DEFAUT = 15;

function lireObjectifLocal(): number {
  try {
    const brut = localStorage.getItem(CLE_OBJECTIF_JOUR);
    if (brut) {
      const n = Math.floor(Number(brut));
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* ignore */
  }
  return OBJECTIF_DEFAUT;
}

function lireReglages(): { interligne: number; largeur: number; colonnes: 1 | 2 } {
  const defaut = { interligne: 0, largeur: 2, colonnes: 2 as (1 | 2) }; // Défaut = 2 pages comme un vrai livre
  try {
    const brut = localStorage.getItem(CLE_REGLAGES);
    if (!brut) return defaut;
    const lu = JSON.parse(brut) as { i?: unknown; l?: unknown; c?: unknown };
    const interligne = typeof lu.i === 'number' && lu.i >= 0 && lu.i < INTERLIGNES.length ? lu.i : defaut.interligne;
    const largeur = typeof lu.l === 'number' && lu.l >= 0 && lu.l < CONFIG_LARGEURS.length ? lu.l : defaut.largeur;
    const colonnes = lu.c === 1 || lu.c === 2 ? lu.c : defaut.colonnes;
    return { interligne, largeur, colonnes };
  } catch {
    return defaut;
  }
}

interface ContenuSection {
  index: number;
  doc?: Document;
}

interface NoeudToc {
  label?: string;
  href?: string;
  subitems?: NoeudToc[];
}

interface EntreeToc {
  label: string;
  href: string;
  index: number;
}

interface VueFoliate extends HTMLElement {
  open(livre: unknown): Promise<void>;
  close(): void;
  goTo(cible: unknown): Promise<unknown>;
  prev(): Promise<void>;
  next(): Promise<void>;
  getCFI(index: number, range: Range): string;
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
  resolveNavigation(cible: unknown): { index: number; anchor?: unknown } | undefined;
  addAnnotation(a: { value: string }): Promise<unknown>;
  deleteAnnotation(a: { value: string }): Promise<unknown>;
  deselect(): void;
  renderer: {
    getContents(): ContenuSection[];
    setStyles(css: string): void;
    render(): void;
    setAttribute(nom: string, valeur: string): void;
  };
}

interface SelectionEnCours {
  index: number;
  range: Range;
  texte: string;
  x: number;
  y: number;
}

export function Lecteur({
  ouvertureDemandee,
  surRetourBiblio,
  themeInitial = 'clair',
  surChangerTheme,
}: PropsLecteur = {}) {
  const [moteurPret, setMoteurPret] = useState(false);
  const [livreId, setLivreId] = useState<string | null>(null);
  const [nomLivre, setNomLivre] = useState('');
  const [titreLivreAffiche, setTitreLivreAffiche] = useState('');
  const [statut, setStatut] = useState('');
  const [tailleIndex, setTailleIndex] = useState(0);
  const [theme, setTheme] = useState<Theme>(themeInitial);
  const [interligneIndex, setInterligneIndex] = useState(() => lireReglages().interligne);
  const [largeurIndex, setLargeurIndex] = useState(() => lireReglages().largeur);
  const [colonnes, setColonnes] = useState<1 | 2>(() => lireReglages().colonnes);
  const [tocVisible, setTocVisible] = useState<EntreeToc[]>([]);
  const [sommaireOuvert, setSommaireOuvert] = useState(false);
  const [notesOuvert, setNotesOuvert] = useState(false);
  const [menuApparenceOuvert, setMenuApparenceOuvert] = useState(false);
  const [hudForce, setHudForce] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Surlignage in-situ
  const [selectionActive, setSelectionActive] = useState<SelectionEnCours | null>(null);
  const [modeNoteRapide, setModeNoteRapide] = useState(false);
  const [noteRapideTexte, setNoteRapideTexte] = useState('');

  // Anneau d'objectif journalier dans le HUD (aucune horloge locale, tout vient du main).
  const [objectifMin, setObjectifMin] = useState(() => lireObjectifLocal());
  const [secondesJour, setSecondesJour] = useState(0);
  const [anneauMasque, setAnneauMasque] = useState(false);

  // Refs
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const vueRef = useRef<VueFoliate | null>(null);
  const moteurRef = useRef<{ makeBook: (f: File) => Promise<unknown> } | null>(null);
  const dessinRef = useRef<{ highlight: unknown } | null>(null);
  const annotationsRef = useRef<Annotation[]>([]);
  const livreIdRef = useRef<string | null>(null);
  const dernierePositionRef = useRef<string | null>(null);
  const derniereFractionRef = useRef(0);
  const timerPositionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const derniereSectionRef = useRef(0);
  const tocRef = useRef<EntreeToc[]>([]);
  const indexSectionRef = useRef(0);
  const dernierNonceRef = useRef(0);
  const timersNoteRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Style injecté dans le contenu du livre
  function styleContenu(taillePx: number, th: Theme, interligne: number): string {
    const sombre = th === 'sombre';
    const fond = sombre ? '#131210' : '#f7f4ee';
    const texte = sombre ? '#ece7dd' : '#1d1a16';
    const lien = sombre ? '#de994b' : '#b06720';
    return [
      `html { font-size: ${taillePx}px !important; background: ${fond} !important; }`,
      `body { background: ${fond} !important; color: ${texte} !important; font-family: "Source Serif 4", Georgia, serif !important; }`,
      'p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, section, article { background-color: transparent !important; }',
      ...(sombre
        ? []
        : [
            'body * { color: #1d1a16 !important; }',
            'body small, body small *, body aside, body aside *, body figcaption, body figcaption *, ' +
              'body cite, body cite *, body q, body q *, body blockquote, body blockquote *, ' +
              'body .footnote, body .footnote *, body .footnotes, body .footnotes *, ' +
              'body .note, body .note *, body .endnote, body .endnote *, ' +
              'body [role="doc-footnote"], body [role="doc-footnote"] *, ' +
              'body [role="doc-endnote"], body [role="doc-endnote"] * ' +
              '{ color: #686156 !important; }',
          ]),
      `body a, body a * { color: ${lien} !important; }`,
      `body, body * { line-height: ${interligne} !important; }`,
      'img, svg, video, image { filter: none !important; mix-blend-mode: normal !important; }',
      'img { width: 100% !important; }',
      'svg { max-width: 100% !important; height: auto !important; }',
      'figure, div:has(> img), p:has(> img) { width: 100% !important; max-width: 100% !important; }',
    ].join('\n');
  }

  function appliquerStyles(): void {
    const vue = vueRef.current;
    if (!vue?.renderer) return;
    vue.renderer.setStyles(styleContenu(TAILLES_POLICE[tailleIndex], theme, INTERLIGNES[interligneIndex]));
  }

  function trouverCouleur(cfi: string): string {
    const a = annotationsRef.current.find((x) => x.cfi === cfi);
    if (!a) return COULEUR_DEFAUT;
    if (a.couleur === 'yellow') return COULEUR_DEFAUT;
    return a.couleur;
  }

  function peindreAnnotation(e: Event): void {
    const detail = (e as CustomEvent).detail as {
      draw: (fn: unknown, opts: { color: string }) => void;
      annotation?: { value?: string };
    };
    detail.draw(dessinRef.current?.highlight, { color: trouverCouleur(detail.annotation?.value ?? '') });
  }

  async function rejouerAnnotations(): Promise<void> {
    const vue = vueRef.current;
    if (!vue?.renderer) return;
    const contenus = vue.renderer.getContents();
    for (const a of annotationsRef.current) {
      let index: number;
      try {
        index = vue.resolveCFI(a.cfi).index;
      } catch {
        continue;
      }
      if (!contenus.some((c) => c.index === index)) {
        continue;
      }
      try {
        await vue.addAnnotation({ value: a.cfi });
      } catch {
        /* ignore */
      }
    }
  }

  // Détection de sélection in-situ dans l'iframe
  function inspecterSelectionDoc(doc: Document, sectionIndex: number): void {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelectionActive(null);
      setModeNoteRapide(false);
      return;
    }
    const texte = sel.toString().trim();
    if (!texte) {
      setSelectionActive(null);
      setModeNoteRapide(false);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    const frameRect = frame ? frame.getBoundingClientRect() : { top: 0, left: 0 };

    const x = frameRect.left + rect.left + rect.width / 2;
    const y = frameRect.top + rect.top;

    setSelectionActive({
      index: sectionIndex,
      range: range.cloneRange(),
      texte,
      x,
      y,
    });
  }

  function attacherEcouteursSelection(): void {
    const vue = vueRef.current;
    if (!vue?.renderer) return;
    const contenus = vue.renderer.getContents();
    for (const c of contenus) {
      if (!c.doc) continue;
      const doc = c.doc;
      const idx = c.index;
      doc.onpointerup = () => inspecterSelectionDoc(doc, idx);
      doc.onkeyup = () => inspecterSelectionDoc(doc, idx);
      // Propager les touches clavier depuis l'iframe de foliate vers le gestionnaire
      // principal. Sans cela, dès que le focus entre dans l'iframe (au clic dans la zone
      // de lecture), ArrowLeft / ArrowRight / PageUp / PageDown / Escape sont absorbés
      // par l'iframe et ne remontent jamais au window du renderer React.
      doc.onkeydown = (e: KeyboardEvent) => gererToucheClavier(e);
    }
  }

  function surRelocate(e: Event): void {
    const detail = (e as CustomEvent).detail as { cfi?: string; fraction?: number } | undefined;
    const cfi = detail?.cfi;

    void rejouerAnnotations();
    attacherEcouteursSelection();
    setSelectionActive(null);
    setModeNoteRapide(false);

    if (!cfi || !livreIdRef.current) return;
    dernierePositionRef.current = cfi;
    if (typeof detail?.fraction === 'number' && Number.isFinite(detail.fraction)) {
      derniereFractionRef.current = Math.min(1, Math.max(0, detail.fraction));
    }

    if (timerPositionRef.current) clearTimeout(timerPositionRef.current);
    timerPositionRef.current = setTimeout(() => {
      const id = livreIdRef.current;
      const pos = dernierePositionRef.current;
      if (id && pos) {
        void window.api.sauvegarderPosition(id, pos, derniereFractionRef.current);
      }
    }, 500);

    const vue = vueRef.current;
    if (vue) {
      try {
        indexSectionRef.current = vue.resolveCFI(cfi).index;
      } catch {
        /* ignore */
      }
    }
  }

  // Initialisation du moteur foliate
  useEffect(() => {
    let mort = false;
    (async () => {
      const moteur = (await import('foliate-js/view.js')) as {
        makeBook: (f: File) => Promise<unknown>;
      };
      const { Overlayer } = (await import('foliate-js/overlayer.js')) as {
        Overlayer: { highlight: unknown };
      };
      if (mort) return;
      moteurRef.current = moteur;
      dessinRef.current = Overlayer;
      const vue = document.createElement('foliate-view') as VueFoliate;
      vue.style.width = '100%';
      vue.style.height = '100%';
      vue.style.display = 'block';
      vue.style.background = 'var(--encre-fond)';
      vueRef.current = vue;
      vue.addEventListener('draw-annotation', peindreAnnotation as EventListener);
      vue.addEventListener('relocate', surRelocate as EventListener);
      conteneurRef.current?.appendChild(vue);
      setMoteurPret(true);
    })().catch((err: unknown) => {
      setStatut(`Erreur moteur : ${err instanceof Error ? err.message : String(err)}`);
    });

    return () => {
      mort = true;
      try {
        vueRef.current?.close();
      } catch {
        /* ignore */
      }
      vueRef.current?.remove();
      vueRef.current = null;
    };
  }, []);

  // ResizeObserver pour re-pagination dynamique
  useEffect(() => {
    const conteneur = conteneurRef.current;
    if (!conteneur) return;
    const ro = new ResizeObserver(() => {
      const vue = vueRef.current;
      if (!vue?.renderer?.render) return;
      appliquerConfigDisposition(largeurIndex, colonnes);
    });
    ro.observe(conteneur);
    return () => ro.disconnect();
  }, [largeurIndex, colonnes]);

  // Signale la vue lecture au main (l'horloge compte quand la vue est montée + fenêtre au focus).
  // Montage = ouverture lecture, démontage = retour bibliothèque. Aucune UI ici.
  useEffect(() => {
    window.api.signalerEtatLecture(true);
    return () => {
      window.api.signalerEtatLecture(false);
    };
  }, []);

  // Initialise l'anneau depuis le main, puis suit les notifications en temps réel.
  // Pas de timer local : changer de fenêtre met en pause côté main, l'anneau ne bouge pas.
  useEffect(() => {
    let actif = true;
    void (async () => {
      try {
        const [obj, t] = await Promise.all([window.api.objectifJour(), window.api.tempsAujourdHui()]);
        if (!actif) return;
        if (Number.isFinite(obj) && obj > 0) setObjectifMin(Math.floor(obj));
        setSecondesJour(t.secondes);
      } catch {
        /* ignore : l'anneau garde le défaut local */
      }
    })();
    const desabonner = window.api.surMajTemps((t) => setSecondesJour(t.secondes));
    return () => {
      actif = false;
      desabonner();
    };
  }, []);

  // Après atteinte, l'anneau reste 1.5s (✓) puis se masque. Nouveau jour
  // (non atteint) = réapparition.
  const objectifSec = objectifMin * 60;
  const objectifAtteint = objectifSec > 0 && secondesJour >= objectifSec;
  useEffect(() => {
    if (!objectifAtteint) {
      setAnneauMasque(false);
      return;
    }
    const t = setTimeout(() => setAnneauMasque(true), 1500);
    return () => clearTimeout(t);
  }, [objectifAtteint]);

  // Sauvegarde position avant fermeture
  useEffect(() => {
    const sauverPositionImmediat = () => {
      const id = livreIdRef.current;
      const cfi = dernierePositionRef.current;
      if (id && cfi) void window.api.sauvegarderPosition(id, cfi, derniereFractionRef.current);
    };
    window.addEventListener('beforeunload', sauverPositionImmediat);
    return () => {
      window.removeEventListener('beforeunload', sauverPositionImmediat);
      if (timerPositionRef.current) clearTimeout(timerPositionRef.current);
      sauverPositionImmediat();
    };
  }, []);

  // Application des styles
  useEffect(() => {
    if (moteurPret) appliquerStyles();
  }, [tailleIndex, theme, interligneIndex, moteurPret]);

  // Fonction d'application de la disposition (1 page ou 2 pages / livre) au paginator Foliate
  function appliquerConfigDisposition(largeurIdx: number, nbColonnes: 1 | 2): void {
    const vue = vueRef.current;
    if (!vue?.renderer) return;
    const config = CONFIG_LARGEURS[largeurIdx] ?? CONFIG_LARGEURS[2];
    const conteneurWidth = conteneurRef.current?.clientWidth || window.innerWidth;

    try {
      if (nbColonnes === 2) {
        // Mode 2 pages : on alloue la moitié de la largeur à chaque page
        const demi = Math.max(300, Math.floor(conteneurWidth / 2) - 20);
        vue.renderer.setAttribute('max-column-count', '2');
        vue.renderer.setAttribute('max-inline-size', `${demi}px`);
        vue.renderer.setAttribute('gap', config.gap);
        vue.renderer.setAttribute('margin', config.margin);
      } else {
        // Mode 1 page : force une colonne unique
        vue.renderer.setAttribute('max-column-count', '1');
        vue.renderer.setAttribute('max-inline-size', `${conteneurWidth}px`);
        vue.renderer.setAttribute('gap', '0%');
        vue.renderer.setAttribute('margin', config.margin);
      }
      vue.renderer.render();
    } catch (err: unknown) {
      console.warn('[disposition] Erreur configuration foliate :', err);
    }
  }

  // Largeur de colonne et re-découpage dynamique
  useEffect(() => {
    if (!moteurPret) return;
    appliquerConfigDisposition(largeurIndex, colonnes);
  }, [largeurIndex, colonnes, moteurPret]);

  // Sauvegarde des réglages
  useEffect(() => {
    try {
      localStorage.setItem(
        CLE_REGLAGES,
        JSON.stringify({ i: interligneIndex, l: largeurIndex, c: colonnes }),
      );
    } catch {
      /* ignore */
    }
  }, [interligneIndex, largeurIndex, colonnes]);

  // Gestion du clavier
  useEffect(() => {
    window.addEventListener('keydown', gererToucheClavier);
    return () => window.removeEventListener('keydown', gererToucheClavier);
  }, []);

  // Ouverture demandée depuis la bibliothèque
  useEffect(() => {
    if (ouvertureDemandee && moteurPret && dernierNonceRef.current !== ouvertureDemandee.nonce) {
      dernierNonceRef.current = ouvertureDemandee.nonce;
      void chargerLivre(ouvertureDemandee);
    }
  }, [ouvertureDemandee, moteurPret]);

  async function ouvrirLivre(): Promise<void> {
    const choix = await window.api.ouvrirLivre();
    if (!choix) return;
    await chargerLivre(choix);
  }

  async function chargerLivre(choix: LivreOuvert): Promise<void> {
    const vue = vueRef.current;
    if (!vue || !moteurRef.current) return;
    // CFI imposé par « Se relire » (prioritaire sur la position, pour cette seule ouverture).
    const cfiImpose = (choix as DemandeOuverture).cfiCible;
    const reprendreDepuisDebut = (choix as DemandeOuverture).reprendreDepuisDebut ?? false;

    try {
      setStatut('Ouverture en cours…');
      const blob = new Blob([choix.data], { type: 'application/epub+zip' });
      const fichier = new File([blob], choix.nomFichier, { type: 'application/epub+zip' });
      const livre = (await moteurRef.current.makeBook(fichier)) as {
        toc?: NoeudToc[];
        sections?: unknown[];
        metadata?: { title?: string };
      };

      setNomLivre(choix.nomFichier);
      setTitreLivreAffiche(livre.metadata?.title || choix.nomFichier.replace(/\.epub$/i, ''));
      setLivreId(choix.livreId);
      livreIdRef.current = choix.livreId;

      await vue.open(livre);
      activerTransitionDouce();
      appliquerStyles();
      appliquerConfigDisposition(largeurIndex, colonnes);
      chargerTOC(livre);

      const pos = await window.api.chargerPosition(choix.livreId);
      derniereFractionRef.current = pos?.fraction ?? 0;
      console.log(`[progress] loaded fraction=${derniereFractionRef.current} ${choix.livreId.slice(-8)}`);
      // Le CFI de la note prime sur la position sauvegardée (cette ouverture
      // seulement ; la position SQLite n'est pas écrasée ici, le relocate la mettra à jour).
      const cible = cfiImpose ?? (reprendreDepuisDebut || pos?.termine ? undefined : pos?.cfi);
      if (cible) {
        try {
          await vue.goTo(cible);
        } catch {
          await vue.goTo(0);
        }
      } else {
        await vue.goTo(0);
      }

      const chargees = await window.api.chargerAnnotations(choix.livreId);
      annotationsRef.current = chargees;
      setAnnotations(chargees);
      await rejouerAnnotations();
      setStatut('');
    } catch (err: unknown) {
      setStatut(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Surlignage in-situ
  async function surlignerCouleur(couleurChoisie: string, noteTexte: string | null = null): Promise<void> {
    const vue = vueRef.current;
    const id = livreIdRef.current;
    if (!vue || !id || !selectionActive) return;

    try {
      const cfi = vue.getCFI(selectionActive.index, selectionActive.range);
      vue.resolveCFI(cfi);
      const sauvee = await window.api.sauvegarderAnnotation({
        livreId: id,
        cfi,
        texteExtrait: selectionActive.texte,
        couleur: couleurChoisie,
        note: noteTexte?.trim() ? noteTexte.trim() : null,
      });
      annotationsRef.current = [...annotationsRef.current, sauvee];
      setAnnotations(annotationsRef.current);
      await vue.addAnnotation({ value: cfi });

      vue.deselect();
      setSelectionActive(null);
      setModeNoteRapide(false);
      setNoteRapideTexte('');
    } catch (err: unknown) {
      console.error('[surlignerCouleur] Erreur :', err);
    }
  }

  async function copierSelection(): Promise<void> {
    if (!selectionActive?.texte) return;
    await navigator.clipboard.writeText(selectionActive.texte);
    vueRef.current?.deselect();
    setSelectionActive(null);
  }

  async function tournerPage(sens: -1 | 1): Promise<void> {
    const vue = vueRef.current;
    if (!vue) return;
    try {
      if (sens < 0) await vue.prev();
      else await vue.next();
    } catch {
      /* ignore */
    }
  }

  async function allerDebut(): Promise<void> {
    const vue = vueRef.current;
    if (!vue || !livreIdRef.current) return;
    await vue.goTo(0);
  }

  async function allerFin(): Promise<void> {
    const vue = vueRef.current;
    if (!vue || !livreIdRef.current) return;
    await vue.goTo(derniereSectionRef.current);
  }

  function activerTransitionDouce(): void {
    const vue = vueRef.current;
    if (!vue?.renderer) return;
    vue.renderer.setAttribute('animated', '');
  }

  function gererToucheClavier(e: KeyboardEvent): void {
    const cible = e.target as HTMLElement | null;
    if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setMenuApparenceOuvert(false);
      setSommaireOuvert(false);
      setNotesOuvert(false);
      setSelectionActive(null);
      setHudForce((h) => !h);
      return;
    }

    if (!livreIdRef.current) return;
    const chapitre = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (chapitre) void allerChapitre(-1);
        else void tournerPage(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (chapitre) void allerChapitre(1);
        else void tournerPage(1);
        break;
      case 'PageDown':
        e.preventDefault();
        void tournerPage(1);
        break;
      case 'PageUp':
        e.preventDefault();
        void tournerPage(-1);
        break;
      case 'Home':
        e.preventDefault();
        void allerDebut();
        break;
      case 'End':
        e.preventDefault();
        void allerFin();
        break;
      default:
        break;
    }
  }

  function chargerTOC(livre: { toc?: NoeudToc[]; sections?: unknown[] }): void {
    const sections = livre.sections ?? [];
    derniereSectionRef.current = Math.max(0, sections.length - 1);
    const vue = vueRef.current;
    if (!vue || !livre.toc) {
      tocRef.current = [];
      setTocVisible([]);
      return;
    }
    const brut: { label: string; href: string }[] = [];
    function parcourir(noeuds: NoeudToc[]): void {
      for (const n of noeuds) {
        if (n.label && n.href) brut.push({ label: n.label.trim(), href: n.href });
        if (n.subitems && n.subitems.length > 0) parcourir(n.subitems);
      }
    }
    parcourir(livre.toc);

    const resolus: EntreeToc[] = [];
    for (const b of brut) {
      try {
        const res = vue.resolveNavigation(b.href);
        if (res && typeof res.index === 'number') {
          resolus.push({ label: b.label, href: b.href, index: res.index });
        }
      } catch {
        /* ignore */
      }
    }
    tocRef.current = resolus;
    setTocVisible(resolus);
  }

  async function allerChapitre(direction: -1 | 1): Promise<void> {
    const vue = vueRef.current;
    const toc = tocRef.current;
    if (!vue || toc.length === 0) return;
    const courant = indexSectionRef.current;
    let cible: EntreeToc | undefined;
    if (direction > 0) {
      cible = toc.find((e) => e.index > courant);
    } else {
      const precedents = toc.filter((e) => e.index < courant);
      cible = precedents[precedents.length - 1];
    }
    if (cible) await vue.goTo(cible.href);
  }

  async function allerEntree(entree: EntreeToc): Promise<void> {
    const vue = vueRef.current;
    if (!vue) return;
    await vue.goTo(entree.href);
    setSommaireOuvert(false);
  }

  function grouperParChapitre(): { cle: string; titre: string; items: Annotation[] }[] {
    const vue = vueRef.current;
    const toc = tocRef.current;
    if (!vue) return [];

    interface AnnAvecIndex {
      annotation: Annotation;
      index: number;
    }
    const valides: AnnAvecIndex[] = [];
    for (const a of annotationsRef.current) {
      try {
        const index = vue.resolveCFI(a.cfi).index;
        valides.push({ annotation: a, index });
      } catch {
        /* ignore */
      }
    }
    valides.sort((a, b) => a.index - b.index);

    const groupes = new Map<string, { cle: string; titre: string; items: Annotation[] }>();
    for (const item of valides) {
      let chapTitre = 'Sans chapitre';
      let chapIndex = -1;
      for (let i = toc.length - 1; i >= 0; i--) {
        if (toc[i].index <= item.index) {
          chapTitre = toc[i].label;
          chapIndex = toc[i].index;
          break;
        }
      }
      const cle = `${chapIndex}-${chapTitre}`;
      const existant = groupes.get(cle);
      if (existant) {
        existant.items.push(item.annotation);
      } else {
        groupes.set(cle, { cle, titre: chapTitre, items: [item.annotation] });
      }
    }
    return [...groupes.values()];
  }

  function majNoteLocale(id: number, note: string | null): void {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
    annotationsRef.current = annotationsRef.current.map((a) => (a.id === id ? { ...a, note } : a));
  }

  async function sauverNote(id: number): Promise<void> {
    const a = annotationsRef.current.find((x) => x.id === id);
    if (!a) return;
    const propre = a.note?.trim() ? a.note : null;
    if (propre !== a.note) majNoteLocale(id, propre);
    try {
      await window.api.modifierNote(id, propre);
    } catch {
      /* ignore */
    }
  }

  function editerNote(id: number, texte: string): void {
    majNoteLocale(id, texte);
    const ancien = timersNoteRef.current.get(id);
    if (ancien) clearTimeout(ancien);
    timersNoteRef.current.set(
      id,
      setTimeout(() => {
        timersNoteRef.current.delete(id);
        void sauverNote(id);
      }, 600),
    );
  }

  function sauverNoteMaintenant(id: number): void {
    const t = timersNoteRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersNoteRef.current.delete(id);
    }
    void sauverNote(id);
  }

  function sauverNotesEnAttente(): void {
    for (const [id, t] of timersNoteRef.current) {
      clearTimeout(t);
      timersNoteRef.current.delete(id);
      void sauverNote(id);
    }
  }

  async function allerPassage(cfi: string): Promise<void> {
    const vue = vueRef.current;
    if (!vue || !livreIdRef.current) return;
    await vue.goTo(cfi);
  }

  async function supprimerAnnotation(id: number): Promise<void> {
    const cible = annotationsRef.current.find((a) => a.id === id);
    const t = timersNoteRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersNoteRef.current.delete(id);
    }
    try {
      await window.api.supprimerAnnotation(id);
    } catch {
      return;
    }
    annotationsRef.current = annotationsRef.current.filter((a) => a.id !== id);
    setAnnotations(annotationsRef.current);
    if (cible) {
      try {
        await vueRef.current?.deleteAnnotation({ value: cible.cfi });
      } catch {
        /* ignore */
      }
    }
  }

  function basculerNotes(): void {
    if (notesOuvert) sauverNotesEnAttente();
    setNotesOuvert(!notesOuvert);
    setSommaireOuvert(false);
    setMenuApparenceOuvert(false);
  }

  function basculerSommaire(): void {
    setSommaireOuvert((o) => !o);
    if (notesOuvert) sauverNotesEnAttente();
    setNotesOuvert(false);
    setMenuApparenceOuvert(false);
  }

  async function exporterNotes(): Promise<void> {
    const id = livreIdRef.current;
    if (!id || groupesNotes.length === 0) return;
    try {
      const res = await window.api.exporterNotes({
        livreId: id,
        chapitres: groupesNotes.map((g) => ({ titre: g.titre, annotations: g.items })),
      });
      if (!res.annule) {
        alert('Notes exportées avec succès !');
      }
    } catch (err: unknown) {
      alert(`Erreur export : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function changerThemeGlobal(nouveauTheme: Theme): void {
    setTheme(nouveauTheme);
    surChangerTheme?.(nouveauTheme);
  }

  const groupesNotes = notesOuvert && livreId ? grouperParChapitre() : [];
  const hudEstVisible = hudForce || menuApparenceOuvert;

  // Anneau 28px dans le HUD (minutes restantes, arrondi supérieur).
  const minutesRestantes = Math.max(0, Math.ceil((objectifSec - secondesJour) / 60));
  const progressionAnneau = objectifSec > 0 ? Math.min(1, secondesJour / objectifSec) : 0;
  const CIRCONFERENCE_ANNEAU = 2 * Math.PI * 12;

  return (
    <div className="encre-lecteur-racine" data-theme={theme}>
      {/* Zone de déclenchement au survol en haut de l'écran */}
      <div className="encre-zone-survol" />

      {/* HUD escamotable supérieur façon verre dépoli et tactile */}
      <header className={`encre-hud ${hudEstVisible ? 'encre-hud-visible' : ''}`}>
        <div className="encre-hud-section encre-hud-gauche">
          {surRetourBiblio && (
            <button
              type="button"
              className="encre-hud-btn encre-hud-btn-retour"
              onClick={surRetourBiblio}
              title="Retourner à la bibliothèque"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" strokeLinecap="round" />
                <polyline points="12 19 5 12 12 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Bibliothèque</span>
            </button>
          )}
          <div className="encre-hud-separateur-vertical" />
          <span className="encre-hud-titre-livre" title={titreLivreAffiche || nomLivre}>
            {titreLivreAffiche || nomLivre}
          </span>
        </div>

        <div className="encre-hud-section encre-hud-droite">
          {/* Anneau d'objectif journalier (28px, ne bloque rien, HUD inchangé) */}
          <div
            className={`encre-anneau-objectif${objectifAtteint ? ' atteint' : ''}${anneauMasque ? ' cache' : ''}`}
            title={objectifAtteint ? 'Objectif atteint' : `${minutesRestantes} min restantes (objectif ${objectifMin} min)`}
            aria-label={objectifAtteint ? 'Objectif atteint' : `${minutesRestantes} minutes restantes sur ${objectifMin}`}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
              <circle cx="14" cy="14" r="12" fill="none" strokeWidth="2" className="encre-anneau-fond" />
              <circle
                cx="14"
                cy="14"
                r="12"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                className="encre-anneau-progres"
                strokeDasharray={CIRCONFERENCE_ANNEAU}
                strokeDashoffset={CIRCONFERENCE_ANNEAU * (1 - progressionAnneau)}
              />
            </svg>
            <span className="encre-anneau-chiffre">{objectifAtteint ? '✓' : minutesRestantes}</span>
          </div>
          <button
            type="button"
            className={`encre-hud-btn ${menuApparenceOuvert ? 'actif' : ''}`}
            onClick={() => setMenuApparenceOuvert((o) => !o)}
            title="Apparence et typographie"
          >
            <span className="encre-hud-glyphe-aa">Aa</span>
            <span>Apparence</span>
          </button>

          <button
            type="button"
            className={`encre-hud-btn ${sommaireOuvert ? 'actif' : ''}`}
            onClick={basculerSommaire}
            disabled={!livreId}
            title="Sommaire du livre"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
              <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
              <line x1="3" y1="12" x2="16" y2="12" strokeLinecap="round" />
              <line x1="3" y1="18" x2="19" y2="18" strokeLinecap="round" />
            </svg>
            <span>Sommaire</span>
          </button>

          <button
            type="button"
            className={`encre-hud-btn ${notesOuvert ? 'actif' : ''}`}
            onClick={basculerNotes}
            disabled={!livreId}
            title="Carnet de notes et surlignages"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Notes</span>
            {annotations.length > 0 && <span className="encre-hud-badge-nombre">{annotations.length}</span>}
          </button>

          <button
            type="button"
            className="encre-hud-btn encre-hud-btn-importer"
            onClick={() => void ouvrirLivre()}
            disabled={!moteurPret}
            title="Ouvrir un autre fichier .epub"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
              <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
            </svg>
            <span>Ouvrir</span>
          </button>
        </div>
      </header>

      {/* Menu popover Apparence */}
      {menuApparenceOuvert && (
        <div className="encre-popover-apparence">
          <div className="encre-groupe-reglage">
            <span className="encre-label-reglage">Thème</span>
            <div className="encre-segments">
              <button
                type="button"
                className={`encre-segment-bouton ${theme === 'clair' ? 'encre-segment-actif' : ''}`}
                onClick={() => changerThemeGlobal('clair')}
              >
                ☀️ Papier
              </button>
              <button
                type="button"
                className={`encre-segment-bouton ${theme === 'sombre' ? 'encre-segment-actif' : ''}`}
                onClick={() => changerThemeGlobal('sombre')}
              >
                🌙 Encre
              </button>
            </div>
          </div>

          <div className="encre-groupe-reglage">
            <span className="encre-label-reglage">Taille de police</span>
            <div className="encre-segments">
              {TAILLES_POLICE.map((taille, idx) => (
                <button
                  key={taille}
                  type="button"
                  className={`encre-segment-bouton ${tailleIndex === idx ? 'encre-segment-actif' : ''}`}
                  onClick={() => setTailleIndex(idx)}
                >
                  {idx === 0 ? 'A' : idx === 1 ? 'A+' : 'A++'} ({taille}px)
                </button>
              ))}
            </div>
          </div>

          <div className="encre-groupe-reglage">
            <span className="encre-label-reglage">Interligne</span>
            <div className="encre-segments">
              {INTERLIGNES.map((inter, idx) => (
                <button
                  key={inter}
                  type="button"
                  className={`encre-segment-bouton ${interligneIndex === idx ? 'encre-segment-actif' : ''}`}
                  onClick={() => setInterligneIndex(idx)}
                >
                  {idx === 0 ? 'Serré' : idx === 1 ? 'Idéal' : 'Aéré'}
                </button>
              ))}
            </div>
          </div>

          <div className="encre-groupe-reglage">
            <span className="encre-label-reglage">Pages</span>
            <div className="encre-segments">
              <button
                type="button"
                className={`encre-segment-bouton ${colonnes === 1 ? 'encre-segment-actif' : ''}`}
                onClick={() => setColonnes(1)}
                title="Affichage page simple"
              >
                📄 1 page
              </button>
              <button
                type="button"
                className={`encre-segment-bouton ${colonnes === 2 ? 'encre-segment-actif' : ''}`}
                onClick={() => setColonnes(2)}
                title="Affichage 2 pages côte à côte comme un vrai livre"
              >
                📖 2 pages (Livre)
              </button>
            </div>
          </div>

          <div className="encre-groupe-reglage">
            <span className="encre-label-reglage">Largeur de texte</span>
            <div className="encre-segments">
              {CONFIG_LARGEURS.map((config, idx) => (
                <button
                  key={config.nom}
                  type="button"
                  className={`encre-segment-bouton ${largeurIndex === idx ? 'encre-segment-actif' : ''}`}
                  onClick={() => setLargeurIndex(idx)}
                >
                  {config.nom}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Zones latérales pour tourner les pages avec pastilles de navigation subtiles */}
      <div
        className="encre-zone-nav encre-zone-nav-gauche"
        onClick={() => void tournerPage(-1)}
        title="Page précédente (ou flèche ←)"
      >
        <div className="encre-nav-pastille">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div
        className="encre-zone-nav encre-zone-nav-droite"
        onClick={() => void tournerPage(1)}
        title="Page suivante (ou flèche →)"
      >
        <div className="encre-nav-pastille">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Surlignage In-Situ (Popover flottante au-dessus du texte sélectionné) */}
      {selectionActive && (
        <div
          className="encre-popover-selection"
          style={{
            left: selectionActive.x,
            top: selectionActive.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="encre-pastilles-couleurs">
            {PALETTE_SURLIGNAGE.map((p) => (
              <button
                key={p.val}
                type="button"
                className="encre-pastille"
                style={{ backgroundColor: p.val }}
                onClick={() => void surlignerCouleur(p.val, modeNoteRapide ? noteRapideTexte : null)}
                title={`Surligner en ${p.nom}`}
              />
            ))}
          </div>

          <div className="encre-separateur-vertical" />

          <button
            type="button"
            className="encre-action-selection"
            onClick={() => setModeNoteRapide((m) => !m)}
            title="Ajouter une note à ce passage"
          >
            ✏️ Note
          </button>

          <button
            type="button"
            className="encre-action-selection"
            onClick={() => void copierSelection()}
            title="Copier le texte"
          >
            Copier
          </button>

          {modeNoteRapide && (
            <div className="encre-note-rapide-boite">
              <textarea
                className="encre-note-textarea"
                rows={2}
                placeholder="Votre réflexion…"
                value={noteRapideTexte}
                onChange={(e) => setNoteRapideTexte(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="encre-bouton encre-bouton-primaire"
                style={{ fontSize: 11, padding: '4px 8px' }}
                onClick={() => void surlignerCouleur(COULEUR_DEFAUT, noteRapideTexte)}
              >
                Enregistrer la note
              </button>
            </div>
          )}
        </div>
      )}

      {/* Conteneur Foliate */}
      <main className="encre-lecteur-main">
        <div
          ref={conteneurRef}
          style={{
            width: '100%',
            height: '100%',
            maxWidth: CONFIG_LARGEURS[largeurIndex]?.maxWidth ?? '100%',
            margin: '0 auto',
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--encre-fond)',
          }}
        >
          {/* Pliure centrale simulant la reliure en mode 2 pages */}
          {colonnes === 2 && <div className="encre-pliure-livre" />}
        </div>
      </main>

      {/* Pied discret en lecture */}
      <div className="encre-pied-lecture">{titreLivreAffiche || nomLivre}</div>

      {/* Tiroir Sommaire */}
      {sommaireOuvert && livreId && (
        <>
          <div className="encre-tiroir-overlay" onClick={() => setSommaireOuvert(false)} />
          <aside className="encre-tiroir">
            <div className="encre-tiroir-header">
              <h2 className="encre-tiroir-titre">Sommaire</h2>
              <button
                type="button"
                className="encre-tiroir-fermer"
                onClick={() => setSommaireOuvert(false)}
                title="Fermer"
              >
                ×
              </button>
            </div>
            <div className="encre-tiroir-contenu">
              {tocVisible.length === 0 ? (
                <div style={{ padding: '16px 20px', color: 'var(--encre-texte-sec)', fontSize: 13 }}>
                  Aucun sommaire disponible dans cet ouvrage.
                </div>
              ) : (
                tocVisible.map((e) => (
                  <button
                    key={`${e.index}-${e.href}`}
                    type="button"
                    className="encre-sommaire-item"
                    onClick={() => void allerEntree(e)}
                    title={e.label}
                  >
                    {e.label}
                  </button>
                ))
              )}
            </div>
          </aside>
        </>
      )}

      {/* Tiroir Notes */}
      {notesOuvert && livreId && (
        <>
          <div className="encre-tiroir-overlay" onClick={basculerNotes} />
          <aside className="encre-tiroir">
            <div className="encre-tiroir-header">
              <h2 className="encre-tiroir-titre">Notes & Citations</h2>
              <button type="button" className="encre-tiroir-fermer" onClick={basculerNotes} title="Fermer">
                ×
              </button>
            </div>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--encre-bordure-douce)' }}>
              <button
                type="button"
                className="encre-bouton"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => void exporterNotes()}
                disabled={annotations.length === 0}
                title="Exporter toutes les notes en Markdown"
              >
                Exporter en Markdown
              </button>
            </div>
            <div className="encre-tiroir-contenu">
              {groupesNotes.length === 0 ? (
                <div style={{ padding: '24px 20px', color: 'var(--encre-texte-sec)', fontSize: 13, textAlign: 'center' }}>
                  Aucun passage surligné pour le moment.
                  <br />
                  <span style={{ fontSize: 12, color: 'var(--encre-texte-ter)' }}>
                    Sélectionnez du texte dans le livre pour surligner.
                  </span>
                </div>
              ) : (
                groupesNotes.map((g) => (
                  <div key={g.cle} className="encre-note-groupe">
                    <div className="encre-note-chapitre-titre">{g.titre}</div>
                    {g.items.map((a) => (
                      <div key={a.id} className="encre-note-carte">
                        <div
                          className="encre-note-citation"
                          style={{ borderLeftColor: a.couleur && a.couleur !== 'yellow' ? a.couleur : 'var(--encre-accent)' }}
                        >
                          « {a.texteExtrait} »
                        </div>
                        <textarea
                          className="encre-note-editeur"
                          value={a.note ?? ''}
                          onChange={(e) => editerNote(a.id, e.target.value)}
                          onBlur={() => sauverNoteMaintenant(a.id)}
                          rows={2}
                          placeholder="Ajouter une réflexion…"
                        />
                        <div className="encre-note-actions">
                          <button
                            type="button"
                            className="encre-bouton encre-bouton-discret"
                            style={{ fontSize: 12, padding: '3px 8px' }}
                            onClick={() => void allerPassage(a.cfi)}
                            title="Aller à ce passage dans le livre"
                          >
                            Aller
                          </button>
                          <button
                            type="button"
                            className="encre-bouton encre-bouton-discret"
                            style={{ fontSize: 12, padding: '3px 8px', color: '#c92a2a' }}
                            onClick={() => void supprimerAnnotation(a.id)}
                            title="Supprimer ce surlignage"
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
