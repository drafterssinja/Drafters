'use client';

import { useRouter } from 'next/navigation';

// Flecha de "volver" reutilizada en todas las pantallas menos la principal
// (igual que en la maqueta visual, donde solo la portada y el "inicio" ya
// dentro de la cuenta no la llevan). Usa el historial del propio navegador,
// así que siempre vuelve a la pantalla de la que ha venido el usuario.
export default function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Volver"
      className="back-arrow"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
