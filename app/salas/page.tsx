'use client';

import { useEffect, useMemo, useState, Suspense, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import AvisoMasMesas from '@/components/AvisoMasMesas';
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
  // 'pga' | 'eur' en golf (sql_futbol_auto_jornadas.sql); null en lo demás.
  circuito?: string | null;
};

// 06/10 (Iñi): al entrar en un deporte salen pestañas de competición y, debajo,
// un desplegable con los torneos/jornadas que ya tienen mesas (y por tanto
// horarios confirmados). Fútbol: La Liga y Champions (la Premier se añadirá
// cuando toque — basta con descomentar la línea). Golf: PGA Tour y DP World
// Tour. Tenis: sin pestañas, solo los torneos.
const PESTANAS_COMPETICION: Record<Deporte, { id: string; label: string }[]> = {
  futbol: [
    { id: 'laliga', label: 'La Liga' },
    // { id: 'premier', label: 'Premier' },
    { id: 'champions', label: 'Champions' },
  ],
  golf: [
    { id: 'pga', label: 'PGA Tour' },
    { id: 'eur', label: 'DP World Tour' },
  ],
  tenis: [],
};

function circuitoDeSala(s: SalaFila): string | null {
  if (s.deporte === 'futbol') {
    if (/^la\s*liga/i.test(s.competicion)) return 'laliga';
    if (/^champions/i.test(s.competicion)) return 'champions';
    if (/^premier/i.test(s.competicion)) return 'premier';
    return null;
  }
  if (s.deporte === 'golf') return s.circuito ?? null;
  return null;
}

// Una sala de golf sin circuito conocido (creada a mano antes de existir la
// columna) se muestra en ambas pestañas en vez de desaparecer.
function encajaEnPestana(s: SalaFila, pestana: string | null): boolean {
  if (pestana === null) return true;
  const c = circuitoDeSala(s);
  if (c === null) return s.deporte === 'golf';
  return c === pestana;
}

function etiquetaCompeticion(competicion: string, deporte: string): string {
  if (deporte === 'futbol') {
    const m = competicion.match(/Jornada\s+(\d+)/i);
    if (m) return `Jornada ${m[1]}`;
  }
  return competicion;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
  } catch {
    return '';
  }
}

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
  const deporteParam = searchParams.get('deporte');
  const deporteInicial: Deporte = (DEPORTES as readonly string[]).includes(deporteParam ?? '') ? (deporteParam as Deporte) : 'futbol';

  const [deporte, setDeporte] = useState<Deporte>(deporteInicial);
  const [tipo, setTipo] = useState<TipoSala | 'todas'>('todas');
  const [buyin, setBuyin] = useState<NivelBuyIn | 'cualquiera'>('cualquiera');
  const [plazas, setPlazas] = useState<PlazasFiltro>('cualquiera');
  const [filtroAbierto, setFiltroAbierto] = useState<'tipo' | 'buyin' | 'plazas' | null>(null);
  const [pestana, setPestana] = useState<string | null>(PESTANAS_COMPETICION[deporteInicial][0]?.id ?? null);
  const [competicionElegida, setCompeticionElegida] = useState<string | null>(null);
  const [torneoAbierto, setTorneoAbierto] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const [salas, setSalas] = useState<SalaFila[]>([]);
  const [inscritosPorSala, setInscritosPorSala] = useState<Map<string, number>>(new Map());
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  // Finalizadas (04/10, corrección de Iñi): no se ven de primeras al
  // entrar — se quedan plegadas detrás de un desplegable, que empieza
  // cerrado.

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

      const columnasSalas = 'id,nombre,competicion,deporte,tipo,aforo,buy_in,estado,fecha_limite_inscripcion';
      const [{ data: perfilData }, salasRes, { data: inscritosData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        // CAMBIO 04/10 (pedido de Iñi): antes esta consulta excluía del
        // todo las salas "finalizada" — ahora se traen todas y se separan
        // client-side (ver salasFiltradas/salasFinalizadasDelDeporte más
        // abajo), porque las finalizadas se quedan accesibles detrás de un
        // desplegable que empieza cerrado, con el botón "Clasificación
        // final" en vez de "Clasificación en directo".
        supabase.from('salas').select(`${columnasSalas},circuito`),
        // RPC (no una select directa): equipos/inscripciones tienen RLS que
        // solo deja ver las filas propias — el número de inscritos de cada
        // sala es agregado y público. Ver drafters-schema.sql.
        supabase.rpc('inscritos_por_sala'),
      ]);

      // Si todavía no se ha ejecutado sql_futbol_auto_jornadas.sql la columna
      // "circuito" no existe: se vuelve a pedir sin ella para no romper la pantalla.
      let salasData = salasRes.data as SalaFila[] | null;
      if (salasRes.error) {
        const reintento = await supabase.from('salas').select(columnasSalas);
        salasData = reintento.data as SalaFila[] | null;
      }

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);
      // 09/10 (Iñi): los Maratones ya no se enseñan en las salas Drafters.
      setSalas((salasData ?? []).filter((s) => s.tipo !== 'maraton'));
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

  function cambiarDeporte(d: Deporte) {
    setDeporte(d);
    setPestana(PESTANAS_COMPETICION[d][0]?.id ?? null);
    setCompeticionElegida(null);
    setTorneoAbierto(false);
    setFiltroAbierto(null);
  }

  // Torneos/jornadas con mesas abiertas (aún no finalizadas) del deporte y la
  // pestaña actuales, de la más próxima a la más lejana. Como las mesas solo
  // se crean cuando los horarios están confirmados, esta lista es justo "las
  // jornadas con horarios confirmados".
  const competicionesDisponibles = useMemo(() => {
    const mapa = new Map<string, { competicion: string; primera: string | null }>();
    for (const s of salas) {
      if (s.deporte !== deporte || s.estado === 'finalizada' || !encajaEnPestana(s, pestana)) continue;
      const previa = mapa.get(s.competicion);
      if (!previa) mapa.set(s.competicion, { competicion: s.competicion, primera: s.fecha_limite_inscripcion });
      else if (s.fecha_limite_inscripcion && (!previa.primera || s.fecha_limite_inscripcion < previa.primera)) previa.primera = s.fecha_limite_inscripcion;
    }
    return Array.from(mapa.values()).sort((a, b) => {
      if (!a.primera && !b.primera) return a.competicion.localeCompare(b.competicion);
      if (!a.primera) return 1;
      if (!b.primera) return -1;
      return a.primera.localeCompare(b.primera);
    });
  }, [salas, deporte, pestana]);

  // Por defecto, la siguiente que todavía admite inscripciones (si la 8 ya se
  // ha jugado, sale la 9); si no queda ninguna por empezar, la primera de la lista.
  const competicionActual = useMemo(() => {
    if (competicionElegida && competicionesDisponibles.some((c) => c.competicion === competicionElegida)) return competicionElegida;
    const ahora = Date.now();
    const siguiente = competicionesDisponibles.find((c) => c.primera && new Date(c.primera).getTime() > ahora);
    return (siguiente ?? competicionesDisponibles[0])?.competicion ?? null;
  }, [competicionElegida, competicionesDisponibles]);

  const salasFiltradas = useMemo(() => {
    let lista = salas.filter((s) => s.deporte === deporte && s.estado !== 'finalizada' && encajaEnPestana(s, pestana) && s.competicion === competicionActual);
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
  }, [salas, deporte, pestana, competicionActual, tipo, buyin, plazas, sortKey, sortAsc, inscritosPorSala]);

  // Finalizadas de este deporte (04/10, corrección de Iñi): aparte del todo
  // — no entran en el orden/filtro de arriba (no tendría sentido ordenarlas
  // por "plazas libres" o filtrarlas por buy-in), solo se listan detrás del
  // desplegable, de la más reciente a la más antigua.
  const salasFinalizadasDelDeporte = useMemo(() => {
    return salas
      .filter((s) => s.deporte === deporte && s.estado === 'finalizada' && encajaEnPestana(s, pestana))
      .map((s) => ({ ...s, signedUp: inscritosPorSala.get(s.id) ?? 0 }))
      .sort((a, b) => new Date(b.fecha_limite_inscripcion ?? 0).getTime() - new Date(a.fecha_limite_inscripcion ?? 0).getTime());
  }, [salas, deporte, pestana, inscritosPorSala]);

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

  const PLAZAS_LABELS: Record<PlazasFiltro, string> = { cualquiera: 'Cualquiera', libres: 'Con plazas libres', casi: 'Casi llenas' };
  const filtrosDesplegables: {
    id: 'tipo' | 'buyin' | 'plazas';
    titulo: string;
    activo: boolean;
    opciones: { valor: string; etiqueta: string; seleccionada: boolean; aplicar: () => void }[];
  }[] = [
    {
      id: 'tipo',
      titulo: tipo === 'todas' ? 'Tipo de sala' : TIPO_SALA_LABELS[tipo],
      activo: tipo !== 'todas',
      opciones: [
        { valor: 'todas', etiqueta: 'Todas', seleccionada: tipo === 'todas', aplicar: () => setTipo('todas') },
        ...TIPOS_SALA_FIJA.map((t) => ({ valor: t, etiqueta: TIPO_SALA_LABELS[t], seleccionada: tipo === t, aplicar: () => setTipo(t) })),
      ],
    },
    {
      id: 'buyin',
      titulo: buyin === 'cualquiera' ? 'Buy-in' : BUYIN_LABELS[buyin],
      activo: buyin !== 'cualquiera',
      opciones: [
        { valor: 'cualquiera', etiqueta: 'Cualquiera', seleccionada: buyin === 'cualquiera', aplicar: () => setBuyin('cualquiera') },
        ...(Object.keys(BUYIN_LABELS) as NivelBuyIn[]).map((nivel) => ({
          valor: nivel,
          etiqueta: BUYIN_LABELS[nivel],
          seleccionada: buyin === nivel,
          aplicar: () => setBuyin(nivel),
        })),
      ],
    },
    {
      id: 'plazas',
      titulo: plazas === 'cualquiera' ? 'Jugadores' : PLAZAS_LABELS[plazas],
      activo: plazas !== 'cualquiera',
      opciones: (['cualquiera', 'libres', 'casi'] as PlazasFiltro[]).map((p) => ({
        valor: p,
        etiqueta: PLAZAS_LABELS[p],
        seleccionada: plazas === p,
        aplicar: () => setPlazas(p),
      })),
    },
  ];

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={perfil ? formatEuros(perfil.saldo_simulado) : '···'} accountInitials={perfil ? S.iniciales(perfil.nombre, perfil.apellido) : '·'} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '32px 20px 56px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT }}>Salas de {DEPORTE_LABELS[deporte].toLowerCase()}</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Doble o Nada, Triple o Nada, Oro y Plata y Tridente.</p>
          </div>

          {/* 06/10 (Iñi): el deporte ya se elige en /mesas, así que aquí NO hay filtro de deporte arriba; cada deporte muestra sus propias competiciones. */}

          {/* 06/10 (Iñi): pestañas de competición (fútbol y golf) y desplegable
              de jornada/torneo con los que ya tienen horarios confirmados. */}
          {PESTANAS_COMPETICION[deporte].length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              {PESTANAS_COMPETICION[deporte].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setPestana(t.id);
                    setCompeticionElegida(null);
                    setTorneoAbierto(false);
                  }}
                  style={{ ...pillButtonStyle(pestana === t.id), flex: 1, width: 'auto', minWidth: 0, padding: '13px 10px', fontSize: 17, whiteSpace: 'nowrap' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              disabled={competicionesDisponibles.length === 0}
              onClick={() => {
                setTorneoAbierto(!torneoAbierto);
                setFiltroAbierto(null);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '11px 14px',
                borderRadius: 12,
                border: `1px solid ${torneoAbierto ? '#3DDC84' : S.BORDER}`,
                background: 'rgba(255,255,255,0.03)',
                color: S.TEXT,
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                cursor: competicionesDisponibles.length === 0 ? 'default' : 'pointer',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                {competicionActual
                  ? `${etiquetaCompeticion(competicionActual, deporte)}${(() => {
                      const f = fechaCorta(competicionesDisponibles.find((c) => c.competicion === competicionActual)?.primera ?? null);
                      return f ? ` · ${f}` : '';
                    })()}`
                  : deporte === 'futbol'
                    ? 'Sin jornadas con horarios confirmados todavía'
                    : deporte === 'golf'
                      ? 'Sin torneos todavía'
                      : 'Sin torneos todavía'}
              </span>
              <span style={{ fontSize: 9, flexShrink: 0, color: S.MUTED }}>{torneoAbierto ? '▲' : '▼'}</span>
            </button>
            {torneoAbierto && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  zIndex: 25,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: 6,
                  borderRadius: 12,
                  border: `1px solid ${S.BORDER}`,
                  background: '#101614',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                  maxHeight: 320,
                  overflowY: 'auto',
                }}
              >
                {competicionesDisponibles.map((c) => {
                  const sel = c.competicion === competicionActual;
                  const empezada = c.primera ? new Date(c.primera).getTime() <= Date.now() : false;
                  return (
                    <button
                      key={c.competicion}
                      type="button"
                      onClick={() => {
                        setCompeticionElegida(c.competicion);
                        setTorneoAbierto(false);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: sel ? 'rgba(61,220,132,0.12)' : 'transparent',
                        color: sel ? '#3DDC84' : S.TEXT,
                        fontFamily: "'Manrope', sans-serif",
                        fontWeight: sel ? 700 : 500,
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span>{etiquetaCompeticion(c.competicion, deporte)}</span>
                      <span style={{ fontSize: 12, color: empezada ? '#F0B94D' : S.MUTED_2, flexShrink: 0 }}>{empezada ? 'En juego' : fechaCorta(c.primera)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 06/10 (Iñi): los tres filtros van en UNA fila de pestañitas
              desplegables, cerradas hasta que se pulsan. Al elegir una opción
              se aplica el filtro y el desplegable se cierra. */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {filtrosDesplegables.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFiltroAbierto(filtroAbierto === f.id ? null : f.id);
                    setTorneoAbierto(false);
                  }}
                  style={chipFiltroStyle(f.activo, filtroAbierto === f.id)}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.titulo}</span>
                  <span style={{ fontSize: 9, flexShrink: 0 }}>{filtroAbierto === f.id ? '▲' : '▼'}</span>
                </button>
              ))}
            </div>
            {filtroAbierto && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: 6,
                  borderRadius: 12,
                  border: `1px solid ${S.BORDER}`,
                  background: '#101614',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                }}
              >
                {filtrosDesplegables
                  .find((f) => f.id === filtroAbierto)!
                  .opciones.map((o) => (
                    <button
                      key={o.valor}
                      type="button"
                      onClick={() => {
                        o.aplicar();
                        setFiltroAbierto(null);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: o.seleccionada ? 'rgba(61,220,132,0.12)' : 'transparent',
                        color: o.seleccionada ? '#3DDC84' : S.TEXT,
                        fontFamily: "'Manrope', sans-serif",
                        fontWeight: o.seleccionada ? 700 : 500,
                        fontSize: 14,
                        cursor: 'pointer',
                      }}
                    >
                      {o.etiqueta}
                    </button>
                  ))}
              </div>
            )}
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
            {!cargando && salasFiltradas.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2, padding: '0 14px' }}>{competicionActual ? 'No hay salas que encajen con estos filtros.' : 'Todavía no hay mesas para esta competición: se crean solas en cuanto se confirman los horarios.'}</p>}

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
              {/* 05/10 (corrección de Iñi): las finalizadas ya no van ocultas
                  tras un desplegable — se ven siempre, debajo de todas las
                  abiertas. */}
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
                Finalizadas ({salasFinalizadasDelDeporte.length})
              </span>
              {salasFinalizadasDelDeporte.map((s) => tarjetaSala(s))}
            </div>
          )}

          {(deporte === 'futbol' || deporte === 'golf') && <AvisoMasMesas />}

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

function chipFiltroStyle(activo: boolean, abierto: boolean): CSSProperties {
  const resaltado = activo || abierto;
  return {
    // 06/10 (Iñi): en el móvil se cortaban los títulos ("TIPO DE SA…",
    // "JUGADORES…"): letra más pequeña, menos relleno y cada chip crece según
    // lo que ocupa su texto (width:auto anula el 100% global de los botones).
    flex: '1 1 auto',
    width: 'auto',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.01em',
    padding: '8px 9px',
    borderRadius: 999,
    border: `1px solid ${resaltado ? '#3DDC84' : S.BORDER}`,
    background: activo ? 'rgba(61,220,132,0.12)' : 'transparent',
    color: resaltado ? '#3DDC84' : S.MUTED,
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
