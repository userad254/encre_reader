// Shims de typage pour foliate-js (C3 : on utilise l'API PUBLIQUE, qui ne
// fournit pas de types TS — on déclare le minimum utilisé, rien de maison).
declare module 'foliate-js/view.js' {
  export function makeBook(fichier: File): Promise<unknown>;
}

declare module 'foliate-js/overlayer.js' {
  export const Overlayer: {
    highlight: unknown;
  };
}
