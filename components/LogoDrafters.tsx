// Logotipo DRAFTERS (11/10, elegido por Iñi: opción C): Bebas Neue (Google
// Fonts), letra condensada y fina, algo estirada en vertical; "DRAFT" en verde
// y "ERS" en blanco.
export default function LogoDrafters({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-label="Drafters"
      style={{
        display: 'inline-block',
        fontFamily: "'Bebas Neue', 'Barlow Condensed', sans-serif",
        fontWeight: 400,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '0em',
        transform: 'scaleY(1.1)',
        transformOrigin: 'center',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: '#3DDC84' }}>DRAFT</span>
      <span style={{ color: '#F5F7F5' }}>ERS</span>
    </span>
  );
}
