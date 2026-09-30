// ============================================================================
// ESCUDO DE UN EQUIPO DE FÚTBOL (porra por jornadas) — nuevo, 29/09
// ============================================================================
// Drafters no incluye ni aloja escudos oficiales de los clubes (uso de
// escudos/fotos con licencia, ver DRAFTERS_Costes_Business_Plan.md, queda
// para una fase de pago posterior) — el admin puede pegar opcionalmente una
// URL de imagen al cargar cada partido (app/admin/porras-futbol/[id]); si no
// lo hace, aquí se pinta un círculo con las iniciales del equipo en su
// lugar, mismo criterio visual que ya usan los avatares de jugador
// (inicialesJugador() en lib/salaShared.ts) o de usuario (S.iniciales()).
//
// <img> normal a propósito (no next/image): las URL las pega el admin sin
// que estén en un dominio conocido de antemano, así que no hay una lista de
// dominios que registrar en next.config.js.

export function inicialesEquipoFutbol(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0].charAt(0)}${partes[partes.length - 1].charAt(0)}`.toUpperCase();
}

export default function EscudoEquipoFutbol({ nombre, url, size = 30 }: { nombre: string; url: string | null | undefined; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={nombre}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#10150F', border: '1px solid #1E2723' }}
      />
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#1E2723',
        color: '#C9D2CC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: Math.round(size * 0.38),
        flexShrink: 0,
      }}
    >
      {inicialesEquipoFutbol(nombre)}
    </span>
  );
}
