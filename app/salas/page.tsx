'use client';

import { useEffect, useMemo, useState, Suspense, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
};

type SortKey = 'nombre' | 'juego' | 'jugadores' | 'buyin';
type PlazasFiltro = 'cualquiera' | 'libres' | 'casi';

function SalasPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [deporte, setDeporte] = useState<Deporte>((searchParams.get('deporte') as Deporte) ?? 'futbol');
  const [tipo, setTipo] = useState<TipoSala | 'todas'>('todas');
  const [buyin, setBuyin] = useState<NivelBuyIn | 'cualquiera'>('cualquiera');
  const [plazas, setPlazas] = useState<PlazasFiltro>('cualquiera');
  const [sortKey, setSortKey] = useState<SortKey>('nombre');
  const [sortAsc, setSortAsc] = useState(true);

  const [salas, setSalas] = useState<SalaFila[]>([]);
  const [inscritosPorSala, setInscritosPorSala] = useState<Map<string, number>>(new Map());
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

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
        supabase
          .from('salas')
          .select('id,nombre,competicion,deporte,tipo,aforo,buy_in,estado')
          .neq('tipo', 'maraton')
          .neq('estado', 'finalizada'),
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
    let lista = salas.filter((s) => s.deporte === deporte);
    if (tipo !== 'todas') lista = lista.filter((s) => s.tipo === tipo);
    if (buyin !== 'cualquiera') lista = lista.filter((s) => nivelBuyIn(s.buy_in) === buyin);
    if (plazas === 'libres') lista = lista.filter((s) => s.estado === 'abierta');
    if (plazas === 'casi') lista = lista.filter((s) => s.estado === 'casi_llena');

    const conSignedUp = lista.map((s) => ({ ...s, signedUp: inscritosPorSala.get(s.id) ?? 0 }));

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

            {salasFiltradas.map((s) => {
              const estadoInfo = estadoSalaInfo(s.estado, s.aforo, s.signedUp);
              const juegoLabel = TIPO_SALA_LABELS[s.tipo as TipoSala] ?? s.tipo;
              return (
                <Link
                  key={s.id}
                  href={`/salas/${s.id}`}
                  style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, textDecoration: 'none' }}
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
                </Link>
              );
            })}
          </div>

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
