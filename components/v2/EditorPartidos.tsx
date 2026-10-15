'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { V2_COLOR } from '@/components/v2/MarcoV2';
import { fechaCorta, mensajeError } from '@/lib/v2';

// ============================================================================
// ELEGIR LOS PARTIDOS DE UNA JORNADA (admin de la sala, 15/10)
// ============================================================================
// Iñi: los partidos de la primera jornada se eligen al crear la sala; los de
// las siguientes los elige el administrador cuando la jornada se publica.
// Solo mientras nadie haya hecho equipo para esa jornada (lo comprueba
// amistoso_elegir_partidos en el servidor). Sin tocar nada = todos.

type Partido = { local: string; visitante: string; kickoff: string | null };

export default function EditorPartidos({ amistosoId, competicion, actuales, onGuardado }: { amistosoId: string; competicion: string; actuales: { local: string; visitante: string }[] | null; onGuardado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [partidos, setPartidos] = useState<Partido[] | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clave = (p: { local: string; visitante: string }) => `${p.local}|${p.visitante}`;

  useEffect(() => {
    if (!abierto || partidos) return;
    void (async () => {
      const [{ data: cuotas }, { data: jornada }] = await Promise.all([
        supabase.from('cuotas_partido_futbol').select('equipo_local,equipo_visitante').eq('competicion', competicion),
        supabase.from('futbol_partidos_jornada').select('equipo_local,equipo_visitante,kickoff').eq('competicion', competicion),
      ]);
      const kick = new Map(((jornada as { equipo_local: string; equipo_visitante: string; kickoff: string | null }[]) ?? []).map((p) => [`${p.equipo_local}|${p.equipo_visitante}`, p.kickoff]));
      const lista = ((cuotas as { equipo_local: string; equipo_visitante: string }[]) ?? []).map((c) => ({ local: c.equipo_local, visitante: c.equipo_visitante, kickoff: kick.get(`${c.equipo_local}|${c.equipo_visitante}`) ?? null }));
      lista.sort((a, b) => (a.kickoff ?? '9').localeCompare(b.kickoff ?? '9'));
      setPartidos(lista);
      setOn(new Set(actuales ? actuales.map(clave) : lista.map(clave)));
    })();
  }, [abierto, partidos, competicion, actuales]);

  async function guardar() {
    if (!partidos) return;
    setError(null);
    const todos = on.size === partidos.length;
    const elegidos = partidos.filter((p) => on.has(clave(p)));
    if (elegidos.length === 0) return setError('Elige al menos un partido.');
    setGuardando(true);
    const { error: e } = await supabase.rpc('amistoso_elegir_partidos', {
      p_amistoso: amistosoId,
      p_competicion: competicion,
      p_equipos: todos ? null : elegidos.flatMap((p) => [p.local, p.visitante]),
      p_partidos: todos ? null : elegidos.map((p) => ({ local: p.local, visitante: p.visitante })),
    });
    setGuardando(false);
    if (e) return setError(mensajeError(e));
    setAbierto(false);
    onGuardado();
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: V2_COLOR, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>
        ⚙️ Elegir partidos de esta jornada
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: 12 }}>
      <span style={{ fontSize: 12, color: S.MUTED_2 }}>Solo se podrán elegir jugadores de los partidos marcados. Puedes cambiarlo hasta que alguien haga su equipo.</span>
      {partidos === null && <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Cargando partidos...</span>}
      {partidos !== null && partidos.length === 0 && <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Todavía no hay partidos cargados para esta jornada.</span>}
      {partidos !== null && partidos.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={S.pill(on.size === partidos.length)} onClick={() => setOn(new Set(partidos.map(clave)))}>
              Todos
            </button>
            <button type="button" style={S.pill(false)} onClick={() => setOn(new Set())}>
              Ninguno
            </button>
          </div>
          {partidos.map((p) => {
            const k = clave(p);
            const marcado = on.has(k);
            return (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: marcado ? S.TEXT : S.MUTED_3, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => {
                    const s = new Set(on);
                    if (marcado) s.delete(k);
                    else s.add(k);
                    setOn(s);
                  }}
                  style={{ accentColor: V2_COLOR, width: 18, height: 18 }}
                />
                <span style={{ flex: 1 }}>
                  {p.local} – {p.visitante}
                </span>
                {p.kickoff && <span style={{ fontSize: 11, color: S.MUTED_3 }}>{fechaCorta(p.kickoff)}</span>}
              </label>
            );
          })}
        </>
      )}
      {error && <p style={S.errorText}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={guardar} disabled={guardando || !partidos?.length} style={{ ...S.primaryButton, background: V2_COLOR, marginTop: 0, opacity: guardando ? 0.6 : 1 }}>
          {guardando ? 'Guardando...' : 'Guardar partidos'}
        </button>
        <button type="button" onClick={() => setAbierto(false)} style={S.secondaryLinkButton}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
