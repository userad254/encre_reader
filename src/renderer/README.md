# Renderer — layout flexible, re-pagination au resize et reprise de position

But (Phase 1, mise en place du layout flexible + re-pagination au redimensionnement + reprise de position) : boucler les deux derniers critères du noyau dur (DECISIONS.md) :
1. **(a) Layout 100vh flexible** sans boîte fixe : racine en `height: 100vh`, barre d'outils en `flex-shrink: 0`, zone foliate en `flex: 1` avec `min-height: 0` (supprime tout scroll de fenêtre). `<foliate-view>` remplit son conteneur (100% largeur et hauteur).
2. **(b) Re-pagination au redimensionnement (le highlight et la position survivent au redimensionnement)** : observation de la zone via `ResizeObserver` et appel de l'API publique de foliate (`renderer.render()`, API publique du moteur uniquement, aucune dépendance ni format inventé). Le texte est re-découpé en colonnes propres (rien ne dépasse la colonne) sans perte de surlignage (les highlights sont rejoués après chaque navigation car le DOM foliate est reconstruit) et sans sauter de page.
3. **(c) Reprise de position de lecture (le highlight et la position survivent à la réouverture du livre et de l'app)** : chargement de la position CFI depuis SQLite à l'ouverture (`position:charger` / `vue.goTo`), enregistrement debouncé (~500ms) à chaque changement de page (`position:sauvegarder`). Schéma SQLite distinct des annotations (`position(livre_id, cfi, maj_le)`).

Pas de chrome, pas de thème nouveau, pas de bibliothèque (on n'ajoute rien sans besoin réel : couleur unique, pas de version de migration, limites assumées).

## Diagnostic — images trop petites

### Sites exacts de la bride (AVANT tout code)

La bride ne vient **pas** de notre code (`Lecteur.tsx` ne contient ni `478`, ni `max-height`, ni `object-fit`). Elle vient entièrement de **`node_modules/foliate-js/paginator.js`** :

| Ligne | Code | Type |
|---|---|---|
| **195–198** | `setStylesImportant = (el, styles) => { style.setProperty(k, v, 'important') }` | Définition : pose toutes les valeurs en style **inline `!important`** |
| **333–352** | `setImageSize()` — boucle `querySelectorAll('img, svg, video')` | Applique les règles suivantes à chaque `<img>` |
| **341–343** | `'max-height': \`${height - margin * 2}px\`` | **Style inline `!important`** = hauteur conteneur − marges. Ex : 900px fenêtre − 72px marges × 2 = **478px** |
| **344–346** | `'max-width': (maxWidth !== 'none' ? maxWidth : '100%')` | Style inline `!important` — 100% si l'EPUB ne fixe rien |
| **347** | `'object-fit': 'contain'` | Style inline `!important` — ratio préservé |

**Conséquence** : `setStylesImportant` pose les valeurs via `style.setProperty(..., 'important')` **après** notre `setStyles()` (feuille CSS de l'iframe). Un style inline `!important` prime toujours sur une règle de feuille, quelle que soit sa spécificité. Nos `!important` CSS ne peuvent jamais écraser `max-height` ou `object-fit`.

**Seule propriété que foliate ne pose PAS inline** : `width`. Notre règle `img { width: … !important }` dans la feuille CSS gagne donc sans conflit.

### Cause de l'image petite

`setImageSize()` pose `object-fit: contain` + `max-height: 478px`. Si l'image a une largeur intrinsèque EPUB de 100px (CSS EPUB `img { width: 100px }`), elle s'affiche 100px large : `contain` la maintient dans son ratio, la hauteur est plafonnée, mais rien n'étire la largeur. Nos tentatives précédentes (`width: auto`, `max-width: 100%`) n'avaient aucun effet car `object-fit: contain` calcule le rendu depuis la taille du boîtier (`width` + `height`), et si `width` reste 100px, l'image reste 100px.

### Fix H1 appliqué

```css
img { width: 100% !important; }
svg { max-width: 100% !important; height: auto !important; }
figure, div:has(> img), p:has(> img) { width: 100% !important; max-width: 100% !important; }
```

- `width: 100% !important` → force la boîte image à toute la largeur de la colonne (foliate ne pose pas `width` inline, donc notre règle CSS gagne).
- `object-fit: contain` (posé par foliate, préservé) → le contenu de l'image est mis à l'échelle en gardant le ratio, dans la boîte 100% × 478px max. Image portrait : pleine hauteur. Image paysage : pleine largeur.
- `max-height: 478px !important` (posé par foliate, préservé) → l'image ne déborde jamais verticalement (rien ne dépasse la colonne).
- Parents directs libérés (`width: 100%`) pour ne pas brider depuis au-dessus.
- `height: auto` de notre feuille est sans effet si foliate pose `max-height` inline — c'est voulu, foliate contrôle la hauteur.

## Diagnostic — ouvrir un second livre affiche vide (AVANT tout code)

### (i) Audit des 4 useEffect de `Lecteur.tsx` : cleanup et fuites

| # | useEffect (lignes) | Rôle | Cleanup existante | Fuite ? |
|---|---|---|---|---|
| 1 | Montage îlot (173-210) | Crée `<foliate-view>`, attache `draw-annotation` + `relocate` (191-192) | `close()` + `remove()` + `ref = null` (199-208). **Pas de `removeEventListener` explicite** | **Non.** Deps `[]` : ne se ré-exécute jamais. L'élément détaché + renderer détruit est collectable ; rien ne se ré-abonne. |
| 2 | ResizeObserver (215-233) | Re-pagination au resize via `renderer.render()` | `ro.disconnect()` (230-232) | **Non.** |
| 3 | beforeunload (236-252) | Flush position à la fermeture | `removeEventListener` + `clearTimeout` (245-249) | **Non.** |
| 4 | Styles (255-258) | `setStyles` à chaque taille/thème | Aucun abonnement → rien à nettoyer | **Non (rien à nettoyer).** |

**Conclusion fuites : aucune.** Les écouteurs sont attachés une seule fois (effet 1, montage) ;
`close()` foliate ne les détache pas — et ne doit pas : ils sont sur l'élément
`<foliate-view>`, pas sur le renderer démonté. Ils survivent donc au rechargement,
sans duplication → la console `[replay]` ne se multiplie pas.

### (ii) Cause réelle : foliate-view NON rechargé (ni état React, ni écouteurs)

`ouvrirLivre()` appelait `await vue.open(livre)` (ex-L277) sur le même élément
**sans `close()` préalable**. Or l'API publique foliate (`foliate-js/view.js`) :
- `View.open(book)` (l.220-254) crée un **nouveau** renderer (`foliate-paginator`)
  et fait `this.#root.append(this.renderer)` (l.254) **sans retirer l'ancien** —
  `open()` n'est pas idempotent ;
- `View.close()` (l.284-295) est la méthode publique prévue : `destroy()` +
  `remove()` du renderer + reset progress/historique.

Donc le renderer du livre A restait dans le shadow DOM (avec ses iframes) et le
renderer de B s'empilait de façon incohérente → **B vide**. Écartées :
- *état React non réinitialisé* : les annotations l'étaient déjà (ex-L281-282) ;
  seule la **position** était résiduelle (badge CFI de A conservé si B sans position,
  `dernierePositionRef` + timer debounce de A pouvant sauver le CFI de A comme
  position de B si B est ouvert < 500 ms après une navigation dans A) — cause
  **secondaire**, elle ne vide pas l'écran ;
- *écouteurs dupliqués* : attachés une fois au montage, jamais ré-attachés (audit
  ci-dessus) — pas de `[replay]` multiplié.

### Choix du fix : rechargement via API publique, PAS de remount par `key`

`vue.close()` puis `vue.open(nouveauLivre)` : `close()`/`open()` sont publiques et
font exactement le démontage/remontage du renderer (view.js:284-295 / 220-254, API publique du moteur uniquement, aucune dépendance ni format inventé :
rien d'inventé) ; nos écouteurs (sur l'élément) survivent sans duplication.
Un remount (`key` liée au livre) serait **valide** — l'audit (i) confirme que les
cleanups détachent tout (`close()` + `remove()`, `disconnect()`) — mais
**inutilement destructeur** : recréer l'élément + ré-attacher + re-styles alors que
`close()` fait déjà le travail (on n'ajoute rien sans besoin réel : YAGNI). Fix appliqué dans `ouvrirLivre()` +
reset position (timer, ref, badge) à chaque nouveau livre ; police conservée
(préférence utilisateur, pas état résiduel).

## Navigation clavier + transition paginée

- **Principe archi** : UNE seule `tournerPage(dir)` pilote foliate (`prev()`/`next`,
  API publique). Boutons ←/→ ET clavier l'appellent (zéro duplication).
  Clavier : ←/→ et PageUp/PageDown = page, Home = début (`goTo(0)`),
  End = début de la dernière section linéaire. Écouteur `keydown` sur `window`
  dans un `useEffect` + cleanup `removeEventListener` (même discipline que le correctif « second livre vide » : détacher les écouteurs au démontage du composant ;
  attaché une fois, jamais dupliqué). Garde-fou : frappes ignorées dans un champ
  éditable (anticipe le panneau notes : les touches de navigation ne doivent pas agir pendant la frappe dans un champ) et sans livre.
- **Transition (pagination en colonnes par défaut + transition animée, jamais de scroll infini)** : attribut `animated` posé sur le renderer après chaque `open()`
  (le renderer est recréé par `open()`, cf. le correctif « second livre vide » ci-dessus). Foliate glisse alors
  `containerPosition` entre pages de colonnes en 300ms `easeOutQuad`
  (`paginator.js:936-942`) — animation ENTRE pages paginées, JAMAIS de scroll
  continu (mode `scrolled` non activé, API publique du moteur uniquement, aucune dépendance ni format inventé : rien d'inventé).
- **Replay post-animation (le highlight et la position survivent au re-render et à la navigation)** : `relocate` est émis par `#afterScroll`
  (`paginator.js:987-1004`), donc APRÈS la fin du glissement ; `surRelocate`
  rejoue les highlights sur le DOM final, pas pendant le glissement. Aucun
  `requestAnimationFrame` maison nécessaire.
- **Limite connue** : End = début de la dernière section, pas sa toute dernière page (on n'ajoute rien sans besoin réel : limite assumée).
- **Diagnostic (corrigé)** : page bloquée après surlignage/navigation avec
  `Refused to load the stylesheet 'blob:…'` (CSP `style-src`). Cause : foliate
  sert la CSS de l'EPUB en `blob:` et les iframes de sections héritent la CSP de
  la page. Fix : `style-src 'self' 'unsafe-inline' blob:` dans `index.html`.
  `script-src` reste `'self'` (aucun script `blob:`) : sécurité inchangée.
- **Diagnostic (corrigé)** : texte invisible en mode clair mais visible en mode
  sombre. Cause : la CSS de l'EPUB force une couleur claire directement sur ses
  éléments — notre `body{color!important}` ne s'applique qu'en héritage, et
  l'héritage perd contre toute règle directe du livre ; le fond sombre masquait
  le problème par hasard. Fix : `body *{color:#111 !important}` en mode clair
  uniquement (avant la règle des liens, qui gardent leur bleu). Sombre inchangé.
  Test : ouvrir le livre, passer clair→sombre→clair, tout le texte reste lisible.

## Diagnostic TOC foliate (AVANT tout code)

**TOC exploitable, aucun parse OPF/NCX maison.** Tout est déjà en API publique :
- `book.toc` = `[{ label, href, subitems }]` — construit par foliate depuis le
  nav EPUB3 (`epub.js:322-325`) ou le NCX EPUB2 (`epub.js:354-367`), assigné en
  `epub.js:1000` / `epub.js:1009`. C'est une donnée du livre retourné par
  `makeBook()` (aucun parsing EPUB maison, délégué à foliate ; API publique du moteur uniquement, aucune dépendance ni format inventé : rien d'inventé).
- Naviguer vers une ancre : `View.goTo(target)` (`view.js:447-457`) appelle
  `resolveNavigation(target)` (`view.js:433-446`) qui, si ce n'est ni nombre ni
  CFI, délègue à `book.resolveHref(target)` (`view.js:441`). Celui-ci découpe
  `path#hash`, trouve l'item dans le spine et rend `{ index, anchor }`, l'ancre
  pointant le fragment (`epub.js:1043-1050`). Donc **`vue.goTo(entree.href)`**
  suffit — zéro recalcul de position maison.
- Index d'une entrée : `vue.resolveNavigation(href).index` (public, même fonction).
  Index courant : `vue.resolveCFI(cfi).index` (déjà utilisé pour le replay).
- **Touches tranchées : Ctrl+← / Ctrl+→.** Justification : même axe que ←/→
  (modificateur = saut plus grand, mémorisation immédiate), indépendant du layout
  clavier (`,/.` varient AZERTY/QWERTY), pas de conflit avec les champs (le
  garde-fou existant ignore aussi les frappes à modificateurs dans un champ).

## Diagnostic couverture foliate (AVANT tout code)

**VERDICT : couverture exposée par l'API publique, aucun parse OPF maison.**
Tout est déjà dans `node_modules/foliate-js/epub.js` (aucun parsing EPUB maison, délégué à foliate ;
API publique du moteur uniquement, aucune dépendance ni format inventé) :

- `book.getCover()` (**epub.js:1061-1066**, méthode async publique du livre
  retourné par `makeBook()`) : résout `this.resources?.cover` puis rend
  `new Blob([await this.loadBlob(href)], { type: mediaType })`, ou `null`
  si le livre n'a pas de couverture. **Format retourné : `Blob` image
  (type = mediaType OPF, ex. `image/jpeg`) ou `null`.** Jamais d'URL, jamais
  de data-URL : c'est au renderer de faire `URL.createObjectURL(blob)`
  (autorisé par la CSP existante : `img-src 'self' blob: data:`, pas de
  retouche `index.html`).
- Détection interne (pas à nous) : `resources.cover` (**epub.js:669-677**) =
  propriété `cover-image` (EPUB3) → `meta name="cover"` (EPUB2) → manifest
  dont le href contient `cover` → guide. Si rien ne matche, `getCover()`
  rend `null` → on stocke NULL et la carte affiche le placeholder.
- Titre/auteur (même source, même règle) : `book.metadata` (assigné
  **epub.js:1017**, construit par `getMetadata`, **epub.js:175+**) :
  `metadata.title` = `string` OU `{lang: string}` (LanguageMap), et
  `metadata.author` = tableau de `{ name: string | {lang: string} }`
  (remappé depuis `dc:creator`). Le renderer normalise (objet → première
  valeur) avant d'envoyer au main ; le main ne parse jamais l'EPUB.
- Conséquence extraction : foliate-js exige le DOM (`DOMParser`) donc il ne
  tourne que dans le renderer. L'extraction titre/auteur/couverture se fait
  côté renderer après `makeBook()` (déjà appelé à l'ouverture), puis le main
  ne fait que persister (BLOB) — pas de `jsdom` ajouté au main (API publique du moteur uniquement, aucune dépendance ajoutée de notre initiative).

## Verdict d'intégrité (grep epub.js, AVANT tout code)

Question : un paquet `epub` (ou `epub.js`) s'est-il glissé dans le code ou le
bundle, à côté du moteur acté `foliate-js` (aucun parsing EPUB maison, délégué à foliate ; API publique du moteur uniquement) ?

- `grep "epub\.js|from 'epub|require('epub" src/` → **11 mentions, 0 import réel** :
  toutes en commentaires (`Lecteur.tsx`, `Bibliotheque.tsx`) ou au README
  (diagnostics TOC/couverture ci-dessus). Les seuls imports foliate du code sont
  `foliate-js/view.js` et `foliate-js/overlayer.js` (API publique, API publique du moteur uniquement).
- `package.json` : dépendances = `better-sqlite3, electron, foliate-js, react,
  react-dom` — aucun `epub`/`epubjs`. `package-lock.json` : une seule entrée
  `node_modules/foliate-js`, aucune entrée `node_modules/epubjs`.
- **Action (branche « zéro »)** : pas de re-câblage nécessaire ; purge des refs
  nues `epub.js:NNN` dans les commentaires TOC (`chargerToc`, `allerChapitre`)
  et cover (`texteMeta`, import) — elles désignaient un fichier interne du
  moteur mais la forme nue prêtait à confusion avec la librairie `epubjs`
  (c'était déjà le faux signal du diagnostic TOC). Les diagnostics README conservent les
  chemins qualifiés `node_modules/foliate-js/...` comme preuve traçable.

## Verdict étape 1 : la largeur vient du conteneur (CONFIRMÉ, avant code)

Cause actée confirmée dans `node_modules/foliate-js/paginator.js` (API publique du moteur uniquement :
rien d'inventé, on ne bricole pas) :

- `#beforeRender` (**l.695-700**) lit `this.#container.getBoundingClientRect()` :
  `width`/`height` du conteneur d'affichage pilotent tout le layout.
- `getLayout` (**l.745**, mode paginé) calcule
  `columnWidth = size / divisor - gap` depuis cette largeur.
- `columnize` (**l.301-312**) pose `column-width: Npx` via `setStylesImportant`
  (**l.195-198** = `style.setProperty(k, v, 'important')`, style **inline**) :
  toute règle `max-width`/`column-width` de notre feuille `setStyles()` est
  écrasée — la règle `max-width` de `styleContenu()` était donc morte (à retirer,
  elle crée de la confusion).
- `render()` (**l.772**, API publique déjà utilisée par le `ResizeObserver` de la mise en place du layout flexible)
  rejoue `#beforeRender` + re-découpe : c'est la voie prouvée par le
  redimensionnement de fenêtre.
- Aucune API publique `setLargeurColonne` dans `view.js` (vérifié dans l'analyse typo/réglages/sommaire ci-dessous) : rien
  à proposer côté moteur → **levier = largeur du conteneur + `render()`**.
  Fix : wrapper centré (`max-width` en em, `margin: 0 auto`) entre `<main>` et
  `<foliate-view>`, `ResizeObserver` déplacé sur ce wrapper, `render()` explicite
  au changement de palier.

## Thème/typo + réglages + sommaire (dette réelle, pas du « beau »)

- **(1) Dette typo clair soldée (thème sombre appliqué au contenu, images préservées ; sombre lisible + images intactes)** : l'ancien `body *{color:#111}` en mode
  clair aplatissait la hiérarchie (notes/légendes/citations en noir plat). La
  neutralisation des couleurs claires agressives reste (base `#161616`, toujours
  nécessaire : l'héritage perd contre toute règle directe du livre), mais les
  éléments secondaires (`small, aside, figcaption, cite, q, blockquote,
  .footnote/.footnotes/.note/.endnote, [role="doc-footnote"/"doc-endnote"]`)
  gardent un gris distinct `#555` (règle posée après, spécificité supérieure) ;
  les liens gardent leur bleu (règle `body a` posée en dernier). **Mode sombre
  inchangé** (contrainte : il marche, on ne le touche pas — bloc `sombre ? []`
  intact).
- **(2) Réglages indépendants qui re-paginent sans casser (zoom = re-layout par taille de police, jamais de mise à l'échelle)** : boutons `Interligne (1.4/1.7/2.0)` et
  `Largeur (38/52/70em)` — mêmes paliers cycliques que la police (on n'ajoute rien sans besoin réel : pas de
  slider). L'interligne passe par le `setStyles()` existant (re-layout).
  La largeur NE passe PAS par `setStyles` (cf. verdict ci-dessus : la largeur passe par la largeur du conteneur + render(), pas par la feuille CSS écrasée par le moteur ; règle
  feuille écrasée par le `column-width` inline du paginator) : un **wrapper
  centré** (`max-width` en em + `margin: 0 auto`, hauteur 100 %) entre `<main>`
  et `<foliate-view>`, que le viewer remplit ; le changement de palier appelle
  `renderer.render()` (même voie que le resize) et le `ResizeObserver` observe
  désormais ce wrapper (c'est sa largeur que le paginator lit). Le rétrécissement
  seul garantit par construction que rien ne dépasse la colonne.
  **Persistance tranchée : GLOBALE en
  `localStorage` (`encre-reglages-lecture`), pas par livre, pas en SQLite** —
  justification : l'interligne/largeur est un confort stable comme la police
  (conservée au changement de livre depuis le correctif « second livre vide »), pas une donnée livre ; le
  `localStorage` renderer évite une colonne SQLite et un canal IPC (on n'ajoute rien sans besoin réel).
  Défauts = rendu actuel (1.4, 70em ≈ pleine largeur) pour ne rien casser.
- **(3) Panneau sommaire (aucun parsing EPUB maison, délégué à foliate)** : liste le TOC **déjà chargé** (`tocRef` +
  miroir d'état), clic = `goTo(href)` existant (les highlights sont rejoués après chaque navigation car le DOM foliate est reconstruit + position via
  `relocate`, le highlight et la position survivent au re-render, aux réglages, au redimensionnement et à la réouverture). **Forme tranchée : OVERLAY absolu à droite (260px),
  pas sidebar** — justification : 0px volé à la zone de lecture, donc aucun
  `ResizeObserver`/`render()` au toggle et aucun saut de page (on n'ajoute rien sans besoin réel :
  une sidebar rétractable re-paginerait à chaque ouverture/fermeture).

## Audit câblage IPC annotations (AVANT fix)

Question : les noms de canaux `invoke` (preload) matchent-ils EXACTEMENT les
`handle` (main), sans handler absent ni divergent ?

- `annotations:modifierNote` : preload l.28
  `ipcRenderer.invoke('annotations:modifierNote', id, note)` ↔ main l.85
  `ipcMain.handle('annotations:modifierNote', (_e, id, note) => modifierNote(id, note))`
  → **MATCH EXACT**. Handler → `modifierNote` (`db.ts` l.118, `UPDATE annotations
  SET note`). Appelé par `Lecteur.tsx` l.767 (`window.api.modifierNote`, typé
  `ApiLecteur`, erreur → statut `ERREUR note`).
- `annotations:supprimer` : preload l.32
  `ipcRenderer.invoke('annotations:supprimer', id)` ↔ main l.86
  `ipcMain.handle('annotations:supprimer', (_e, id) => supprimerAnnotation(id))`
  → **MATCH EXACT**. Handler → `supprimerAnnotation` (`db.ts` l.123, `DELETE`).
  L'`invoke` ne résout qu'après le DELETE : le renderer filtre le state PUIS
  appelle `deleteAnnotation` (view.js:386) — succès confirmé avant repeinture.
  Appelé par `Lecteur.tsx` l.831, échec SQLite → ligne gardée (pas de divergence).
- **Verdict : ZÉRO ÉCART.** Aucun nom divergent, aucun handler absent, aucun canal
  appelé sans enregistrement (ni l'inverse). La mention DECISIONS.md « handler main
  absent pour `annotations:supprimer` » est contredite par le code : la mise en place du panneau notes
  a enregistré les deux handlers ; la note est périmée, à solder par l'architecte.
- **Étape 2 : RIEN À FIXER.** Aucun handler à enregistrer, aucun nom à aligner
  (on n'ajoute rien sans besoin réel : pas de refactor sans symptôme). Preuve restante = test humain §12
  (note persistée après relance + suppression sans erreur).

## Comment ça marche (rappel archi DECISIONS.md)

- `src/main/` lit le disque + SQLite, expose les canaux IPC :
  - `livre:ouvrir` (dialogue + lecture EPUB brut ; rend aussi le chemin, id = chemin normalisé)
  - `annotations:charger` & `annotations:sauvegarder` (persistance des highlights)
  - `annotations:modifierNote` & `annotations:supprimer` (panneau notes : colonne note en SQLite + migration idempotente, overlay 260px, goTo(cfi), suppression définitive)
  - `notes:exporter` (export Markdown : format fixe, dialogue d'enregistrement côté main)
  - `position:charger` & `position:sauvegarder` (persistance de la position de lecture courante)
  - `livres:lister` & `livres:importer` & `livres:ouvrirDepuisId` & `livres:supprimer` (bibliothèque : grille d'accueil, identité d'un livre = chemin absolu normalisé, couverture/titre/auteur via foliate)
- `src/preload/` expose `window.api` (contextIsolation, pas d'ipc brut).
- `Lecteur.tsx` monte `<foliate-view>` dans un conteneur flexible `flex: 1; min-height: 0;` :
  - Au montage : `ResizeObserver` écoute les changements de taille du conteneur et déclenche `vue.renderer.render()` pour re-paginer foliate.
  - À l'ouverture : `chargerPosition` lit le dernier CFI dans la table `position` et navigue dessus (`vue.goTo(pos.cfi)`), puis `chargerAnnotations` injecte les highlights.
  - À chaque événement `relocate` : rejouement des highlights via `rejouerAnnotations()` et enregistrement debouncé (~500ms) du CFI courant dans SQLite.

## Prérequis (Windows 10)

1. Node.js LTS + Python 3 + Build Tools C++ de Visual Studio (pour `better-sqlite3`).
2. Dépendances installées via `npm install`.

## §14 — Design system + landing « Encre »

Tokens (`global.css`, `:root` + `[data-theme="sombre"]`) : fond/surface/texte/
texte-sec/bordure + accent ocre unique (`#b0691f` clair, `#d99a4e` sombre) ;
titres en Source Serif 4 (woff2 local via `@fontsource/source-serif-4` 400+600,
aucun CDN), contrôles en system-ui ; rayons 6-10px, ombres neutres douces
(jamais colorées). Classes de base : `.encre-bouton` (+`.encre-bouton-primaire`),
`.encre-carte`, `.encre-titre`, `.encre-grille`, `.encre-vide`.

Étendre : ajouter un token sous `:root` + sa valeur sous `[data-theme="sombre"]`,
puis une classe `.encre-*` qui le consomme — jamais de hex/inline dans les
composants migrés. Le sombre s'active en posant `data-theme="sombre"` sur
`<html>` (aucun interrupteur dans cette étape : la landing reste en clair par défaut).

Limites : `Lecteur.tsx` (vue lecture) reste 100 % inline et n'utilise pas les
tokens — migrée dans une étape ultérieure. `data-theme` n'est commuté par rien dans cette étape. Clichés
interdits (DECISIONS.md) : pas de dégradé néon, pas de glassmorphism, pas
d'emoji-icône, pas d'Inter.

Test design system : au lancement, header « Encre » serif + bouton discret
`+ Importer` ; bibliothèque vide = phrase + `Importer votre premier livre` ;
importer 2 livres = cartes 2:3 élégantes (titre serif, auteur discret) ;
clic = lecture fonctionnelle (ancienne UI) ; retour bibliothèque OK.

## Procédure de test

1. Lancer l'application : `npm run dev` (ou `npm run build && npm run start`).
2. Cliquer sur « Ouvrir un .epub » et choisir un livre.
3. Sélectionner un passage de texte à la souris et cliquer sur « Surligner la sélection ».
4. **Test Redimensionnement (le highlight et la position survivent au redimensionnement)** :
   - Agrandir ou réduire la fenêtre en largeur et en hauteur.
   - Constater : aucun scrollbar global de fenêtre, le texte se re-découpe instantanément en colonnes régulières adaptées à la fenêtre (rien ne dépasse la colonne), les surlignages restent exactement sur le bon texte, la page affichée reste la même sans sauter.
5. Tourner quelques pages avec « → ».
6. **Test Reprise de position (le highlight et la position survivent à la réouverture du livre et de l'app)** :
   - Noter la page / le passage courant.
   - Surligner un passage sur cette page.
   - Fermer la fenêtre de l'application.
   - Relancer (`npm run dev` ou `npm run start`).
   - Rouvrir le même livre : l'application rouvre directement sur la page où on s'était arrêté, et les surlignages de cette page sont bien présents.
7. **Test Second livre (correctif « second livre vide » : close() avant open() + réinitialisation position)** :
   - Ouvrir A, surligner 1 passage dans A.
   - Ouvrir B : B s'affiche correctement (pas d'écran vide), sans erreur console.
   - Les surlignages de A ne polluent pas B (liste = seuls ceux de B, badge position réinitialisé).
   - Rouvrir A : son highlight est toujours là (SQLite par livre).
   - Répéter A↔B plusieurs fois : la console `[replay]` affiche UNE ligne par rendu (pas de multiplication = pas de fuite d'écouteurs).
8. **Test Clavier + transition (navigation clavier + transition paginée animée)** :
   - Flèches ←/→, PageUp/PageDown : les pages glissent en douceur (300ms, pas de claquement), sans scrollbar de fenêtre.
   - Home : retour au début du livre. End : saut à la dernière section.
   - Surligner 1 passage, tourner 3 pages au clavier puis revenir : le highlight est présent et correct (replay post-animation, console `[replay]`).
   - Aucune erreur console pendant tout le tournage.
9. **Test Chapitres clavier (diagnostic du sommaire : TOC foliate déjà exploitable, Ctrl+←/→ pour changer de chapitre)** :
   - Ouvrir un livre : la console affiche `[toc] N entrée(s) — « label1 » (href1) | …` (3 premières).
   - Ctrl+→ : saut au début du chapitre suivant. Ctrl+← : retour au début du chapitre précédent.
   - Home/End inchangés (début du livre / dernière section, cf. End NON-BUG).
   - Surligner 1 passage, sauter de chapitre puis revenir : le highlight survit (les highlights sont rejoués après chaque navigation car le DOM foliate est reconstruit, sur `goTo`, console `[replay]`).
   - Aucune erreur console. Pas de panneau sommaire (volontaire dans cette étape : clavier seul).
10. **Test Bibliothèque (grille d'accueil, identité d'un livre = chemin absolu normalisé, couverture/titre/auteur via foliate)** :
    - Au lancement, la grille bibliothèque s'affiche (vide = « Importez un .epub »).
    - Importer 2 livres : ils apparaissent en grille (titre/auteur foliate, couverture si l'EPUB en a une, sinon initiale).
    - Cliquer l'un : il s'ouvre en lecture (même pipeline : reprise position + highlights SQLite via l'id = chemin normalisé).
    - Surligner 1 passage, revenir (← Bibliothèque), cliquer l'autre : il s'ouvre proprement (correctif « second livre vide » non régressé, pas d'écran vide).
    - Fermer l'app, rouvrir : la grille et les 2 livres sont là, les highlights aussi.
    - Console `[replay]` : `X ok, Y hors-champ (ignoré, normal), Z invalide(s)` — Y > 0 en tournant les pages est normal (highlights d'autres sections) ; Z > 0 + `CFI invalides` loggés = vrai problème.
    - Renommer/déplacer un fichier sur disque, lister, cliquer sa carte : état « Introuvable », le clic rouvre le dialogue (relocalisation).
11. **Test (typo du mode clair + réglages interligne/largeur + sommaire en overlay)** :
    - Mode clair, livre avec notes de bas de page : texte courant sombre, notes/légendes/citations en **gris distinct** (pas de noir plat) ; liens toujours bleus. Passer en sombre puis revenir : sombre inchangé, tout reste lisible.
    - `Interligne` : 1.4 → 1.7 → 2.0, le texte se re-pagine sans scroll de fenêtre (rien ne dépasse la colonne). `Largeur` : 70em → 52em → 38em, les colonnes se re-découpent réellement (texte visiblement plus étroit, centré, marges latérales) sans débordement ; redimensionner la fenêtre continue de re-paginer (ResizeObserver sur le wrapper) ; surlignages intacts (les highlights sont rejoués après chaque navigation car le DOM foliate est reconstruit).
    - Fermer/rouvrir l'app : interligne et largeur retrouvés (persistance globale `localStorage`).
    - `Sommaire` : l'overlay s'ouvre **sans déplacer le texte** (0px volé) ; clic sur une entrée → saut au chapitre, highlights survivants (les highlights sont rejoués après chaque navigation car le DOM foliate est reconstruit, console `[replay]`) ; × ou `Sommaire` referme, la page n'a pas bougé.
    - Grep d'intégrité : `grep epub.js` dans `src/*.tsx/*.ts` ne rend que les 2 mentions méta du grep lui-même ; aucun import `epub` dans le code ni le lockfile.
12. **Test Panneau notes (colonne note en SQLite + migration idempotente, overlay 260px, goTo(cfi), suppression définitive)** :
    - Surligner 2 passages (aucune modale ne s'ouvre, flux de surlignage initial inchangé) → bouton `Notes (2)` → l'overlay liste les 2 textes, groupés sous le bon titre de chapitre (livre multi-chapitres).
    - Taper une note sur l'un (frappe fluide, navigation clavier inactive dans le champ grâce au garde-fou) → fermer/rouvrir l'app → la note est là (colonne SQLite, migration idempotente au démarrage).
    - Cliquer `Aller` : la bonne page s'affiche, aplat jaune présent (`goTo(cfi)`, les highlights sont rejoués après chaque navigation car le DOM foliate est reconstruit).
    - Cliquer `Supprimer` sur l'autre : il disparaît du texte ET du panneau aussitôt (peinture retirée via `deleteAnnotation`, pas de re-load), 0 erreur console ; fermer/rouvrir → toujours absent (hard delete).
    - Non-régression : zoom/interligne/largeur/thème/sommaire/bibliothèque inchangés ; layout 100vh intact (overlay 0px volé).
13. **Test Export notes (format fixe, dialogue d'enregistrement côté main)** :
    - Livre avec 2 highlights dont 1 noté → panneau Notes → `Exporter les notes` → choisir un emplacement → statut `Exporté : <chemin>`.
    - Ouvrir le .md : frontmatter `book`/`author`/`bookId`/`exportedAt` exact, puis `## <chapitre>` dans l'ordre du livre, chaque bloc = `> texte` + (`_note : …_` présente sur le noté, omise sur l'autre) + `cfi: … · couleur: #FFFF00 · <date ISO>`.
    - Rouvrir le dialogue et l'annuler : statut `Export annulé.`, aucun fichier créé, aucune erreur.
    - **Après modif main/preload, FERMER puis RELANCER l'app (pas de rechargement à chaud : une erreur « No handler registered » = main périmé, pas un bug)** : après `npm run build`, FERMER puis RELANCER l'app avant de tester (main/preload sans rechargement à chaud — un `No handler registered` sur `notes:exporter` = main périmé, pas un bug).

## Exemple de fichier produit (schéma figé, DECISIONS.md)

```markdown
book: Mon Livre
author: Un Auteur
bookId: <chemin-normalise-du-livre>
exportedAt: 2026-09-27 10:00:00 UTC

## Chapitre 1

> Premier passage surligné
_note : à relire, idée importante_
cfi: epubcfi(/6/4!/4/2/1:0) · couleur: #FFFF00 · 2026-09-27 09:00:00 UTC

> Second passage sans note
cfi: epubcfi(/6/4!/4/6/1:0) · couleur: #FFFF00 · 2026-09-27 09:05:00 UTC
```

Règles appliquées : `##` + `>` concrétisent les lignes terse du schéma en Markdown valide ; note nulle → ligne `_note` omise ; couleur `yellow` → `#FFFF00` (schéma exige `<hex>`) ; chapitre vidé depuis (suppression entre-temps) → omis ; livre hors bibliothèque → `book` = id, `author` = `Inconnu`.

## Limites constatées (hors scope, on n'ajoute rien sans besoin réel)

- Identité-livre = chemin absolu normalisé : les highlights/positions d'avant la bibliothèque (clés au nom de fichier) sont orphelins, non migrés (une seule identité désormais, pas de double).
- Un seul auteur affiché (le premier de `metadata.author`) ; une couleur (`yellow`, colonne SQLite prête mais pas d'UI — dette actée, le panneau notes ne l'ajoute pas).
- Panneau notes : suppression = hard DELETE sans corbeille (définitif, limite actée) ; pas de recherche dans les notes (le panneau notes ne le fait pas).
- Réglages : l'interligne global écrase les leading internes du livre (assumé : c'est le sens d'un réglage) ; la liste du sommaire est plate (profondeur aplatie, cf. limite `allerChapitre`) ; 70em ≈ pleine largeur par défaut.
- Supprimer une carte garde ses annotations/position : ré-importer le même chemin les retrouve (la persistance highlight/position est préservée).
- Export : export = projection lecture seule (le .md n'est jamais relu) ; pas d'envoi Libraryna (étape suivante actée) ; nom de fichier proposé = titre nettoyé (caractères Windows interdits → `_`).
- Mode `pre-paginated` (manga/BD) non traité.

## GLOSSAIRE — React/TS/CSS employé ici (phrases simples)

- **Composant** : fonction qui décrit un morceau d'écran. Ici il n'y en a qu'un : `Lecteur` (toute l'UI de la mise en place du layout flexible).
- **useState** : mémoire locale du composant qui déclenche un re-rendu de l'écran quand elle change (ex : `tailleIndex`, `theme`, `positionCourante`).
- **useEffect** : fonction exécutée au cycle de vie du composant (« quand l'écran est monté ou qu'une variable change »). Ici utilisé pour le montage de foliate, l'écouteur `ResizeObserver` et la synchronisation de fermeture.
- **useRef** : boîte mémoire qui conserve une valeur stable entre les rendus React sans déclencher d'affichage inutile (ex : viewer foliate, liste des CFI, timer de debounce).
- **ResizeObserver** : API native du navigateur qui surveille les variations de taille (largeur/hauteur) d'un élément HTML. Ici, elle observe le conteneur du lecteur et ordonne à foliate de re-calculer ses colonnes (`vue.renderer.render()`) dès que la fenêtre bouge, sans calcul maison.
- **debounce** : mécanisme qui temporise une action répétée pour ne l'exécuter qu'une seule fois après un temps d'inactivité (ici ~500ms). Évite d'écrire en continu dans la base SQLite pendant que l'utilisateur redimensionne la fenêtre ou tourne les pages rapidement.
- **flex min-height: 0** : règle CSS fondamentale sur un enfant flex vertical. Par défaut, un enfant flex a `min-height: auto`, ce qui empêche le conteneur de rétrécir si son contenu est grand et engendre un ascenseur vertical sur la fenêtre. Forcer `min-height: 0` permet au conteneur de rétrécir sous sa taille naturelle et d'occuper strictement la hauteur restante de l'écran, supprimant tout scroll parasite.
- **IPC** : communication inter-processus entre le processus principal Node.js (`main`) et la fenêtre de rendu React (`renderer`).
- **Preload** : script passerelle sécurisé qui injecte `window.api` dans la fenêtre sans exposer les modules Node internes.
- **contextIsolation** : barrière de sécurité garantissant que la fenêtre du navigateur ne peut pas accéder directement à l'environnement Node.js de l'hôte.
- **keydown** : événement émis à chaque appui sur une touche du clavier. Ici, écouté sur `window` pour naviguer (←/→/PageUp/PageDown/Home/End) sans que le livre ait le focus.
- **addEventListener / removeEventListener** : « quand X arrive, appelle cette fonction » / « ne l'appelle plus ». Ici, le `keydown` est attaché au montage et détaché au démontage (cleanup du `useEffect`, même discipline que le correctif « second livre vide » : détacher les écouteurs au démontage du composant) : sans le détachement, chaque remontage ajouterait un écouteur et les pages tourneraient en double.
- **requestAnimationFrame (non utilisé)** : demande au navigateur d'exécuter une fonction juste avant le prochain affichage (utile pour animer soi-même). Ici inutile : c'est foliate qui anime le glissement en interne, et il prévient via `relocate` quand c'est fini — notre replay suit cet événement, pas la trame d'animation.
- **héritage CSS** : quand aucun style ne vise un élément directement, il prend la couleur de son parent. Mais dès que le livre vise l'élément lui-même (même sans `!important`), cette règle gagne contre l'héritage — d'où le texte invisible en mode clair.
- **!important** : « cette règle gagne contre les règles normales ». Ne suffit pas depuis le parent (voir héritage) : il faut viser les éléments eux-mêmes (`body *`).
- **toc / nav** : table des matières du livre (titres des chapitres + liens). Ici lue dans `book.toc` de foliate (construite depuis le `nav` EPUB3 ou le `ncx` EPUB2) : jamais parsée à la main (aucun parsing EPUB maison, délégué à foliate).
- **ancre** : destination précise dans le livre (section + endroit, ex. `chapitre2.xhtml#partie3`). Foliate la résout depuis le `href` du sommaire.
- **goTo** : fonction foliate « va à » (numéro de section, CFI ou `href` du sommaire). Ici un seul point d'entrée pour chapitres, début et fin.
- **bibliothèque** : grille d'accueil listant les livres importés (SQLite `livres`). L'ouverture passe par le même pipeline que le bouton ouvrir (`chargerLivre`), seule l'origine des octets change.
- **orphelin** : entrée bibliothèque dont le fichier a bougé ou disparu (`existe = faux`). La carte est grisée et son clic rouvre le dialogue pour relocaliser (limite actée, pas de hash).
- **interligne** : hauteur de ligne globale (`line-height`, paliers 1.4/1.7/2.0). Ici posée via `setStyles` foliate : re-pagination (zoom = re-layout par taille de police, jamais de mise à l'échelle), jamais de `transform: scale`.
- **overlay** : panneau flottant au-dessus de la lecture (position absolue). Ici le sommaire : il ne vole aucune largeur, donc son toggle ne déclenche ni `ResizeObserver` ni re-pagination.

## « Se relire » (note au hasard)

- **Canal** : `notes:auHasard(exclusions)` → `SELECT ... FROM annotations LEFT JOIN livres ... WHERE id NOT IN (...) ORDER BY RANDOM() LIMIT 1` ; repli titre/auteur `Inconnu` (orphelines d'avant la bibliothèque) ; `NoteAuHasard` en `src/shared/types.ts`.
- **Epigraphe** : `Bibliotheque.tsx`, en haut de la colonne principale ; tirage au montage (ouverture app + retour), anti-repetition via `localStorage['encre-notes-recentes']` (cap 10), masquee si vide. "Ouvrir le passage" = meme flux `ouvrirDepuisId` + `goTo(cfi)` prioritaire sur la position (une ouverture, via `cfiCible` dans `DemandeOuverture`).
- **Test fonctionnel** : ouvrir l'app avec des notes -> epigraphe visible avec la bonne source ; "Une autre" change sans repeter ; "Ouvrir le passage" = bonne page + highlight ; retour bibliotheque = nouveau tirage ; zero annotation = epigraphe absente.
- **Non-regression (statique, 2026-10-01)** : `npm run typecheck` et `npm run build` verts ; `Lecteur.tsx` touche uniquement a la priorite `cfiCible` (rendu/CFI/replay/position/notes/export inchanges) ; design system + landing intacts (etageres/recherche/drag&drop/Reprendre inchanges). **Passe manuelle en mode zen (surligner + note + position + export) non rejouable en headless : a rejouer cote humain apres `npm run build` en FERMANT puis RELANCANT l'app (après modif main/preload, FERMER puis RELANCER l'app : pas de rechargement à chaud, une erreur « No handler registered » = main périmé, pas un bug). Aucune casse constatee en statique.**

## epigraphe fixe et sidebar nette

- **Test visuel** : avec une annotation longue, verifier que la citation tient sur deux lignes au maximum, que la source `titre — auteur` est tronquee, et que les boutons icones ont les infobulles "Ouvrir le passage" / "Une autre". Le clic sur la citation et `→` doivent ouvrir la bonne page avec le highlight ; `↻` doit changer de note sans repetition.
- **Sidebar** : verifier a la taille de fenetre courante et en largeur reduite que la navigation ne defile pas, que "Continuer la lecture" et la ligne Lecteur/theme restent visibles sans scroll, et qu'aucun bouton n'est rogne. `+ Ajouter` reste le bouton d'import, le depot EPUB par glisser-deposer reste actif.
- **Limite** : la bande est absente tant qu'aucune annotation n'est disponible ; la navigation et les tirages restent ceux de la carte « Se relire ».

## Mesure de progression (sans UI)

- **Vérification humaine** : ouvrir DevTools avant la lecture. Ouvrir puis fermer un livre jamais lu : le main doit afficher `[progress] <id court> fraction=0 termine=0` (ou une valeur très proche de zero), et le renderer `[progress] loaded fraction=0 <id court>`. Sur le même livre, tourner 3-4 pages : les fractions sauvegardees doivent croitre en 0.0x ; fermer puis rouvrir doit afficher la derniere valeur dans `loaded fraction`.
- **Garde-fou** : un livre reste page 1 ne doit jamais produire une fraction `>= 0.01`. Une fraction `>= 0.98` sauvegardee doit afficher `termine=1`.
- **Migration** : les colonnes `progress` et `termine` sont ajoutees seulement si absentes ; verifier l'ouverture d'une base anterieure puis relancer l'app pour confirmer l'idempotence.
- **Limite** : cette tranche ne modifie aucune interface. Le rendu UI des etageres depend des valeurs mesurees et appartient à l'étape des étagères système (En cours / À lire / Terminés).

## Étagères système

- **Verification** : deux livres avec `progress >= 0.01` apparaissent tous deux dans « En cours de lecture », tries par derniere lecture, chacun avec sa barre proportionnelle. Un livre a `progress < 0.01` apparait dans « A lire ensuite » ; `termine = 1` l'envoie dans « Termines ». « Marquer termine » puis « Marquer a lire » doivent deplacer le livre et remettre sa progression a zero. Les trois rayons restent visibles avec « Aucun livre pour l'instant » lorsqu'ils sont vides. « Tous les livres » conserve sa galerie.
- **Widget** : « Continuer la lecture » reste base sur le dernier livre ouvert, independamment du classement des etageres, et sa barre suit la fraction sauvegardee.
- **Menu ⋯** : « Marquer en cours » est volontairement absent. Le statut en cours est un fait mesure par `relocate` (`progress >= 0.01`), pas une declaration manuelle : proposer cette action fabriquerait une progression non observee et contredirait le garde-fou de la mesure de progression (un livre resté page 1 ne dépasse jamais 1 % ; terminé auto à 98 %).
- **Non-regression** : ne modifier ni capture fraction/logs de la mesure de progression, epigraphe, recherche, glisser-deposer, ouverture du passage, highlights, lecture, mode zen ou tiroirs. Les etageres utilisateur restent hors scope (les catégories utilisateur, voir section suivante).

## Relecture des livres terminés

- **Menu** : un livre termine affiche « Relire depuis le debut » ; un livre non termine garde « Marquer a lire ». « Relire depuis le debut » remet `progress = 0` et `termine = 0`, puis ouvre le livre au debut sans reprendre l'ancien CFI. « Marquer a lire » reinitialise sans ouvrir.
- **Ouverture** : un livre termine sans CFI impose s'ouvre a la premiere page au lieu de reprendre son CFI sauvegarde. « Ouvrir le passage » fournit un `cfiCible` qui garde la priorite, y compris pour un livre termine.

## Catégories utilisateur

- **Verification** : creer « Business » via « + Catégorie », ouvrir le menu ⋯ d'un livre et l'ajouter ; la catégorie ouvre une vue ne contenant que ce livre. Ajouter un second livre depuis son menu et vérifier qu'ils apparaissent tous deux sans duplication dans « Tous les livres ». Décocher un livre dans le picker de « + » de la sidebar le retire de cette vue uniquement.
- **Picker** : depuis une carte, les cases représentent les catégories associées au livre. Depuis le « + » d'une catégorie, toutes les entrées de bibliothèque sont proposées et cochées selon leur association à cette catégorie. La création dans ce picker rafraîchit la sidebar.
- **Suppression** : supprimer une catégorie depuis la sidebar et vérifier que sa ligne et ses associations disparaissent, mais que les livres restent dans la bibliothèque et les étagères système.
- **Limites** : import EPUB reste uniquement « + Ajouter » ; aucun glisser-déposer de livres entre catégories. Catégories utilisateur séparées des étagères système.

## Disposition des étagères

- **Page Etageres** : les trois rayons système restent en premier et toujours visibles ; les catégories utilisateur contenant au moins un livre suivent dans l'ordre de création. Les catégories vides restent dans la sidebar seulement.
- **Rang** : grille responsive sans scroll horizontal, six livres maximum puis une tuile `+N` ; `+N` et « Toute l'etagere (N) » ouvrent la galerie complete du rayon. Les rayons vides gardent leur message explicite.
- **Vue complete** : clic sidebar catégorie et actions d'ouverture de rayon montrent une grille unique filtrée, sans cloner les livres dans la page principale.
- **Verification visuelle** : tester une fenêtre étroite ; les cartes doivent revenir à la ligne sans rognage ni scrollbar horizontale, et la galerie complète doit contenir exactement les livres du rayon.

## Horloge de lecture (mesure seule, sans UI)

- **Règle** : compte quand la vue lecture est montée ET la fenêtre focused (main, source de vérité). Pause : blur, minimiser, bibliothèque, fermeture. Pas de heartbeat renderer, pas d'idle detection.
- **Donnée** : `temps_lecture(jour TEXT PK AAAA-MM-JJ local, secondes, objectif_min défaut 15, atteint, maj_le)`. Migration idempotente (CREATE IF NOT EXISTS + PRAGMA avant ALTER). `atteint` recalculé à chaque flush (secondes >= objectif*60).
- **Vérification humaine (terminal + DevTools)** : `npm run dev`, ouvrir un livre focused 60s → un flush `[temps] jour=<date> +<delta>s total=<secondes> atteint=<0|1>` et total ≈ 60. Alt-tab 30s → aucun flush pendant ce temps (`segment close reason=blur` puis `open reason=focus` au retour). Retour bibliothèque → `segment close reason=etat`, plus rien ne compte. Fermeture app → flush + `close reason=quit` dans les logs. Relance → `temps:aujourdhui()` (DevTools : `await window.api.tempsAujourdHui()`) reprend le total SQLite.
- **Limites** : aucune UI (anneau/widget/popover = l'étape d'interface d'objectif journalier) ; `temps:maj` est poussé à chaque flush mais ignoré par le renderer ; un segment chevauchant minuit est compté au jour du flush ; `temps:aujourdhui()` ne voit que le persisté (attente ≤ 30s non incluse). Prévisualisation web : horloge inactive (stubs à zéro).
