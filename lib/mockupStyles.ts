import type { CSSProperties } from 'react';

// Estilos compartidos por las pantallas reales que reproducen la maqueta
// visual (Main.dc.html) — mismos tokens de color, tipografía y espaciado
// en todas, para no ir reinventando valores pantalla a pantalla.
export const ACCENT = '#3DDC84';
export const BG = '#0B0F0E';
export const PANEL = '#131917';
export const BORDER = '#2A3733';
export const CARD_BORDER = '#22302B';
export const TEXT = '#F5F7F5';
export const MUTED = '#AAB4AE';
export const MUTED_2 = '#8B958F';
export const MUTED_3 = '#6B756F';
export const FAINT = '#4E574F';
export const ERROR = '#FF5C5C';

// Envoltorio de página completo: reproduce el <div style="width:100%..."> de
// la maqueta, con el mismo ancho máximo tipo "app" que ya usa la portada.
export const pageFrame: CSSProperties = {
  width: '100%',
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: BG,
  maxWidth: 520,
  marginLeft: 'auto',
  marginRight: 'auto',
};

// Reset del <main> genérico de globals.css para las pantallas que usan su
// propio envoltorio a ancho completo (igual que la portada).
export const mainReset: CSSProperties = { maxWidth: 'none', margin: 0, padding: 0, display: 'block' };

export const centeredFormSection = (minHeight = 480): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  padding: '60px 24px',
  minHeight,
  justifyContent: 'center',
});

export const formSection: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  padding: '48px 24px 60px',
};

export const accountSection: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '24px 20px 40px',
};

export const fieldGroup: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };
export const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

export const label: CSSProperties = {
  fontFamily: "'Manrope', sans-serif",
  fontWeight: 600,
  fontSize: 13,
  color: MUTED,
};

export const input: CSSProperties = {
  width: '100%',
  background: PANEL,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: '14px 16px',
  fontFamily: "'Manrope', sans-serif",
  fontSize: 15,
  color: TEXT,
};

export const codeInput: CSSProperties = {
  ...input,
  fontFamily: "'Barlow Condensed', sans-serif",
  fontSize: 22,
  letterSpacing: '0.3em',
  textAlign: 'center',
};

export const selectInput: CSSProperties = { ...input, padding: '13px 16px', cursor: 'pointer' };

export const primaryButton: CSSProperties = {
  width: '100%',
  fontFamily: "'Barlow Condensed', sans-serif",
  fontWeight: 700,
  fontSize: 16,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: '#04140B',
  background: ACCENT,
  border: 'none',
  borderRadius: 10,
  padding: 14,
  minHeight: 44,
  cursor: 'pointer',
  marginTop: 4,
};

export const secondaryLinkButton: CSSProperties = {
  width: '100%',
  fontFamily: "'Barlow Condensed', sans-serif",
  fontWeight: 700,
  fontSize: 14,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: TEXT,
  background: 'transparent',
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: 13,
  minHeight: 44,
  cursor: 'pointer',
};

export const errorText: CSSProperties = { fontSize: 13, color: ERROR, margin: 0 };
export const infoText: CSSProperties = { fontSize: 13, color: ACCENT, margin: 0 };
export const footerNote: CSSProperties = { fontSize: 13, color: MUTED_2, textAlign: 'center' };

export const card: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  background: PANEL,
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: 12,
  padding: '14px 16px',
  textDecoration: 'none',
};

export const sectionLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: MUTED_2,
};

export const pill = (active: boolean): CSSProperties => ({
  fontFamily: "'Manrope', sans-serif",
  fontWeight: 700,
  fontSize: 11.5,
  padding: '6px 12px',
  borderRadius: 999,
  border: `1px solid ${active ? ACCENT : BORDER}`,
  background: active ? 'rgba(61,220,132,0.12)' : 'transparent',
  color: active ? ACCENT : MUTED,
  cursor: 'pointer',
});

// Iniciales para el avatar circular del header/Mi cuenta (mismo patrón que
// {{accountInitials}} en la maqueta).
export function iniciales(nombre?: string | null, apellido?: string | null): string {
  const n = (nombre ?? '').trim().charAt(0);
  const a = (apellido ?? '').trim().charAt(0);
  const resultado = `${n}${a}`.toUpperCase();
  return resultado || '·';
}
