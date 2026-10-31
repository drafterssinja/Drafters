'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoV2, { Panel, Titulo } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import { esDeporteV2, type DeporteV2 } from '@/components/v2/IconosV2';
import Cargando from '@/components/Cargando';
import { mensajeError } from '@/lib/v2';

// ============================================================================
// CREAR UNA LIGA PRIVADA (31/10, Iñi) — SQL 71 (lp_crear)
// ============================================================================
// Quien la crea pone el nombre y la contraseña. Luego él (y los administradores
// que nombre) publican la sala de cada jornada o torneo que quieran (SQL 72).
// No tiene final: la termina quien la crea.

const ICONO: Record<DeporteV2, string> = { futbol: '⚽', golf: '⛳', tenis: '🎾' };

function Crear() {
  const router = useRouter();
  const dp = useSearchParams().get('deporte') ?? 'futbol';
  const deporte: DeporteV2 = esDeporteV2(dp) ? dp : 'futbol';
  const { perfil, estado } = useSesionV2();
  const [nombre, setNombre] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setError(null);
    if (!nombre.trim()) return setError('Ponle un nombre a la liga.');
    if (!contrasena.trim()) return setError('Pon una contraseña: es lo que les pasarás a tus amigos para entrar.');
    setEnviando(true);
    const { data, error: e } = await supabase.rpc('lp_crear', {
      p: { nombre: nombre.trim(), deporte, contrasena: contrasena.trim() },
    });
    if (e || !data) {
      setError(mensajeError(e));
      setEnviando(false);
      return;
    }
    try {
      sessionStorage.setItem(`lp_clave_${data as string}`, contrasena.trim());
    } catch {}
    router.replace(`/v2/liga-privada/${data as string}?nueva=1`);
  }

  const etiqueta: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: S.MUTED_2, textTransform: 'uppercase', letterSpacing: '0.05em' };

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte={deporte} volverA={`/v2/${deporte}?modo=privadas`}>
      <Titulo>
        {ICONO[deporte]} Crear liga privada
      </Titulo>
      <span style={{ fontSize: 13, color: S.MUTED_2, lineHeight: 1.5, marginTop: -6 }}>
        Una liga solo para ti y tus amigos. Cada jornada hacéis equipo y, según cómo quedéis, sumáis puntos. No se acaba sola: la terminas tú cuando quieras.
      </span>

      <Panel style={{ gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={etiqueta}>Nombre de la liga</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} placeholder="La liga de los jueves" style={{ ...S.input, fontSize: 16 }} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={etiqueta}>Contraseña</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type={ver ? 'text' : 'password'} value={contrasena} onChange={(e) => setContrasena(e.target.value)} maxLength={40} autoComplete="off" autoCapitalize="none" placeholder="La que les pasarás a tus amigos" style={{ ...S.input, flex: 1, minWidth: 0, fontSize: 16 }} />
            <button type="button" onClick={() => setVer(!ver)} style={{ width: 'auto', padding: '0 12px', borderRadius: 10, border: `1px solid ${S.CARD_BORDER}`, background: 'transparent', color: S.MUTED, cursor: 'pointer', fontSize: 12.5 }}>
              {ver ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </label>
      </Panel>

      <Panel style={{ gap: 6 }}>
        <span style={S.sectionLabel}>Cómo se puntúa</span>
        <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.5 }}>
          Tú publicas la sala de cada {deporte === 'futbol' ? 'jornada (de LaLiga o de la Champions, la que queráis)' : 'torneo que elijáis'}, y puedes hacer administradores a otros para que también las publiquen. En cada sala juegan todos y se ordena a todos por los puntos de su equipo: si sois 8, el primero se lleva 8 puntos, el segundo 7… y el último 1. Quien no hace equipo, 0. Cada sala cuesta 1 crédito al hacer el equipo.
        </span>
      </Panel>

      {error && <p style={S.errorText}>{error}</p>}
      <button type="button" disabled={enviando} onClick={() => void crear()} style={{ ...S.primaryButton, opacity: enviando ? 0.6 : 1 }}>
        {enviando ? 'Creando…' : 'Crear liga'}
      </button>
    </MarcoV2>
  );
}

export default function CrearLigaPrivada() {
  return (
    <Suspense fallback={<Cargando />}>
      <Crear />
    </Suspense>
  );
}
