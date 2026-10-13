# Spike rendu EPUB — epub.js vs foliate-js (jetable, C7)

But : trancher **U1** (choix du moteur de rendu au regard de CA1, CA3, CA4, CA5).
Ce dossier est un spike jetable : pas de notes, pas de highlight, pas de
bibliothèque, pas de persistance, pas d'app. Ne pas en dériver l'appli.

## Fichiers

- `index.html` — page unique : `<input type=file>`, sélecteur de moteur,
  conteneur fixe 700px en paginé, boutons page suivante/précédente, UN slider
  de taille de police (re-layout, jamais `transform: scale`), toggle
  clair/sombre appliqué au CONTENU (images exclues), bouton de contrôle CA1.
- `app.js` — logique du spike, sans framework, sans bundler, sans npm.
- Moteurs chargés uniquement via CDN (connexion requise) :
  - epub.js `0.3.93` : `cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js`
    (+ `cdnjs …/jszip/3.10.1/jszip.min.js`,scripts classiques, global `ePub`).
  - foliate-js `1.0.1` : `cdn.jsdelivr.net/npm/foliate-js@1.0.1/view.js`
    (module ES, `import()` dynamique, `makeBook(File)` + `<foliate-view>`).

## Procédure de test (manuelle, Chrome)

1. Lancer un serveur local depuis ce dossier (**OBLIGATOIRE pour foliate-js**,
   `file://` direct ne suffit pas — voir Dépannage) :
   `python -m http.server 8000` puis ouvrir `http://localhost:8000/`.
2. Préparer **3 EPUB réels problématiques** : un avec CSS interne agressive
   (fonds/couleurs forcés), un avec images larges + tableaux/`pre`, un avec
   longs mots composés. Les nommer E1, E2, E3 dans la grille ci-dessous.
3. Pour **chaque moteur** (sélecteur) et **chaque EPUB** :
   - Charger via l'input fichier → vérifier qu'une page s'affiche.
   - **CA4** : cliquer précédent/suivant + flèches clavier. Attendu : pages
     nettes avec transition (fondu côté epub.js via `.page-enter`,
     `animated` côté foliate-js), pas de scroll mécanique.
   - **CA1** : inspecter visuellement + cliquer « Vérifier débordement ».
     Attendu : `→ ok` et `images trop larges : 0`. Noter tout texte/image
     qui dépasse la colonne de 700px.
   - **CA3** : bouger le slider 12→30px par paliers de 1 (5 paliers min).
     Attendu : re-pagination sans débordement, page courante conservée
     (epub.js re-affiche le CFI courant ; foliate-js garde son ancre).
   - **CA5** : cocher/décocher le thème sombre. Attendu : fond/texte du
     LIVRE inversés et lisibles, CSS interne neutralisée, **images intactes**
     (ni inversées, ni voilées). Vérifier à l'œil sur une page avec image.

## Dépannage (constaté le 2026-09-26)

- **Ouverture en `file://` (double-clic) : epub.js marche, foliate-js reste
  vide.** Signatures console : `Not allowed to load local resource:
  blob:null/…`, `Cannot read properties of null (reading 'head')` dans
  `paginator.js`, `'file:' URLs are treated as unique security origins`.
  Cause : les iframes de foliate-js sont sandboxées
  (`sandbox="allow-same-origin"`) et Chrome refuse d'y charger leurs contenus
  `blob:` quand la page mère est en `file://` (origines opaques uniques).
  Les iframes non sandboxées d'epub.js passent, d'où l'asymétrie.
  **Fix : servir en HTTP (étape 1).** La page affiche un bandeau si elle est
  ouverte en `file://`.
- **Chrome < 117** : foliate-js utilise `Object/Map.groupBy` (ES2024) dans son
  parseur ; `app.js` embarque un shim de compat. Si `ERREUR chargement
  (foliate) : TypeError … groupBy …` persiste, mettre Chrome à jour.

## Verdicts — lecture statutaire

Statut des verdicts ci-dessous : **PROVISOIRES — analyse statique du code du
spike + documentation officielle des moteurs, NON confirmés par test manuel**
(l'auteur n'a pas exécuté la procédure sur les 3 EPUB). Chaque verdict doit
être confirmé/infirmé en rayant la mention et en ajoutant la capture ou la
description de l'échec observé. Lire `respecté / partiellement / cassé` comme
une hypothèse de travail, pas comme un résultat mesuré.

### epub.js (0.3.93)

| Critère | Verdict provisoire | Justification / échecs connus |
|---|---|---|
| CA1 (pas de débordement) | **partiellement** | Pagination en colonnes CSS dans une iframe ; les contenus larges (tableaux, `pre` sans wrap, images sans `max-width`) débordent de façon documentée. Le spike n'injecte volontairement AUCUN garde-fou de mise en page (seulement police + thème) pour observer le comportement brut. |
| CA3 (zoom = re-layout) | **partiellement** | `font-size` sur `html` + re-affichage explicite du CFI courant : re-pagine, mais en deux temps (pas de paliers animés natifs) et risque de perdre la page exacte si le CFI ne résout plus. Paliers de 1px OK via le slider. |
| CA4 (pages nettes + transition) | **respecté** | `flow: 'paginated'`, `manager: 'default'`, `spread: 'none'`, `prev()/next()` natifs ; transition = fondu CSS sur le conteneur (pas de slide natif). |
| CA5 (sombre contenu, images OK) | **partiellement** | Couleurs injectées via hook contenu après la CSS du livre, avec `!important`, images explicitement exclues (`filter: none`). Mais une CSS interne très agressive (sélecteurs ciblés + `!important`) peut fuiter : neutralisation au cas par cas, à vérifier sur E1. |

### foliate-js (1.0.1)

| Critère | Verdict provisoire | Justification / échecs connus |
|---|---|---|
| CA1 (pas de débordement) | **partiellement** | Même stratégie multi-colonnes — le README officiel prévient : « shares much of the same limitations » qu'epub.js. MAIS le paginateur bride nativement les images (`max-width/max-height`, `object-fit: contain`) et force `overflow-wrap: break-word` : attendu légèrement meilleur qu'epub.js brut, à confirmer sur E2. |
| CA3 (zoom = re-layout) | **respecté** | `renderer.setStyles()` + `ResizeObserver` + ancre interne (Range/Élément/fraction) : la re-pagination suit le passage courant sans re-affichage manuel ; paliers libres via CSS. |
| CA4 (pages nettes + transition) | **respecté** | `prev()/next()` + snap + attribut `animated` (slide natif du paginateur). |
| CA5 (sombre contenu, images OK) | **respecté (à confirmer)** | Style injecté APRÈS la CSS du livre (`$style` en fin de `head`), `--theme-bg-color` repris pour le fond des colonnes, images exclues nativement. Reste à vérifier sur E1 que les couleurs forcées du livre sont bien neutralisées sans artefacts. |

## Tranchage U1 (règle de décision)

1. Remplir la grille ci-dessus pour E1, E2, E3 avec captures/descriptions.
2. Choisir le moteur qui respecte CA1 + CA3 + CA5 sur les 3 EPUB ; CA4 est
   attendu respecté des deux côtés (départage secondaire).
3. Hypothèse de départ (pari DECISIONS.md) : **foliate-js favori** — ses
   mécanismes natifs (ancre de pagination, bridage d'images, style post-livre)
   correspondent point par point à D1/D2/D3. Ce pari ne vaut signature qu'après
   la procédure complète : si foliate-js casse CA1 sur E2, rouvrir le match.
4. U2 (qualité CFI) n'est PAS tranché par ce spike : les deux moteurs exposent
   des CFI (epub.js : `located.start.cfi`, foliate-js : `epubcfi.js`), à évaluer
   dans un spike dédié ancrage/highlight.

## Limites connues du spike (hors scope, C7)

- Contrôle CA1 heuristique : `scrollWidth` d'iframe + largeur d'images ;
  un moteur qui dimensionne l'iframe à N pages peut masquer un micro-débordement.
- epub.js : `rendition.display(cfi)` après chaque changement de police peut
  produire un flash (re-rendu complet de la section).
- Aucune gestion livre à mise en page fixe (`pre-paginated`) : foliate-js
  bascule sur `foliate-fxl`, non évalué ici.
- Versions CDN épinglées : toute mise à jour peut invalider ces observations.
