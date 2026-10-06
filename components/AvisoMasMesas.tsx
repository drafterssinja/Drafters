// Aviso destacado de las listas de mesas (07/10, pedido de Iñi): "los avisos de
// las próximas mesas con más dinero se ven más grandes, con una etiqueta
// amarilla y una i de información" — en golf y en fútbol.
export default function AvisoMasMesas({ texto = 'Próximamente habrá más tipos de mesas y de más dinero.' }: { texto?: string }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'rgba(240,185,77,0.14)',
        border: '1.5px solid #F0B94D',
        borderRadius: 14,
        padding: '14px 16px',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#F0B94D',
          color: '#1A1405',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Manrope', sans-serif",
          fontWeight: 800,
          fontSize: 17,
          fontStyle: 'italic',
        }}
      >
        i
      </span>
      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, lineHeight: 1.4, color: '#F6D88A' }}>{texto}</span>
    </div>
  );
}
