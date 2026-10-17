'use client';

import { etiquetaTramo, etiquetaTramoCorta, esTramoCorte, diaDeTramo } from '@/lib/tramos';

// ============================================================================
// ETIQUETA "SOLO PARTIDOS DEL SÁBADO" / "SOLO LA RONDA 3" (17/10, Iñi)
// ============================================================================
// Va justo debajo del nombre de la mesa o del amistoso para que quede claro
// qué partidos o qué rondas cuentan. Con `completa` también se pinta la de
// "Jornada completa" / "Torneo completo".
export default function EtiquetaTramo({ tramo, deporte, partidos, compacta = false, completa = false }: { tramo: string | null | undefined; deporte: string; partidos?: number | null; compacta?: boolean; completa?: boolean }) {
  if (!tramo && !completa) return null;
  const dia = !!diaDeTramo(tramo);
  const color = !tramo ? '#8B958F' : dia ? '#5AB0FF' : esTramoCorte(tramo) ? '#F0B94D' : '#3DDC84';
  const icono = !tramo ? (deporte === 'golf' ? '🏌️' : '🗓️') : dia ? '📅' : '⛳';
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        maxWidth: '100%',
        fontSize: compacta ? 11 : 12,
        fontWeight: 800,
        color,
        background: `${color}1F`,
        border: `1px solid ${color}66`,
        borderRadius: 999,
        padding: compacta ? '2px 8px' : '4px 10px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span aria-hidden>{icono}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{compacta ? `${etiquetaTramoCorta(tramo ?? null, deporte)}${esTramoCorte(tramo) ? ' · tras el corte' : ''}` : etiquetaTramo(tramo ?? null, deporte, partidos)}</span>
    </span>
  );
}
