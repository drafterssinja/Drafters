import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import RegistrarServiceWorker from '@/components/RegistrarServiceWorker';

export const metadata: Metadata = {
  title: 'Drafters',
  description: 'Drafters — plataforma de fantasy sports',
  // 12/10: icono y nombre al añadirla a la pantalla de inicio del iPhone.
  appleWebApp: { capable: true, title: 'Drafters', statusBarStyle: 'black' },
};

export const viewport: Viewport = {
  themeColor: '#0B0F0E',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>
        {children}
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
