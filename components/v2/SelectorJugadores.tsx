'use client';

import { useState } from 'react';
import * as S from '@/lib/mockupStyles';

// Número de jugadores de un amistoso (16/10, Iñi): 2 a 10 con botones y,
// detrás de "Más", una casilla que solo admite números (hasta 100).
export const MAX_JUGADORES_AMISTOSO = 100;

export default function SelectorJugadores({ valor, onChange, minimo = 2 }: { valor: number; onChange: (n: number) => void; minimo?: number }) {
  const [mas, setMas] = useState(valor > 10);
  const [texto, setTexto] = useState(valor > 10 ? String(valor) : '');
  const pill = (on: boolean) => ({ ...S.pill(on), minWidth: 40, textAlign: 'center' as const });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
          <button
            key={n}
            type="button"
            disabled={n < minimo}
            style={{ ...pill(!mas && valor === n), opacity: n < minimo ? 0.35 : 1 }}
            onClick={() => {
              setMas(false);
              onChange(n);
            }}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          style={pill(mas)}
          onClick={() => {
            setMas(true);
            const n = Math.max(11, minimo, Number(texto) || 11);
            setTexto(String(n));
            onChange(n);
          }}
        >
          Más
        </button>
      </div>
      {mas && (
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={texto}
          onChange={(e) => {
            const limpio = e.target.value.replace(/\D/g, '').slice(0, 3);
            setTexto(limpio);
            const n = Number(limpio);
            if (n >= Math.max(2, minimo) && n <= MAX_JUGADORES_AMISTOSO) onChange(n);
          }}
          placeholder="Número de jugadores"
          style={{ ...S.input, width: 170 }}
        />
      )}
      {mas && (Number(texto) < Math.max(2, minimo) || Number(texto) > MAX_JUGADORES_AMISTOSO) && (
        <span style={{ fontSize: 12, color: '#FF8A8A' }}>Entre {Math.max(2, minimo)} y {MAX_JUGADORES_AMISTOSO}.</span>
      )}
    </div>
  );
}
