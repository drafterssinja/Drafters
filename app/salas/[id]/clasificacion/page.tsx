'use client';

import ClasificacionSala from '@/components/ClasificacionMesaGolf';

// Clasificación en directo de una mesa (fútbol, golf o tenis). Desde el 18/10
// la pantalla vive en components/ClasificacionMesaGolf.tsx para poder usarla
// también en los amistosos de golf de V2 (exactamente la misma).
export default function SalaClasificacionPage() {
  return <ClasificacionSala />;
}
