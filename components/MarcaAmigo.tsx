// Identificativo de "es tu amigo" en la liga y otras listas (16/10, Iñi).
export default function MarcaAmigo({ compacta = false }: { compacta?: boolean }) {
  return (
    <span
      title="Es tu amigo"
      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: compacta ? 9.5 : 10.5, fontWeight: 800, color: '#7AA7FF', background: 'rgba(122,167,255,0.14)', border: '1px solid rgba(122,167,255,0.45)', borderRadius: 999, padding: compacta ? '1px 6px' : '2px 8px', textTransform: 'uppercase', letterSpacing: '0.03em', marginLeft: 6, verticalAlign: 'middle' }}
    >
      👥 Amigo
    </span>
  );
}
