# Spike CFI foliate-js — validation du render-time replay (U2 / D4 / CA6, jetable C7)

But : répondre à **U2** — l'API de foliate-js permet-elle d'extraire un CFI
depuis une sélection souris, et ce CFI résout-il au BON passage APRÈS
recréation du DOM (changement de page/section), rejoué au rendu depuis les
CFI stockés (D4, vrai CA6) ? Aucune Phase 1 avant ce verdict.

## Fichiers

- `index.html` — file input, 3 boutons requis (Surligner / Changer police /
  Restaurer) + 2 flèches de navigation (instrument de test : placer des
  highlights sur plusieurs sections), viewer fixe 700px en paginé foliate,
  liste mémoire des CFI avec état de relocalisation.
- `spike.js` — script classique, zéro framework/bundler/npm. Moteur + dessin
  chargés via CDN (`view.js` et `overlayer.js` foliate-js 1.0.1, `import()`
  dynamique). Render-time replay : `appliquerHighlightsSurDOM()` relocalise
  CHAQUE CFI stocké via `resolveCFI` (range sur le DOM frais) et repeint via
  `addAnnotation`, appelée au clic « Surligner » ET après chaque rendu
  (`relocate` → `rejouerApresRendu`, + rappel explicite après `prev`/`next`).
  bouton « Restaurer » = simple rappel manuel du replay sur la page courante
  (sans navigation). Chaque replay logge en console
  `[replay] N succès, M échoués / total`. Fonctions courtes, une
  responsabilité chacune, commentées en français avec la décision/CA visée.
- Règle C3/C4 respectée : **aucun calcul de CFI maison**. CFI produits par
  `view.getCFI()`, résolus par `view.resolveCFI()` / `view.goTo()`, dessinés
  par `view.addAnnotation()` + `Overlayer.highlight` — tous publics.

## Procédure de test (manuelle, Chrome) — VRAI cas CA6 (re-render)

1. **HTTP obligatoire** (leçon spike-render) : depuis `spike-cfi/`,
   `python -m http.server 8000` → `http://localhost:8000/`. En `file://`,
   foliate-js reste vide (iframes blob sandboxées bloquées).
2. Charger un EPUB réel. Sélectionner **2 passages à la souris** sur la page
   courante, cliquer « Surligner la sélection » à chaque fois → 2 aplats
   jaunes + 2 CFI listés. Noter la console (F12) : chaque clic logge
   `[replay] N succès, M échoués / total`.
3. **Changer de page/section** (flèches ←/→, au moins 1 section d'écart pour
   forcer foliate à recréer le DOM), puis **REVENIR** sur la page d'origine.
   À chaque rendu, le replay automatique rejoue les CFI sur le DOM frais —
   lire la console : `[replay] 1 succès…` sur la page d'un highlight,
   `[replay] 0 succès…` sur une page sans highlight (section non chargée =
   nominal, pas un échec).
4. Critère de succès réel (CA6) : de retour sur la page d'origine, les
   **2 highlights sont là, sur le bon texte**, recréés depuis les CFI (états
   OK dans la liste) — pas conservés par chance du DOM. Le bouton
   « Restaurer » ne sert qu'en debug : il rejoue le replay sur la page
   courante, sans naviguer.
5. Optionnel : 2× « Changer police » (16→20→24px, re-layout D1) — le replay
   `relocate` doit aussi repeindre seul.

## Verdict U2 — lecture statutaire (spike v2 render-time replay)

Statut : **API suffisante pour le replay (analyse statique) → présomption :
VALIDÉ, à confirmer par la procédure ci-dessus**. Le test manuel peut
rétrograder en « cassé » (relocalisations inexactes après re-render) —
remplir alors la table + la console succès/échec.

- **Garde-fou C3/C4 : PAS « API insuffisante ».** La relocalisation d'un CFI
  vers un range du DOM courant (sans naviguer) EXISTE en API publique,
  vérifiée dans `view.js` foliate-js 1.0.1 : `View.resolveCFI(cfi)` retourne
  `{ index, anchor }` où `anchor(doc)` produit le `Range` dans le document
  fraîchement créé ; `View.getCFI(index, range)` produit le CFI ;
  `View.addAnnotation({ value: cfi })` + événement `draw-annotation` +
  `Overlayer.highlight` repeint. Rien n'a été bricolé ni réimplémenté. Limite
  nominale constatée : `addAnnotation` ne peint que si la section du CFI est
  chargée (`getContents().find(x => x.index === index)`) — d'où le compteur
  « échoués » sur les pages d'autres sections, attendu.
- **Ce que le test manuel doit encore prouver** (vrai CA6) : après changement
  de page + retour, les 2 aplats sont recréés depuis les CFI seuls, aux
  bonnes bornes (pas de décalage d'un mot/paragraphe), états OK.
- **« Restaurer » ne navigue plus** : simple rejouement manuel du replay sur
  la page courante (debug). L'état final reste sur la page courante, pas sur
  celle du dernier highlight (ancien comportement supprimé).

## Table des relocalisations + console (à remplir au test — 2 passages, vrai CA6)

| # | Passage attendu (extrait) | Texte retrouvé via CFI | État | Console `[replay]` au retour page |
|---|---|---|---|---|
| 1 | | | OK / DÉCALÉ / PERDU | ex. `2 succès, 0 échoués / 2` |
| 2 | | | OK / DÉCALÉ / PERDU | |

Règle de bascule : 2× OK au retour de navigation → U2 **validé** (Phase 1
débloquée pour D4) ; 1+ DÉCALÉ/PERDU reproductible sur la page d'origine →
U2 **cassé**, décrire ici le décalage exact (mots manquants en bordure ?
paragraphe voisin ? autre section ?) + copier la ligne console.

## Dépannage (constaté le 2026-09-26)

- **« Restaurer » ne fait rien (aucun replay visible).** Cause la
  plus probable : page ouverte en `file://` au lieu de HTTP, ou page courante
  sans highlight chargé (section du CFI non affichée → compteur « échoués »
  nominal). Fix : servir en HTTP (étape 1) + recharger, puis revenir sur la
  page des highlights.
- **Tous PERDU après retour de navigation** : copier un CFI listé + la ligne
  console `[replay]` ; suspect n°1 = CFI non résolu (`resolveCFI`), n°2 =
  texte retrouvé vide (ancre hors section chargée).

## Limites du spike (hors scope, C4/C7)

- Vrai CA6 = re-render (changement de page/section + retour). Thème,
  fermeture/réouverture, redimensionnement (CA6 complet) : non testés ici.
- Livres à mise en page fixe (`pre-paginated`) : non testés.
- Une sélection vit dans une seule section (limite DOM) : l'inter-sections
  n'est couvert que par des highlights séparés.
- Stockage mémoire : recharger la page vide la liste (voulu, C7).

## GLOSSAIRE — termes JavaScript employés dans spike.js

- `const` / `let` : déclarent une variable. `const` = récipient scellé (on ne
  peut pas y remettre autre chose), `let` = récipient modifiable (compteur…).
- Fonction : bloc d'instructions nommé qu'on appelle par son nom. Ici chaque
  fonction fait UNE seule chose (ex. `surligner()` ne fait que créer un
  highlight).
- `async` / `await` : `async` marque une fonction qui attend des opérations
  lentes (charger un livre) ; `await` = « attends la fin avant de continuer ».
- `import()` dynamique : charge un fichier JS depuis le CDN au moment où on
  en a besoin (ici le moteur foliate-js), sans l'inclure dans la page.
- Module ES : fichier JS moderne avec `export`/`import`. On le charge en
  invité, on n'y touche pas.
- CDN : serveur public qui distribue des bibliothèques (ici jsdelivr).
  Connexion internet requise, rien n'est installé.
- DOM : la page vue comme un arbre d'objets manipulables par le code
  (`document.getElementById` attrape un élément par son identifiant).
- Écouteur d'événement (`addEventListener`) : « quand X arrive (clic,
  fichier choisi…), exécute cette fonction ».
- `try` / `catch` : « essaie ce code ; en cas d'erreur, exécute le plan B
  au lieu de planter ». Sert à afficher les erreurs à l'écran.
- Sélection / `Range` : le texte bleu surligné à la souris. Le navigateur le
  représente par un objet `Range` (début + fin précis dans le texte).
- `cloneRange()` : photocopie du `Range`, pour le garder intact même si la
  sélection visible change après.
- CFI : adresse standard d'un passage dans un EPUB (ex.
  `epubcfi(/6/4!/2/2/1:0)`). C'est le moteur qui la calcule et la relit,
  jamais notre code (D4, C3/C4).
- iframe : fenêtre-ressource dans la page. Chaque section du livre s'affiche
  dans sa propre iframe, avec son propre `document`.
- `getSelection()` : récupère la sélection souris *à l'intérieur* du document
  d'une iframe (chaque document a la sienne).
- `getContents()` (API foliate) : donne la section affichée — son numéro
  (`index`) et son `document`. Pont entre la page et le moteur.
- `getCFI`, `addAnnotation`, `deleteAnnotation`, `goTo`, `resolveCFI` (API
  foliate) : respectivement produire un CFI, peindre/effacer un aplat, aller
  à un CFI, relire le passage d'un CFI. Toute l'intelligence d'ancrage.
  `resolveCFI` retourne `{ index, anchor }` : `anchor(doc)` donne le `Range`
  dans le DOM courant sans naviguer — c'est ce qui rend le replay possible.
- `appliquerHighlightsSurDOM()` : rejoue TOUS les CFI stockés sur le DOM
  frais (relocalise + repeint), logge `[replay] succès/échoués`.
- Événement `relocate` / `rejouerApresRendu` : signal « nouveau rendu » du
  moteur ; déclenche le replay automatique.
- Événement `draw-annotation` / `CustomEvent` : message envoyé par le moteur
  (« comment je dessine cette annotation ? ») ; notre fonction
  `peindreAnnotation` répond « en jaune » (`Overlayer.highlight`).
- `Overlayer` : calque transparent posé sur le texte où le moteur dessine les
  aplats (rectangles SVG), repositionnés à chaque re-pagination (`redraw()`).
- blob URL : adresse temporaire (`blob:…`) fabriquée par le moteur pour
  afficher une section dézippée. Invisible pour nous.
- shadow DOM fermé : boîte noire du composant `<foliate-view>` (inaccessible
  au code extérieur) — d'où l'obligation de passer par l'API publique.
- `?.` : « si ce qui précède est nul, rends nul au lieu de planter ».
- `??` : « si ce qui précède est nul, utilise la valeur de secours ».
- Boucle `for...of` : « pour chaque élément de la liste, fais… ».
- Tableau (`[]`) : liste ordonnée (ici `surlignages`, la mémoire des
  highlights ; `.push` ajoute, `.find` cherche, `.forEach` parcourt).
