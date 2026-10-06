'use client';

import { useState } from 'react';
import * as S from '@/lib/mockupStyles';

// Escudo de un equipo con iniciales de reserva si la imagen no carga.
export default function EscudoEquipo({ url, nombre, tam = 26, alternativa = null }: { url: string | null; nombre: string; tam?: number; alternativa?: string | null }) {
  // 07/10: si la imagen guardada no carga se prueba la alternativa (mapa fijo de ESPN) antes de las iniciales.
  const [falla, setFalla] = useState(0);
  const lista = [url, alternativa].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
  const actual = lista[falla] ?? null;
  if (!actual) {
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
  return <img src={actual} alt={nombre} title={nombre} width={tam} height={tam} onError={() => setFalla((n) => n + 1)} style={{ width: tam, height: tam, flexShrink: 0, objectFit: 'contain' }} />;
}
