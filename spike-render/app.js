/* Spike jetable (C7) — comparateur epub.js vs foliate-js.
 * Contraintes : UN slider police -> re-layout (D1, CA3), AUCUN transform: scale
 * sur le texte, toggle clair/sombre appliqué AU CONTENU sans toucher aux
 * images (D3, CA5), conteneur fixe ~700px en mode paginé (CA4).
 * Pas de persistance, pas de notes, pas de bibliothèque : tout est en mémoire.
 */

const FOLIATE_VIEW_URL = 'https://cdn.jsdelivr.net/npm/foliate-js@1.0.1/view.js';
const VIEW_W = 700;
const VIEW_H = 800;

/* Shim compat : foliate-js utilise Object/Map.groupBy (ES2024, Chrome 117+)
 * dans son parseur EPUB. Sans ça, makeBook/open lève sur Chrome plus ancien
 * alors qu'epub.js (sans groupBy) continue de marcher. */
if (typeof Object.groupBy !== 'function') {
  Object.groupBy = (items, keyFn) => {
    const out = {};
    let i = 0;
    for (const item of items) (out[keyFn(item, i++)] ??= []).push(item);
    return out;
  };
}
if (typeof Map.groupBy !== 'function') {
  Map.groupBy = (items, keyFn) => {
    const out = new Map();
    let i = 0;
    for (const item of items) {
      const k = keyFn(item, i++);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(item);
    }
    return out;
  };
}

const $ = (id) => document.getElementById(id);
const fileInput = $('file'), engineSelect = $('engine');
const prevBtn = $('prev'), nextBtn = $('next');
const fontSlider = $('fontsize'), fontVal = $('fontsize-val');
const themeToggle = $('theme'), overflowBtn = $('check-overflow');
const wrap = $('viewer-wrap'), epubContainer = $('epubjs-container');
const locationEl = $('location'), overflowEl = $('overflow');

let currentFile = null;      // File original (pour foliate-js : makeBook(File))
let currentBuffer = null;    // ArrayBuffer (pour epub.js)
let engine = 'epubjs';
let fontSize = 18;
let dark = false;

// --- État epub.js ---
let epubBook = null, epubRendition = null, epubLastCfi = null;
// --- État foliate-js ---
let foliateMod = null, foliateView = null;

const log = (msg) => { locationEl.textContent = msg; };

// Remonte les erreurs JS/CDN à l'écran (diagnostic : pas de console requise).
window.addEventListener('error', (e) => {
  log(`ERREUR JS : ${e?.message ?? e} — vérifiez la connexion (CDN) et la console (F12).`);
});

// Indicateur de démarrage : prouve que le script s'exécute.
log(`Prêt — choisissez un .epub. `
  + (typeof ePub === 'undefined'
    ? 'ATTENTION : CDN epub.js non chargé (hors-ligne ?).'
    : 'epub.js OK (CDN).'));
if (location.protocol === 'file:') {
  log(locationEl.textContent + ' ATTENTION : page ouverte en file:// — '
    + 'foliate-js y est BLOQUÉ par Chrome (iframes blob sandboxées : '
    + '« Not allowed to load local resource: blob:null/… »). Servez ce dossier '
    + 'en HTTP : `python -m http.server 8000` puis http://localhost:8000/ (voir README).');
}

/* ---------- CSS injectée dans le CONTENU (pas la chrome) ---------- */
function contentCSS() {
  const bg = dark ? '#161616' : '#ffffff';
  const fg = dark ? '#e8e6e3' : '#111111';
  const link = dark ? '#8ab4f8' : '#1a0dab';
  return `
html { font-size: ${fontSize}px !important; background: ${bg} !important; }
body { background: ${bg} !important; color: ${fg} !important; }
p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, section, article {
  background-color: transparent !important;
}
a, a * { color: ${link} !important; }
img, svg, video, image { filter: none !important; mix-blend-mode: normal !important; }
`.trim();
}

/* ================= epub.js ================= */
async function loadEpubJS() {
  destroyFoliate();
  destroyEpubJS();
  epubContainer.classList.remove('hidden');
  if (typeof ePub === 'undefined' || typeof JSZip === 'undefined') {
    log('ERREUR : CDN epub.js/JSZip non chargé — vérifiez la connexion internet.');
    return;
  }
  log('Ouverture du livre (epub.js)…');
  epubBook = ePub();
  // Encodage explicite : un ArrayBuffer passé seul à ePub() n'est pas
  // détecté de façon fiable comme binaire selon les versions.
  await epubBook.open(currentBuffer.slice(0), 'binary');
  await epubBook.ready;
  epubRendition = epubBook.renderTo(epubContainer, {
    width: VIEW_W, height: VIEW_H,
    flow: 'paginated', manager: 'default', spread: 'none',
  });
  // Hook contenu : applique taille de police + thème à CHAQUE section chargée.
  epubRendition.hooks.content.register((contents) => {
    const doc = contents.document;
    let st = doc.getElementById('spike-style');
    if (!st) {
      st = doc.createElement('style');
      st.id = 'spike-style';
      doc.head.appendChild(st);
    }
    st.textContent = contentCSS();
  });
  epubRendition.on('relocated', (loc) => {
    epubLastCfi = loc?.start?.cfi ?? null;
    flashPage();
    log(`[epub.js] ${loc?.start?.cfi ?? '(début)'} — police ${fontSize}px — ${dark ? 'sombre' : 'clair'}`);
  });
  await epubRendition.display();
}

function repaintEpubJS() {
  if (!epubRendition) return;
  try {
    for (const c of epubRendition.getContents()) {
      const st = c.document.getElementById('spike-style');
      if (st) st.textContent = contentCSS();
    }
  } catch { /* section pas encore prête */ }
  // Re-pagination explicite sur la position courante (re-layout, pas scale).
  try {
    if (epubLastCfi) epubRendition.display(epubLastCfi);
    else epubRendition.display();
  } catch { /* ignore */ }
}

function destroyEpubJS() {
  try { epubRendition?.destroy?.(); } catch { /* ignore */ }
  try { epubBook?.destroy?.(); } catch { /* ignore */ }
  epubRendition = null; epubBook = null; epubLastCfi = null;
  epubContainer.innerHTML = '';
}

/* ================= foliate-js ================= */
async function loadFoliate() {
  destroyEpubJS();
  destroyFoliate();
  epubContainer.classList.add('hidden');
  log('Chargement foliate-js (CDN)…');
  try {
    if (!foliateMod) foliateMod = await import(FOLIATE_VIEW_URL);
  } catch (e) {
    log(`ERREUR : CDN foliate-js inaccessible (${e?.message ?? e}) — vérifiez la connexion.`);
    return;
  }
  log('Ouverture du livre (foliate-js)…');
  foliateView = document.createElement('foliate-view');
  wrap.appendChild(foliateView);
  const book = await foliateMod.makeBook(currentFile);
  await foliateView.open(book);
  // Mémorise le style AVANT d'aller à la section : Paginator le réapplique
  // à chaque section chargée (setStyles stocké). 'animated' = transition (CA4).
  foliateView.renderer.setStyles(contentCSS());
  foliateView.renderer.setAttribute('animated', '');
  foliateView.addEventListener('relocate', (e) => {
    const d = e.detail;
    flashPage();
    log(`[foliate-js] fraction=${typeof d?.fraction === 'number' ? d.fraction.toFixed(3) : '?'} `
      + `cfi=${d?.cfi ?? '?'} — police ${fontSize}px — ${dark ? 'sombre' : 'clair'}`);
  });
  await foliateView.goTo(0);
}

function repaintFoliate() {
  // setStyles() déclenche un re-layout ancré (ResizeObserver + ancre interne).
  try { foliateView?.renderer?.setStyles(contentCSS()); } catch { /* ignore */ }
}

function destroyFoliate() {
  try { foliateView?.close?.(); } catch { /* ignore */ }
  foliateView?.remove?.();
  foliateView = null;
}

/* ================= pilotage commun ================= */
async function loadCurrent() {
  if (!currentFile) return;
  overflowEl.textContent = '';
  try {
    if (engine === 'epubjs') await loadEpubJS();
    else await loadFoliate();
  } catch (e) {
    log(`ERREUR chargement (${engine}) : ${e?.name ? e.name + ' : ' : ''}${e?.message ?? e}`);
  }
}

async function goPrev() {
  try {
    if (engine === 'epubjs') await epubRendition?.prev();
    else await foliateView?.prev();
  } catch (e) { log(`ERREUR prev : ${e?.message ?? e}`); }
}
async function goNext() {
  try {
    if (engine === 'epubjs') await epubRendition?.next();
    else await foliateView?.next();
  } catch (e) { log(`ERREUR next : ${e?.message ?? e}`); }
}

function flashPage() {
  wrap.classList.remove('page-enter');
  void wrap.offsetWidth; // relance l'animation
  wrap.classList.add('page-enter');
}

/* Heuristique CA1 : compare la largeur de scroll du document paginé à sa
 * largeur cliente, + signale les images plus larges que le conteneur.
 * Limite connue : les moteurs en colonnes CSS fixent la largeur de l'iframe
 * à N pages ; un scrollWidth > clientWidth signale un débordement réel. */
function checkOverflow() {
  const frames = wrap.querySelectorAll('iframe');
  if (!frames.length) { overflowEl.textContent = 'CA1 : aucune iframe à inspecter (livre non chargé ?).'; return; }
  const lines = [];
  frames.forEach((f, i) => {
    let doc;
    try { doc = f.contentDocument; } catch { lines.push(`iframe ${i} : inaccessible`); return; }
    if (!doc?.documentElement) return;
    const de = doc.documentElement;
    const overflowX = de.scrollWidth - de.clientWidth;
    let wideImgs = 0;
    try {
      const limit = de.clientWidth || VIEW_W;
      for (const img of doc.querySelectorAll('img, svg, video')) {
        const r = img.getBoundingClientRect();
        if (r.width > limit + 1) wideImgs++;
      }
    } catch { /* ignore */ }
    const verdict = overflowX > 1 ? 'DÉBORDEMENT' : 'ok';
    lines.push(`iframe ${i} : scrollW=${de.scrollWidth} clientW=${de.clientWidth} → ${verdict} ; images trop larges : ${wideImgs}`);
  });
  overflowEl.textContent = 'CA1 — ' + lines.join(' | ');
}

/* ================= événements chrome (hors contenu) ================= */
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  currentFile = f;
  currentBuffer = await f.arrayBuffer();
  await loadCurrent();
});
engineSelect.addEventListener('change', async () => {
  engine = engineSelect.value;
  await loadCurrent();
});
prevBtn.addEventListener('click', goPrev);
nextBtn.addEventListener('click', goNext);
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') goPrev();
  if (e.key === 'ArrowRight') goNext();
});
fontSlider.addEventListener('input', () => {
  fontSize = Number(fontSlider.value);
  fontVal.textContent = `${fontSize}px`;
  // UN SEUL curseur -> re-layout via CSS font-size (jamais de scale).
  if (engine === 'epubjs') repaintEpubJS();
  else repaintFoliate();
});
themeToggle.addEventListener('change', () => {
  dark = themeToggle.checked;
  document.body.classList.toggle('dark-chrome', dark);
  wrap.classList.toggle('dark-content', dark);
  if (engine === 'epubjs') repaintEpubJS();
  else repaintFoliate();
});
overflowBtn.addEventListener('click', checkOverflow);
