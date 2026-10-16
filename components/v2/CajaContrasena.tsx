'use client';

import { useState } from 'react';
import * as S from '@/lib/mockupStyles';
import { IconoCandado } from '@/components/v2/IconosV2';

// Caja para escribir la contraseña de una sala privada (16/10, Iñi: "tiene que
// estar para tontos"): bien grande, explicada, con quién te la puede dar y un
// botón para ver lo que escribes.
const V2 = '#A78BFA';

export default function CajaContrasena({ valor, onChange, onEnter, creador }: { valor: string; onChange: (v: string) => void; onEnter: () => void; creador: string | null }) {
  const [ver, setVer] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(167,139,250,0.10)', border: `2px solid ${V2}`, borderRadius: 14, padding: 14 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, color: S.TEXT }}>
        <IconoCandado size={18} /> Esta sala es privada
      </span>
      <span style={{ fontSize: 13.5, color: S.MUTED, lineHeight: 1.5 }}>
        Para entrar tienes que <b style={{ color: S.TEXT }}>escribir la contraseña</b> aquí abajo. Si no la tienes, pídesela a <b style={{ color: S.TEXT }}>@{creador ?? 'quien creó la sala'}</b>.
      </span>
      <label htmlFor="contrasena-sala" style={{ fontSize: 12, fontWeight: 800, color: V2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        👇 Contraseña
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="contrasena-sala"
          type={ver ? 'text' : 'password'}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valor.trim()) onEnter();
          }}
          placeholder="Escríbela aquí"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{ ...S.input, flex: 1, minWidth: 0, fontSize: 18, fontWeight: 700, padding: '16px 14px', background: '#0B0F0E', border: `2px solid ${valor ? S.ACCENT : V2}`, borderRadius: 12, color: S.TEXT }}
        />
        <button
          type="button"
          onClick={() => setVer(!ver)}
          aria-label={ver ? 'Ocultar contraseña' : 'Ver contraseña'}
          style={{ flexShrink: 0, border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.MUTED, borderRadius: 12, padding: "0 14px", height: 56, fontSize: 20, fontWeight: 700, cursor: 'pointer' }}
        >
          {ver ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );
}
