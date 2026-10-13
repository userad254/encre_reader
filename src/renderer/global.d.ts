import type { ApiLecteur } from '../shared/types';

// window.api est injecté par le preload (seul pont IPC, contextIsolation).
declare global {
  interface Window {
    api: ApiLecteur;
  }
}

export {};
