# DECISIONS.md — Lecteur EPUB desktop (projet perso)

## Objet
Donner envie de lire des EPUB sur PC (Windows 10). La réussite se mesure à la QUALITÉ DE
LECTURE (rendu paginé propre, typo maîtrisée, thème sombre sur le contenu, annotations
robustes), pas au nombre de fonctionnalités. La chrome (bibliothèque, réglages, thème joli)
est secondaire et vient après le noyau.

## Environnement
- OS : Windows 10.
- Moteur de rendu : Chromium verrouillé par Électron (reproductibilité typo).

## Stack (compromis assumés, ne pas rouvrir sans preuve)
- Shell : Électron + TypeScript. Pas Tauri (WebView2 = Chromium à version variable sur
  Win10 → perte de reproductibilité). Pas de portage Python (l'écosystème EPUB de qualité
  est en JS).
- Chrome UI : React (renderer). React ne touche JAMAIS au DOM du livre.
- Moteur EPUB : **foliate-js** (tranché, voir État).
- Stockage local : SQLite via `better-sqlite3`, dans le process main.
- Packaging : NON TRANCHÉ (voir Reste à trancher).

## Architecture en couches
1. Main (Node/TS) : disque, SQLite, import, IPC.
2. Renderer chrome (React) : bibliothèque, panneau notes, réglages, navigation. Ne rend
   jamais le contenu du livre.
3. Zone de rendu : îlot foliate isolé. Interface minimale vers le reste : ouvrir(livre),
   pageSuivante/Precedente, setTaillePolice, setInterligne, setLargeurColonne, setThème,
   ajouterHighlight, getHighlights. Toute la complexité de rendu vit derrière.
4. Couche annotations : stockage brut (SQLite) séparé de la projection (Markdown Libraryna).
   Le Markdown n'est jamais édité à la main ni re-parsé comme source.

## Décisions clés
- D1. Zoom = re-layout par taille de police effective. Interdit : transform: scale sur le texte.
- D2. Pagination colonne par défaut, avec transition animée. Scroll continu = mode
  secondaire optionnel, jamais par défaut. (La "douceur" vient de l'animation entre pages,
  pas du défilement infini.)
- D3. Thème sombre appliqué au CONTENU du livre, images préservées, cohabitation CSS gérée.
- D4. Annotations ancrées en CFI + texte extrait comme garde-fou. Partie la plus dure, on ne
  la simplifie pas.
- D5. Pas de réinvention du parsing EPUB (unzip/OPF/NCX/TOC/couverture vient du moteur).
  On écrit : rendu, CFI, persistance, export, chrome.

## Critères d'acceptation du rendu (testables à l'œil)
- CA1. Rien ne dépasse la colonne, quelle que soit la taille de police.
- CA2. Mots longs cassés proprement.
- CA3. Zoom fin re-paginant sans casser CA1/CA2 ; réglages indépendants (police / interligne
  / largeur colonne).
- CA4. Pages nettes avec transition, pas de scroll par défaut.
- CA5. Thème sombre lisible, images intactes, sans artefact de CSS interne.
- CA6. Un highlight survit : changement de police, de thème, fermeture/réouverture du livre
  ET de l'app, redimensionnement de fenêtre.

## Conventions pour l'agent d'exécution
- C1. Lire ce fichier + le code existant AVANT toute modification.
- C2. Une tranche = un prompt = un livrable testable = un commit. Jamais deux préoccupations.
- C3. Ne jamais choisir dépendance/librairie/format de données de propre initiative. Décision
  manquante → s'arrêter et demander.
- C4. YAGNI strict. Pas d'abstraction/couche/config sans cas concret. Ne pas "préparer le
  futur" (exception unique actée : garde-fou clavier sur champs, coût nul, bug réel).
- C5. Code lisible, typé, types partagés explicites entre couches.
- C6. Fin de tâche : mettre à jour le README de la zone (procédure de test + limites).
- C7. Les spikes de Phase 0 sont jetables, pas la base de l'app.

## Export Libraryna (schéma Markdown figé — projection, pas source)
Par livre, un bloc Markdown :
book: <titre>
author: <auteur>
bookId: <id interne>
exportedAt: <ISO8601>
<Titre du chapitre>
<texte extrait du highlight>
_note : <note éventuelle>_
cfi: <cfi source> · couleur: <hex> · <date ISO>
Groupé par chapitre, dans l'ordre du livre. Généré à la demande depuis SQLite.

## État d'avancement
NOYAU + CHROME DE LECTURE FERMÉS. T3c VERTE (typo clair avec gris distinct, interligne,
largeur via conteneur+render, sommaire overlay, intégrité grep = (a)). T3b2 close.
Preuve d'usage : lecture réelle, largeur/interligne/sommaire/surlignage tous tenus.

Dettes NON-bloquantes (C4, pas de symptôme) :
- `allerChapitre` : deux entrées TOC même section → l'une mangée. Non rencontré.
- Couleur : colonne SQLite prête, PAS d'UI (un seul jaune, COULEUR_DEFAUT). T3d ne l'ajoute pas.
- Lignes pré-T3b2 orphelines : ignorées (base dev).
Exceptions C4 actées (coût nul, bug réel) : garde-fou clavier/champs ; nonce anti-double
ouverture. Ne pas généraliser.

## T3d = panneau notes (OUVERTE, prérequis T3e)
- Note = donnée LIVRE → colonne `note TEXT` dans SQLite (table annotations), migration sûre
  (PRAGMA table_info avant ALTER, idempotent). PAS localStorage (réservé aux réglages globaux).
- Panneau = overlay rétractable, même forme que sommaire (260px, 0px volé). Contenu :
  highlights groupés par chapitre (via tocRef + resolveCFI().index), chaque ligne = texte
  extrait + champ note éditable + bouton "aller au passage" (goTo(cfi), API prouvée T2b) +
  bouton supprimer (DELETE). Surligner crée le highlight note vide, SANS modale bloquante.
- T3d. VERTE (test humain : suppression OK après ferme/relance, note persistée).
- C8 (nouvelle convention). Après toute modification de src/main/ ou src/preload/,
  FERMER et RELANCER l'app (pas juste rebuild). Le process main et le preload d'Électron
  se chargent depuis le disque au démarrage, sans HMR. Une erreur fantôme type
  "No handler registered" est d'abord un main périmé, pas un bug de câblage :
  fermer/relancer AVANT de diagnostiquer.

## T3e = export Libraryna (OUVERTE, dernière tranche fonctionnelle)
- Déclencheur : bouton "Exporter les notes" dans le panneau Notes.
- Sortie : dialogue "enregistrer" du main → écrit un fichier .md sur disque
  (le renderer ne touche jamais au disque ; le main écrit).
- Contenu : le schéma Markdown figé (section Export Libraryna), groupé par chapitre
  dans l'ordre du livre, en réutilisant le regroupement tocRef déjà calculé en T3d
  (ne pas recalculer). Note nulle → ligne _note omise (schéma : "éventuelle").
- PAS d'appel API Libraryna dans cette tranche (c'est l'étape avancée suivante).
  L'export produit le fichier ; l'envoi viendra plus tard.
  ## Phase 4 = Design (FERMÉE)
- Nom app : **Encre** (token APP_NAME).
- Direction "encre & papier" validée par l'humain : palette claire/sombre hex fixée,
  accent unique ocre #b0691f / #d99a4e, ombres neutres, rayons 6-10px.
- Typo chrome : titres/landing = Source Serif 4 (via @fontsource, woff2 local) ;
  contrôles = system-ui. PAS Inter. Contenu livre inchangé (foliate/CSS).
- Décisions actées : global.css + CSS custom properties (fin du 100% inline, migré
  écran par écran) ; @fontsource/source-serif-4 comme seule dépendance asset.
- Clichés IA interdits (règle permanente) : dégradés néon/violet, glassmorphism,
  coins 2xl systématiques, ombres colorées, emojis-icônes, Inter, dark bleu-nuit saturé.

### T4a — Bibliothèque / Landing (VERTE)
- **Étagères 3D tangibles** : chaque rangée de livres repose sur une réglette en bois
  en relief (biseau, ombre portée sous chaque livre simulant un contact physique,
  lumière zénithale). Fond de l'étagère texturé en bois foncé.
- **Reliure physique** : chaque livre a une tranche gauche simulant une reliure
  (dégradé ocre/brun), une pliure interne (pseudo-élément), et une légère courbure
  de couverture. Les livres sans couverture reçoivent une reliure colorée unique dérivée
  du titre (palette de 5 teintes art).
- **Hover d'élévation** : translateY(-8px) + ombre longue + légère rotation 3D sur
  l'axe Y au survol, avec transition fluide 300ms cubic-bezier.
- **Sidebar tactile** : panneau gauche 220px avec fond papier texturé (#f5f0e8 clair /
  #1a1814 sombre), sceau typographique « E » (Source Serif 4, 64px), nom « Encre »,
  navigation par onglets (Tous, En cours, Terminés), bouton thème clair/sombre.
- **Widget "Reprendre"** : si un dernier livre ouvert existe (localStorage
  `encre-dernier-livre-id`), une carte compacte s'affiche en bas de sidebar avec
  couverture miniature, titre tronqué et bouton « Ouvrir ».
- **Drag & Drop** : zone de dépôt EPUB avec halo lumineux au survol d'un fichier
  valide. Import déclenché à la dépose.
- **Bouton "Ajouter un livre"** : relief doux, fond papier légèrement surélevé,
  bordure ocre, label discret « + Ajouter un livre ».
- **Recherche** : barre de recherche subtile (fond encaissé, icône loupe SVG intégrée)
  filtre en temps réel titre + auteur.
- **Salutation contextuelle** : titre de la zone principale varie selon l'heure du
  jour (Bonne lecture ce matin / cet après-midi / ce soir).
- **Message vide** : sceau « E » géant en watermark + invite à déposer un EPUB quand
  la bibliothèque est vide.

### T4b — Mode Zen (lecture immersive) (VERT)
- Fenêtre 100% livre : le chrome React disparaît, foliate occupe tout l'écran.
- HUD supérieur escamotable (opacity 0 par défaut, opacity 1 au survol de la zone
  haute ou touche Échap), contient : titre, auteur, progression, contrôles nav.
- Menu Apparence complet : Thème (clair/sombre/sépia), Police (4 choix), Interligne,
  Largeur colonne, mode Pages simple/double avec reliure centrale simulée.
- Suppression de tous les logs console et du footer technique en production.

### T4c — Popover de surlignage (VERTE)
- Popover flottante positionnée au-dessus de la sélection de texte.
- 4 teintes aquarelle douces : jaune, rose pâle, vert sauge, bleu lavande.
- Note rapide intégrée (champ inline, persistée en SQLite).
- Bouton Copier le passage.
- Fermeture automatique hors-clic.

### T4d — Tiroirs latéraux (VERTS)
- Sommaire : tiroir coulissant 260px depuis la gauche, zero pixel volé à la lecture.
  Chapitres groupés, chapitre actif mis en valeur, scroll jusqu'au chapitre sélectionné.
- Notes : tiroir 260px depuis la droite, highlights groupés par chapitre, champ note
  éditable inline (SQLite), bouton "aller au passage" (goTo CFI), bouton supprimer.
  Citation littéraire aléatoire en pied de tiroir. Bouton "Exporter les notes" (Markdown).

### T4e — Boutons du lecteur (VERTS)
- **HUD de lecture refait** : barre supérieure escamotable avec fond papier semi-opaque
  (`backdrop-filter: blur(12px)`), ombre douce vers le bas, hauteur 52px.
- **Bouton Fermer** (↩ retour bibliothèque) : icône flèche gauche SVG + label « Bibliothèque »,
  fond neutre au repos, halo ocre au survol, transition 200ms.
- **Boutons navigation** (← →) : grands (44px), fond papier surélevé, ombre portée légère,
  bordure fine, transform translateX(−2px/+2px) au clic (micro-feedback physique).
- **Bouton Sommaire** (☰) et **Bouton Notes** (✎) : icônes SVG propres (pas d'emojis),
  même traitement relief que les boutons nav, état actif (tiroir ouvert) distingué
  par fond ocre et bordure accentuée.
- **Bouton Apparence** (Aa) : même famille, ouvre le panneau de réglages typographiques.
- **Tous les boutons** : focus-visible avec outline ocre pour accessibilité clavier,
  cursor pointer, user-select none, transitions 200ms ease-out.
### T4g — Note en épigraphe + sidebar nette (OUVERTE)
- Cause racine des deux échecs note (milieu étagères / sidebar) : contenu à hauteur
  variable dans une zone à rythme ou espace fixe. Règle : empreinte fixe petite,
  contenu complet derrière une action.
- Note = bande épigraphe fixe (~72px) haut de colonne principale : citation serif
  italique clampée 2 lignes, source tronquée, icônes → / ↻ avec tooltip, clic citation
  = ouvrir passage. Zéro layout shift. Vide = masquée.
- Sidebar = structure Readowl : nav haut, bas ancré (Continuer + mode/thème), sans
  scroll interne. Retirer carte note + scroll ; retirer "Ajouter un EPUB" redondant.
- Règle overflow : aucun bouton label long en conteneur étroit ; icône + title.
## Phase 5 = Progression & étagères (OUVERTE, fonctionnalité par fonctionnalité)
- Distinction actée : étagères SYSTÈME (En cours/À lire/Terminés, calculées, non
  éditables) vs étagères UTILISATEUR (catégories, curatées, many-to-many). Sidebar =
  deux groupes distincts, jamais mélangés.
- Schéma figé :
  -- Phase 5a VERTE (4 sous-tranches closes : schéma, étagères système dérivées,
  menu statut, auto-unfinish gardé-fou).
- T5b OUVERTE : étagères utilisateur (catégories many-to-many).
- T5c = disposition étagères (OUVERTE) :
  - Page principale = étagères empilées : système (toujours) + catégories ayant
    >= 1 livre, dans l'ordre de création. Catégories vides = sidebar seulement.
  - Chaque étagère : 6 couvertures max + tuile « +N » cliquable si davantage ;
    overflow hidden ; AUCUNE scrollbar horizontale ni flèches.
    Lien « Toute l'étagère (N) → ».
  - « Toute l'étagère » ET clic sidebar catégorie = vue complète grille (vue
    filtrée existante). La vue filtrée n'est plus la vue par défaut d'une catégorie.
  - Grille responsive : les 6 cellules en grid auto-fill (wrap accepté en fenêtre
    étroite, jamais de couverture rognée).
    - T5c VERTE sauf tuile +N, retirée par T5c-fix (redondante, casse la rangée unique).
  Étagères = 6 couvertures max, lien « Toute l'étagère → » sans compteur.
  Phase 5 close après T5c-fix.
- T6 = packaging : electron-builder (NSIS + portable), productName Encre.
  CSP propre posée ET vérifiée en build packagé (blob: images/couvertures,
  styles injectés). better-sqlite3 rebuildé par electron-builder (npmRebuild).
  Icône best-effort depuis le logo du repo (sharp en devDep approuvée), sinon
  défaut + dette. userData packagé = %APPDATA%/Encre ; bibliothèque de dev non
  migrée, documenté.
  - Logo v1 (2026-10-03) : livre ouvert + plume en espace négatif + rivière d'encre,
  squircle noir, palette Encre. Contrainte connue : lisibilité 16px à vérifier au
  packaging ; variante petites tailles = v2, non bloquant. PNG accepté pour v1.
- T6-logo (micro) : assets déposés par l'humain (build/icon.png,
  src/renderer/assets/logo.png) ; BrowserWindow icon (finit l'atome en dev) ;
  sidebar = img ~30px, testé clair+sombre.
- T6 : l'étape icône devient « build/icon.png existe, pas de sharp, electron-builder
  convertit en .ico ».
  - T6. NON VERTE : dist échoue uniquement à la conversion PNG→ICO (WASM
  d'electron-builder vs PNG trop grand). Le reste (rebuild natif, CSP + relaxation
  style-src blob: documentée, asar, userData) est en place.
- T6-fix : icône pré-construite. devDeps approuvées : sharp (resize 16/32/48/256)
  + png-to-ico (assemblage, JS pur). Script one-off scripts/build-icon.js ;
  build/icon.ico committé ; win.icon = icon.ico → electron-builder ne convertit plus.
- Vulnérabilités npm (7) : identifier dev vs runtime AVANT de toucher. Dev-only =
  documenté, non corrigé (C4, outil de build perso). Runtime = me le signaler.
- T6 VERTE (passe installée 6 points, 2026-10-03). Phase 6 close.
- T6-logo2 : frange blanche du raccourci = fond cuit dans le PNG (pas d'alpha).
  Règle d'asset bloquante : alpha transparent hors du mark OU plein carré.
  Diagnostic sharp (channels) avant conversion ; STOP si fond cuit.
  ## Phase 7 = Objectifs de lecture (OUVERTE)
- Règle de mesure actée : compte quand vue lecture montée ET fenêtre focused.
  Pause : blur, minimiser, bibliothèque, fermeture. Pas d'idle detection (YAGNI).
- Schema temps_lecture(jour TEXT PK, secondes INTEGER, objectif_min INTEGER,
  atteint INTEGER, maj_le TEXT). atteint calculé au flush contre l'objectif du moment.
- Streak = jours consécutifs atteint=1 (jusqu'à aujourd'hui/hier). Texte sobre,
  pas de gamification (pas de flammes, pas de notification de record).
- Objectif journalier : presets 5/10/15/20/30/45/60 (localStorage). Anneau HUD 28px
  + "Objectif atteint" discret, jamais modal. Widget sidebar "Aujourd'hui".
- Objectif annuel : stepper 1-50 défaut 3 (localStorage). termine_le TEXT ajouté à
  livres, posé à chaque transition 0→1 de termine, NULL à 1→0. Livres pré-feature
  = NULL = non comptés (documenté). Ligne "AAAA · n/N livres" + barre fine.
- Popover "Objectifs" (icône cible pied sidebar) : presets jour + stepper année.
- Tranches : T7a horloge+donnée+logs (sans UI) ; T7b UI journalière ; T7c annuel.
- T7a VERTE (test humain + dist). Mesure validée : segments horodatés, pause sur
  blur/minimize/etat, flush sur quit, atteint calculé contre 15min par défaut.
- T7b = UI journalière :
  - Anneau HUD : 28px, stroke 2px accent, chiffre central 11px serif, minutes
    restantes (arrondi sup). Atteinte → stroke rempli 300ms + ✓ 1.5s puis masqué.
    Zéro modal/son.
  - Widget sidebar pied : anneau 20px + `n/N min` + streak `x j`. Sans objectif
    fixé → "Objectifs" cliquable → popover.
  - Popover Objectifs (icône cible pied sidebar) : presets jour 5/10/15/20/30/45/60
    (segmented control), stockage localStorage `encre-objectif-jour`.
  - IPC : `objectifs:fixer(minutes)` pousse l'objectif au main (calcul atteint
    au flush) ; `objectifs:jour` demandé au montage pour initialiser l'UI.
  - Streak calculé depuis `temps:moyenne` (7 derniers jours avec atteint=1
    consécutifs, depuis aujourd'hui inclus, tolère hier si aujourd'hui pas atteint).
  - T7b VERTE (2026-10-04). Doublon de log flush (+3s total=3 ×2) = bruit de log,
  donnée correcte, documenté non corrigé. Grille presets cassée 5+2 → corrigée en T7c(0).
- T7c = objectif annuel :
  - livres += termine_le TEXT (migration idempotente). Posé à chaque transition
    termine 0→1 (auto 0.98 ou menu), NULL à 1→0. Legacy termine=1 → NULL → non
    comptés (décision, documenté ; migration one-off possible plus tard).
  - localStorage encre-objectif-annee (défaut 3, stepper 1-50 dans le popover,
    section « Objectif de l'année » sous celle du jour).
  - IPC objectifs:anneeStats() → {annee, termines, objectif} ; ligne widget
    « 2026 · n/N livres » + barre fine 2px accent ; refetch au montage bibliothèque
    et après tout changement de statut.
## Phase 8 = Profil & statistiques (OUVERTE)
- PAS de compte utilisateur, PAS de serveur, PAS d'auth (décision ferme).
  Identité = profil local (nom en localStorage, avatar initiales). Stats = agrégats
  SQLite existants. Synchro éventuelle = intégration Libraryna future, app-à-app.
- Vue profil = vue pleine (vue 'profil' ajoutée au switch), entrée = ligne profil
  pied de sidebar (avatar+nom+chevron).
- Heatmap : 12 mois glissants, 52-53 colonnes × 7, semaine lundi, rampe ocre
  (5 niveaux : 0/1-14/15-29/30-59/60+ min), tooltips, labels mois en haut.
- Chips (4) : série actuelle+record, temps année, livres terminés année, jours
  actifs année. Pas de métrique "pages" (fausse en reflowable).
- T8a = stats:lecture() + vérification console ; T8b = UI vue profil.
- T8a VERTE (14/14 assertions, cohérence prouvée). Divergence temps:historique
  plafonné à 7 vs serieActuelle → soldée en T8b(0).
- T8b = vue profil complète :
  - (0) temps:historique étendu à 365 jours (même source que stats:lecture),
    widget streak s'aligne sur serieActuelle.
  - (1) Vue 'profil' ajoutée au switch bibliotheque|lecture|profil. Entrée = ligne
    profil pied de sidebar (avatar initiales + nom + chevron, clic → switch).
  - (2) Heatmap : 53 colonnes × 7, semaine lundi, labels Lun/Mer/Ven à gauche,
    labels mois en haut centrés, cellules 12×12px gap 3px radius 2px, palette ocre
    5 niveaux (clair/sombre distincte), tooltip survol avec date + minutes.
  - (3) Chips (4) : série actuelle+record, temps année formaté, livres terminés
    année, jours actifs année.
  - (4) Édition nom : double-clic inline, Enter sauvegarde, Escape annule, localStorage.
  - T8c = objectifs en en-tête (OUVERTE) : chip droite de la rangée d'en-tête
  bibliothèque = anneau 16px + n/N min + · x j + | n/N livres ; clic = popover
  Objectifs ré-ancré dessous ; tooltip libellés complets.
  Retirés : widget objectifs sidebar + icône cible sidebar (redondants).
  Pied sidebar = profil + thème seulement.
  Troncature fenêtre étroite : série puis annuel, anneau+minutes jamais.
  Hiérarchie actée : chip = coup d'œil, HUD = pendant lecture, profil = stats.