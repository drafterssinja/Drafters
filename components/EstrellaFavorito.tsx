'use client';

import * as S from '@/lib/mockupStyles';

// Estrellita de favorito (nuevo, 02/10) — botón pequeño reutilizado en la
// fila de cada equipo de la clasificación de porras y maratones. Para en
// seco el click (preventDefault/stopPropagation) para que marcar/desmarcar
// favorito no seleccione también el equipo (la fila entera es un enlace
// clicable aparte).
export default function EstrellaFavorito({ activo, onToggle }: { activo: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-label={activo ? 'Quitar de favoritos' : 'Marcar como favorito'}
      title={activo ? 'Quitar de favoritos' : 'Marcar como favorito'}
      style={{
        flexShrink: 0,
        width: 16,
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1,
        color: activo ? '#F0B94D' : S.MUTED_3,
      }}
    >
      {activo ? '★' : '☆'}
    </button>
  );
}
