# Encre

Lecteur EPUB desktop pour Windows, basé sur Electron et foliate-js.

## Développement

```powershell
npm install
npm run dev
```

## Distribution Windows

```powershell
npm run dist
```

electron-builder génère les cibles NSIS et portable dans `out/`. Le packaging conserve `asar: true`, utilise l'ICO préconstruit `build/icon.ico` et laisse `npmRebuild` à sa valeur par défaut afin de reconstruire `better-sqlite3` pour l'ABI Electron. L'ICO committé contient les variantes PNG 16, 32, 48 et 256 px; le générateur one-off se relance avec `node scripts/build-icon.js` depuis le PNG source.

Si electron-builder échoue explicitement pendant le rebuild du module natif, exécuter `npx electron-rebuild -f -w better-sqlite3`, puis relancer `npm run dist`. Aucun rebuild forcé n'est ajouté au chemin normal.

Diagnostic icône confirmé (2026-10-02) : `build/icon.png` mesure 500×500 px, PNG RGBA 8 bits, 241755 octets. electron-builder 26.15.3 échouait à convertir ce PNG par son outil WASM (`WebAssembly.Memory(): could not allocate memory`); la génération utilise désormais `build/icon.ico` préconstruit et ne demande plus cette conversion.
Diagnostic logo2 (2026-10-03) : `build/icon.png` 1254×1254 px, channels=3 opaque, 611333 octets — plein carré fond noir sans coins arrondis, accepté (pas de fond cuit), `build/icon.ico` régénéré via `node scripts/build-icon.js` (16/32/48/256).

État de validation local (2026-10-02) : electron-builder 26.15.3 a recompilé `better-sqlite3` pour Electron 36.9.5 via son `npmRebuild` par défaut et a assemblé `out/win-unpacked`. Les deux tentatives de génération NSIS/portable ont échoué à la conversion PNG→ICO avant l'ajout de l'ICO préconstruit. La relance de `npm run dist` avec `build/icon.ico` est requise pour vérifier les deux artefacts et installer le NSIS.

## Audit npm (2026-10-02)

`npm audit` rapporte 7 avis : 6 high et 1 critical. `npm audit --omit=dev` rapporte 0 vulnérabilité dans le graphe runtime npm. Avis issus du graphe dev (non corrigés, outils de build) : `cacache` (high, transitif), `electron-rebuild` (high, direct), `extract-zip` (high, transitif), `make-fetch-happen` (high, transitif), `node-gyp` (high, transitif) et `tar` (critical, transitif).

Risque embarqué à signaler : `electron` est déclaré en `devDependencies` et donc absent du résultat `--omit=dev`, mais son binaire est le runtime de l'application distribuée. npm signale Electron high (version installée 36.9.5; advisory range inclut les versions jusqu'à 41.10.5). Non corrigé dans cette tâche; le NSIS embarquera ce runtime vulnérable jusqu'à une mise à niveau Electron distincte.

Les données installées sont conservées dans `%APPDATA%/Encre` (SQLite sous `userData`). La bibliothèque créée en développement n'est pas migrée automatiquement vers l'installation packagée.

## Content Security Policy

La politique du renderer limite scripts, images, styles et frames à l'application, avec `blob:`/`data:` uniquement pour les ressources EPUB et `blob:` pour les frames. `style-src blob:` est conservé car foliate-js charge la feuille CSS des sections EPUB depuis une URL blob; son absence produit réellement `Refused to load the stylesheet 'blob:…'` et empêche le rendu/mise en page du livre. Aucun relâchement de `script-src` n'est utilisé.

## Vérification après installation

Installer le NSIS produit, ouvrir un EPUB contenant une couverture et des images, vérifier la console DevTools pour les erreurs CSP, tester le thème sombre et créer un surlignage. Fermer puis rouvrir le livre et l'application : le surlignage et la position doivent être conservés. Vérifier également l'icône Encre sur l'exécutable, l'installeur et dans la barre de titre, ainsi que sa lisibilité à 16 px.
