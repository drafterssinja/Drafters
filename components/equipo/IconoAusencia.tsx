// ============================================================================
// ICONO DE BAJA DE UN JUGADOR (05/11, Iñi)
// ============================================================================
// "Una cruz roja si no juega por lesión, una tarjeta roja si no juega por
// sanción y un ? si es duda." Datos de API-Football (lib/server/bajasFutbol.ts).

export type Ausencia = 'lesion' | 'sancion' | 'duda' | null | undefined;

export const TEXTO_AUSENCIA: Record<'lesion' | 'sancion' | 'duda', string> = { lesion: 'No juega (lesión)', sancion: 'No juega (sanción)', duda: 'Duda' };

export default function IconoAusencia({ tipo, motivo, size = 14 }: { tipo: Ausencia; motivo?: string | null; size?: number }) {
  if (!tipo) return null;
  const titulo = `${TEXTO_AUSENCIA[tipo]}${motivo ? ` · ${motivo}` : ''}`;
  if (tipo === 'lesion')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={titulo} style={{ flexShrink: 0 }}>
        <title>{titulo}</title>
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#fff" />
        <path d="M9.5 5h5v4.5H19v5h-4.5V19h-5v-4.5H5v-5h4.5z" fill="#E5383B" />
      </svg>
    );
  if (tipo === 'sancion')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={titulo} style={{ flexShrink: 0 }}>
        <title>{titulo}</title>
        <rect x="6" y="2.5" width="12.5" height="18" rx="2" fill="#E5383B" transform="rotate(12 12 12)" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={titulo} style={{ flexShrink: 0 }}>
      <title>{titulo}</title>
      <circle cx="12" cy="12" r="11" fill="#F0B94D" />
      <text x="12" y="17" textAnchor="middle" fontSize="15" fontWeight="800" fontFamily="Manrope, sans-serif" fill="#1A1405">
        ?
      </text>
    </svg>
  );
}
