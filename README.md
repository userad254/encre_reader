# Encre

Encre est un lecteur EPUB pour Windows 10, au design « encre & papier ». Tout est local : vos livres, vos notes et vos statistiques restent sur votre machine.

## Méthode

Encre est spécifié, architecturé et validé par moi ; le code est produit par un agent d'exécution sous ma revue, mes critères d'acceptation et mon oracle de test. Le journal de décisions est public : DECISIONS.md.

## Pourquoi

Vos livres et vos notes ne quittent jamais votre machine. Pas de compte, pas de cloud, pas de télémétrie.

## Stack et build

Électron + TypeScript + React + foliate-js + SQLite (`better-sqlite3`).

```powershell
npm install
npm run dev
```

`npm run dist` produit l'installeur Windows (NSIS + portable) dans `out/`. La base SQLite vit dans `%APPDATA%/Encre` ; la bibliothèque créée en développement n'est pas migrée vers l'installation packagée.
