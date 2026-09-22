import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Drafters',
  description: 'Drafters — plataforma de fantasy sports',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
