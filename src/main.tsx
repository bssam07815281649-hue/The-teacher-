import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { listenForPwaInstall } from './services/pwaInstall';

listenForPwaInstall();

createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void (async () => {
      try {
        const base = import.meta.env.BASE_URL;
        const registration = await navigator.serviceWorker.register(base + 'sw.js', { scope: base });
        const home = new URL(base, location.origin).href;
        const resources = performance.getEntriesByType('resource')
          .map(item => item.name)
          .filter(url => url.startsWith(location.origin) && !url.includes('/api/'));
        const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"],link[rel="modulepreload"]')).map(e => e.href);
        const urls = Array.from(new Set([home, location.href.split('#')[0], ...resources, ...links]));
        const worker = registration.active || registration.waiting || registration.installing;
        if (worker?.state === 'activated') worker.postMessage({type:'CACHE_STATIC',urls});
        else worker?.addEventListener('statechange', () => {
          if (worker.state === 'activated') worker.postMessage({type:'CACHE_STATIC',urls});
        });
      } catch (error) {
        console.warn('Offline app-shell cache unavailable:', error);
      }
    })();
  });
}
