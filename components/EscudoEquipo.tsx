'use client';

import { useState } from 'react';
import * as S from '@/lib/mockupStyles';

// Escudo de un equipo con iniciales de reserva si la imagen no carga.
export default function EscudoEquipo({ url, nombre, tam = 26 }: { url: string | null; nombre: string; tam?: number }) {
  const [falla, setFalla] = useState(false);
  if (!url || falla) {
    return (
      <span
        title={nombre}
        style={{ width: tam, height: tam, flexShrink: 0, borderRadius: '50%', background: '#1E2723', color: S.MUTED_2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(8, tam * 0.36), fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}
      >
        {nombre.slice(0, 3).toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={nombre} title={nombre} width={tam} height={tam} onError={() => setFalla(true)} style={{ width: tam, height: tam, flexShrink: 0, objectFit: 'contain' }} />;
}
