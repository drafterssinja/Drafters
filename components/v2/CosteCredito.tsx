'use client';

import { useState } from 'react';
import * as S from '@/lib/mockupStyles';
import { DEPORTE_NOMBRE, IconoCredito, type DeporteV2 } from '@/components/v2/IconosV2';
import { RecargaVideo, useCreditosV2 } from '@/components/v2/creditos';

// "Entrar cuesta 1 crédito" junto al botón de crear / unirse a un amistoso
// (16/10, Iñi: entrar en un amistoso cuesta 1 crédito Drafters, SQL 45). Si no
// te quedan, botón para ver un vídeo y recargarlos.
export function useSaldoCredito(deporte: DeporteV2) {
  const { creditos, recargar } = useCreditosV2(true);
  return { saldo: creditos ? creditos[deporte]?.saldo ?? 0 : null, recargar };
}

export default function CosteCredito({ deporte, accion = 'Entrar' }: { deporte: DeporteV2; accion?: string }) {
  const { saldo, recargar } = useSaldoCredito(deporte);
  const [video, setVideo] = useState(false);
  const sinCreditos = saldo !== null && saldo < 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: sinCreditos ? '#FF8A8A' : S.MUTED_2 }}>
        <IconoCredito size={20} />
        <span>
          {accion} cuesta <b style={{ color: S.TEXT }}>1 crédito de {DEPORTE_NOMBRE[deporte].toLowerCase()}</b>
          {saldo !== null && <> · te {saldo === 1 ? 'queda' : 'quedan'} <b style={{ color: sinCreditos ? '#FF8A8A' : S.ACCENT }}>{saldo}</b></>}
        </span>
      </div>
      {sinCreditos && (
        <button type="button" onClick={() => setVideo(true)} style={{ border: `1px solid ${S.ACCENT}`, background: 'rgba(61,220,132,0.1)', color: S.ACCENT, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
          ▶ Ver un vídeo y recargar créditos
        </button>
      )}
      {video && (
        <RecargaVideo
          deporte={deporte}
          onCerrar={() => setVideo(false)}
          onRecargado={() => {
            void recargar();
          }}
        />
      )}
    </div>
  );
}
