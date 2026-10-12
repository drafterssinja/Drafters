import type { MetadataRoute } from 'next';

// 12/10 (Iñi): Drafters como app instalable (PWA) — botón "Añadir a Android"
// e instrucciones para iPhone (ver components/InstalarApp.tsx).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Drafters',
    short_name: 'Drafters',
    description: 'Fantasy de fútbol, golf y tenis: salas, porras y draft.',
    start_url: '/inicio',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0F0E',
    theme_color: '#0B0F0E',
    lang: 'es',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
