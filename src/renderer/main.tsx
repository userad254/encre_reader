import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import './global.css';
import { Bibliotheque, APP_NAME } from './Bibliotheque';
import { Lecteur, type DemandeOuverture } from './Lecteur';
import { Profil } from './Profil';
import type { LivreOuvert } from '../shared/types';

type Vue = 'bibliotheque' | 'lecture' | 'profil';
type Theme = 'clair' | 'sombre';

function lireThemeInitial(): Theme {
  try {
    const sauve = localStorage.getItem('encre-theme');
    if (sauve === 'sombre' || sauve === 'clair') return sauve;
  } catch {
    /* fallback clair */
  }
  return 'clair';
}

function App() {
  const [vue, setVue] = useState<Vue>('bibliotheque');
  const [demande, setDemande] = useState<DemandeOuverture | null>(null);
  const [theme, setTheme] = useState<Theme>(lireThemeInitial);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('encre-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  function basculerTheme(): void {
    setTheme((t) => (t === 'clair' ? 'sombre' : 'clair'));
  }

  function ouvrirEnLecture(choix: LivreOuvert, cfiCible?: string, reprendreDepuisDebut = false): void {
    setDemande({ ...choix, cfiCible, reprendreDepuisDebut, nonce: Date.now() });
    setVue('lecture');
  }

  if (vue === 'lecture') {
    return (
      <Lecteur
        ouvertureDemandee={demande}
        surRetourBiblio={() => setVue('bibliotheque')}
        themeInitial={theme}
        surChangerTheme={setTheme}
      />
    );
  }

  if (vue === 'profil') {
    return <Profil surRetour={() => setVue('bibliotheque')} />;
  }

  return (
    <Bibliotheque
      surOuvrirLivre={ouvrirEnLecture}
      theme={theme}
      surBasculerTheme={basculerTheme}
      surOuvrirProfil={() => setVue('profil')}
    />
  );
}

document.title = APP_NAME;
const racine = document.getElementById('root');
if (!racine) throw new Error('Racine #root introuvable.');
createRoot(racine).render(<App />);
