'use client';

import { useEffect, useMemo, useState, Suspense, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import {
  DEPORTES,
  Deporte,
  DEPORTE_LABELS,
  TIPOS_SALA_FIJA,
  TIPO_SALA_LABELS,
  BUYIN_LABELS,
  NivelBuyIn,
  nivelBuyIn,
  formatEuros,
  estadoSalaInfo,
  capacidadLabel,
} from '@/lib/salaShared';
import type { TipoSala } from '@/lib/repartoPremios';

// ============================================================================
// LISTADO DE SALAS (isSalas de Main.dc.html, líneas 563-632)
// ============================================================================
// Solo los 4 tipos de aforo fijo (Doble o Nada / Triple o Nada / Oro y Plata
// / Tridente) — Maratón vive aparte, en /mesas ("grandes torneos"), tal y
// como pidió Iñi (23/09). Los filtros de tipo y de buy-in de la maqueta
// (Duelo/Trío y los tramos "Hasta 25€/25-100€/+100€") se han adaptado a los
// 4 tipos y a los escalones de importe definitivos, manteniendo el mismo
// patrón visual y de interacción.

type SalaFila = {
  id: string;
  nombre: string;
  competicion: string;
  deporte: string;
  tipo: string;
  aforo: number | null;
  buy_in: number;
  estado: string;
  fecha_limite_inscripcion: string | null;
};

type SortKey = 'nombre' | 'juego' | 'jugadores' | 'buyin';
type PlazasFiltro = 'cualquiera' | 'libres' | 'casi';

// Orden por defecto del listado (pedido de Iñi, 25/09, hasta que se pulse
// una de las columnas de la cabecera): primero las salas a las que menos
// jugadores les faltan para completarse (aforo - inscritos, ascendente), y
// como segundo criterio de desempate, más dinero jugado primero (buy_in ×
// inscritos) — nunca sustituye al reordenado manual por columna, que sigue
// funcionando exactamente igual que antes; `sortKey` empieza en `null` para
// representar "todavía no se ha pulsado ninguna columna".

function SalasPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [deporte, setDeporte] = useState<Deporte>((searchParams.get('deporte') as Deporte) ?? 'futbol');
  const [tipo, setTipo] = useState<TipoSala | 'todas'>('todas');
  const [buyin, setBuyin] = useState<NivelBuyIn | 'cualquiera'>('cualquiera');
  const [plazas, setPlazas] = useState<PlazasFiltro>('cualquiera');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const [salas, setSalas] = useState<SalaFila[]>([]);
  const [inscritosPorSala, setInscritosPorSala] = useState<Map<string, number>>(new Map());
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  // Finalizadas (04/10, corrección de Iñi): no se ven de primeras al
  // entrar — se quedan plegadas detrás de un desplegable, que empieza
  // cerrado.
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const [{ data: perfilData }, { data: salasData }, { data: inscritosData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        // CAMBIO 04/10 (pedido de Iñi): antes esta consulta excluía del
        // todo las salas "finalizada" — ahora se traen todas y se separan
        // client-side (ver salasFiltradas/salasFinalizadasDelDeporte más
        // abajo), porque las finalizadas se quedan accesibles detrás de un
        // desplegable que empieza cerrado, con el botón "Clasificación
        // final" en vez de "Clasificación en directo".
        supabase.from('salas').select('id,nombre,competicion,deporte,tipo,aforo,buy_in,estado,fecha_limite_inscripcion').neq('tipo', 'maraton'),
        // RPC (no una select directa): equipos/inscripciones tienen RLS que
        // solo deja ver las filas propias — el número de inscritos de cada
        // sala es agregado y público. Ver drafters-schema.sql.
        supabase.rpc('inscritos_por_sala'),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);
      setSalas((salasData as SalaFila[]) ?? []);
      const mapaInscritos = new Map<string, number>();
      ((inscritosData as { sala_id: string; inscritos: number }[]) ?? []).forEach((fila) => mapaInscritos.set(fila.sala_id, Number(fila.inscritos)));
      setInscritosPorSala(mapaInscritos);
      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

  const salasFiltradas = useMemo(() => {
    let lista = salas.filter((s) => s.deporte === deporte && s.estado !== 'finalizada');
    if (tipo !== 'todas') lista = lista.filter((s) => s.tipo === tipo);
    if (buyin !== 'cualquiera') lista = lista.filter((s) => nivelBuyIn(s.buy_in) === buyin);
    if (plazas === 'libres') lista = lista.filter((s) => s.estado === 'abierta');
    if (plazas === 'casi') lista = lista.filter((s) => s.estado === 'casi_llena');

    const conSignedUp = lista.map((s) => ({ ...s, signedUp: inscritosPorSala.get(s.id) ?? 0 }));

    if (sortKey === null) {
      // Orden por defecto (25/09): menos plazas le faltan para completarse
      // primero; una sala sin aforo fijo (no debería darse aquí, Maratón se
      // excluye arriba) se manda al final en vez de romper el orden. Empate
      // a plazas restantes → más dinero jugado primero.
      conSignedUp.sort((a, b) => {
        const restantesA = a.aforo != null ? Math.max(0, a.aforo - a.signedUp) : Infinity;
        const restantesB = b.aforo != null ? Math.max(0, b.aforo - b.signedUp) : Infinity;
        if (restantesA !== restantesB) return restantesA - restantesB;
        const dineroA = a.buy_in * a.signedUp;
        const dineroB = b.buy_in * b.signedUp;
        return dineroB - dineroA;
      });
      return conSignedUp;
    }

    conSignedUp.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'nombre') cmp = a.nombre.localeCompare(b.nombre);
      else if (sortKey === 'juego') cmp = (TIPO_SALA_LABELS[a.tipo as TipoSala] ?? '').localeCompare(TIPO_SALA_LABELS[b.tipo as TipoSala] ?? '');
      else if (sortKey === 'jugadores') cmp = a.signedUp - b.signedUp;
      else if (sortKey === 'buyin') cmp = a.buy_in - b.buy_in;
      return sortAsc ? cmp : -cmp;
    });

    return conSignedUp;
  }, [salas, deporte, tipo, buyin, plazas, sortKey, sortAsc, inscritosPorSala]);

  // Finalizadas de este deporte (04/10, corrección de Iñi): aparte del todo
  // — no entran en el orden/filtro de arriba (no tendría sentido ordenarlas
  // por "plazas libres" o filtrarlas por buy-in), solo se listan detrás del
  // desplegable, de la más reciente a la más antigua.
  const salasFinalizadasDelDeporte = useMemo(() => {
    return salas
      .filter((s) => s.deporte === deporte && s.estado === 'finalizada')
      .map((s) => ({ ...s, signedUp: inscritosPorSala.get(s.id) ?? 0 }))
      .sort((a, b) => new Date(b.fecha_limite_inscripcion ?? 0).getTime() - new Date(a.fecha_limite_inscripcion ?? 0).getTime());
  }, [salas, deporte, inscritosPorSala]);

  function onSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return '';
    return sortAsc ? '▲' : '▼';
  }

  function headerColor(key: SortKey) {
    return sortKey === key ? '#F0B94D' : S.MUTED_3;
  }

  // Tarjeta de una sala (extraída a función — mismo motivo que
  // tarjetaPorra()/tarjetaMaraton() en app/porras/page.tsx y
  // app/mesas/page.tsx: se usa tanto en la lista filtrada de arriba como en
  // la de finalizadas, con el mismo diseño, cambiando solo el botón).
  function tarjetaSala(s: SalaFila & { signedUp: number }) {
    const estadoInfo = estadoSalaInfo(s.estado, s.aforo, s.signedUp);
    const juegoLabel = TIPO_SALA_LABELS[s.tipo as TipoSala] ?? s.tipo;
    // Empezada (03/10, pedido de Iñi: "en las mesas y en las
    // porras que ya están empezadas... tiene que haber un botón
    // para ir directamente a la clasificación") — mismo criterio
    // que salaEmpezada en app/salas/[id]/page.tsx: la fecha
    // límite ya ha pasado (el estado no cambia solo hasta
    // liquidarla).
    const empezada = !!s.fecha_limite_inscripcion && new Date(s.fecha_limite_inscripcion).getTime() <= Date.now();
    const esFinalizada = s.estado === 'finalizada';
    const mostrarBotonClasificacion = esFinalizada || empezada;
    const textoBotonClasificacion = esFinalizada ? 'Clasificación final' : 'Clasificación en directo';
    return (
      <div
        key={s.id}
        onClick={() => router.push(`/salas/${s.id}`)}
        style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{s.nombre}</span>
          <span
            style={{
              flexShrink: 0,
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 700,
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: '#F0B94D',
              background: 'rgba(240,185,77,0.12)',
              border: '1px solid rgba(240,185,77,0.3)',
              borderRadius: 999,
              padding: '3px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {s.competicion}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: estadoInfo.color }}>{estadoInfo.label}</span>
          <span style={{ flexShrink: 0, width: 84, textAlign: 'center', fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 10.5, lineHeight: 1.2, color: S.MUTED_2 }}>{juegoLabel}</span>
          <span style={{ flexShrink: 0, width: 42, textAlign: 'center', fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, color: S.MUTED }}>
            {s.signedUp}/{capacidadLabel(s.aforo)}
          </span>
          <span style={{ flexShrink: 0, width: 58, textAlign: 'right', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#F0B94D' }}>{formatEuros(s.buy_in)}</span>
        </div>
        {mostrarBotonClasificacion && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/salas/${s.id}/clasificacion`);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                color: '#FF7A45',
                background: 'rgba(255,122,69,0.14)',
                border: '1px solid rgba(255,122,69,0.45)',
                borderRadius: 8,
                padding: '6px 10px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF7A45', flexShrink: 0 }} />
              {textoBotonClasificacion}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={perfil ? formatEuros(perfil.saldo_simulado) : '···'} accountInitials={perfil ? S.iniciales(perfil.nombre, perfil.apellido) : '·'} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '32px 20px 56px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT }}>Salas</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Doble o Nada, Triple o Nada, Oro y Plata y Tridente.</p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {DEPORTES.map((d) => (
              <button key={d} type="button" onClick={() => setDeporte(d)} style={pillButtonStyle(deporte === d)}>
                {DEPORTE_LABELS[d]}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={S.sectionLabel}>Tipo de sala</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" onClick={() => setTipo('todas')} style={pillButtonStyle(tipo === 'todas')}>
                Todas
              </button>
              {TIPOS_SALA_FIJA.map((t) => (
                <button key={t} type="button" onClick={() => setTipo(t)} style={pillButtonStyle(tipo === t)}>
                  {TIPO_SALA_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={S.sectionLabel}>Buy-in</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" onClick={() => setBuyin('cualquiera')} style={pillButtonStyle(buyin === 'cualquiera')}>
                Cualquiera
              </button>
              {(Object.keys(BUYIN_LABELS) as NivelBuyIn[]).map((nivel) => (
                <button key={nivel} type="button" onClick={() => setBuyin(nivel)} style={pillButtonStyle(buyin === nivel)}>
                  {BUYIN_LABELS[nivel]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={S.sectionLabel}>Jugadores inscritos</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" onClick={() => setPlazas('cualquiera')} style={pillButtonStyle(plazas === 'cualquiera')}>
                Cualquiera
              </button>
              <button type="button" onClick={() => setPlazas('libres')} style={pillButtonStyle(plazas === 'libres')}>
                Con plazas libres
              </button>
              <button type="button" onClick={() => setPlazas('casi')} style={pillButtonStyle(plazas === 'casi')}>
                Casi llenas
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}>
              <button type="button" onClick={() => onSort('nombre')} style={{ ...sortHeaderStyle, flex: 1, minWidth: 0, textAlign: 'left', color: headerColor('nombre') }}>
                Nombre de sala <span style={{ fontSize: 9 }}>{sortIcon('nombre')}</span>
              </button>
              <button type="button" onClick={() => onSort('juego')} style={{ ...sortHeaderStyle, flexShrink: 0, width: 84, justifyContent: 'center', color: headerColor('juego') }}>
                Tipo <span style={{ fontSize: 9 }}>{sortIcon('juego')}</span>
              </button>
              <button type="button" onClick={() => onSort('jugadores')} style={{ ...sortHeaderStyle, flexShrink: 0, width: 42, justifyContent: 'center', color: headerColor('jugadores') }}>
                Jug. <span style={{ fontSize: 9 }}>{sortIcon('jugadores')}</span>
              </button>
              <button type="button" onClick={() => onSort('buyin')} style={{ ...sortHeaderStyle, flexShrink: 0, width: 58, justifyContent: 'flex-end', color: headerColor('buyin') }}>
                Buy-in <span style={{ fontSize: 9 }}>{sortIcon('buyin')}</span>
              </button>
            </div>

            {cargando && <p style={{ fontSize: 13, color: S.MUTED_2, padding: '0 14px' }}>Cargando salas...</p>}
            {!cargando && salasFiltradas.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2, padding: '0 14px' }}>No hay salas que encajen con estos filtros.</p>}

            {salasFiltradas.map((s) => tarjetaSala(s))}
          </div>

          {/* CAMBIO 04/10 (corrección de Iñi): al entrar, las salas
              finalizadas NO se ven — se quedan detrás de un desplegable que
              empieza cerrado, fuera de los filtros/orden de arriba (no
              tendría sentido filtrarlas por "plazas libres" o buy-in), con
              el botón "Clasificación final" en vez de "Clasificación en
              directo" — ver tarjetaSala() más arriba. */}
          {salasFinalizadasDelDeporte.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={() => setMostrarFinalizadas((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  alignSelf: 'flex-start',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: S.MUTED_3,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 10, transform: mostrarFinalizadas ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
                Finalizadas ({salasFinalizadasDelDeporte.length})
              </button>
              {mostrarFinalizadas && salasFinalizadasDelDeporte.map((s) => tarjetaSala(s))}
            </div>
          )}

          <span style={{ fontSize: 11, color: S.FAINT }}>*Importes en euros — Fase 1, saldo simulado.</span>
        </div>
      </div>
    </main>
  );
}

function pillButtonStyle(active: boolean): CSSProperties {
  return {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    padding: '9px 16px',
    borderRadius: 999,
    border: `1px solid ${active ? '#3DDC84' : S.BORDER}`,
    background: active ? 'rgba(61,220,132,0.12)' : 'transparent',
    color: active ? '#3DDC84' : S.MUTED,
    cursor: 'pointer',
  };
}

const sortHeaderStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  fontFamily: "'Manrope', sans-serif",
  fontWeight: 700,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function SalasPage() {
  return (
    <Suspense fallback={null}>
      <SalasPageInner />
    </Suspense>
  );
}
