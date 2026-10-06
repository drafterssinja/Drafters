'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { PorraFormato, PORRA_FORMATO_LABELS, PORRA_FORMATO_COLOR } from '@/lib/porraFormato';

// ============================================================================
// PANEL DE ADMINISTRACIÓN — dashboard + menú (reordenado 28/09)
// ============================================================================
// Pedido de Iñi, 28/09: "desordenado, todo puesto ahí seguido" — que se
// reorganice como un menú, igual que ya funcionan /admin/videos,
// /admin/usuarios y /admin/porras-golf: esta pantalla se queda solo como
// dashboard (resumen financiero + filtros) y tarjetas de navegación hacia
// cada área — "crear mesas drafters" y "modificar el ranking de los
// jugadores" (sus dos ejemplos) tienen ahora cada una su propio menú
// dedicado (/admin/mesas-drafters y /admin/rankings). Todo lo que antes
// vivía seguido aquí (valor de mercado de fútbol, "Nuevo torneo o jornada",
// listado de mesas/jugadores, ranking mundial...) se ha movido a esas
// pantallas — ver ahí el histórico de comentarios de cada bloque.

type PorraAdmin = {
  id: string;
  major: string;
  competicion: string | null;
  estado: string;
  precio: number;
  fecha_limite_inscripcion: string | null;
  formato: PorraFormato;
};
type InscripcionFila = {
  importe: number;
  fecha: string;
  // `porras` (28/09): antes solo se traía `salas` — las filas de porra
  // llegaban igual en esta misma consulta, pero se descartaban al filtrar
  // porque `equipos.salas` salía null para ellas. Ahora se distingue
  // también el caso de porra, para poder sacar el rake de porras aparte
  // (ver rakeGanadoPorras más abajo).
  equipos: { modo: string; salas: { deporte: string; tipo: string; buy_in: number } | null; porras: { id: string } | null } | null;
};
type MovimientoFila = { tipo: 'deposito' | 'retiro'; importe: number; creado_en: string };

const DEPORTES = ['futbol', 'golf', 'tenis'] as const;
const TIPOS_SALA = ['doble_o_nada', 'triple_o_nada', 'oro_y_plata', 'tridente', 'maraton'] as const;
const TIPO_SALA_LABELS: Record<string, string> = {
  doble_o_nada: 'Doble o Nada',
  triple_o_nada: 'Triple o Nada',
  oro_y_plata: 'Oro y Plata',
  tridente: 'Tridente',
  maraton: 'Maratón',
};
const BUYIN_LABELS: Record<string, string> = { bajo: 'Hasta 25 €', medio: '25–100 €', alto: '+100 €' };

// Mismos umbrales de buy-in que usa el resto de la app (pantalla de Salas
// del prototipo): bajo ≤25€, medio 25-100€, alto >100€.
function nivelBuyIn(buyIn: number): 'bajo' | 'medio' | 'alto' {
  if (buyIn <= 25) return 'bajo';
  if (buyIn <= 100) return 'medio';
  return 'alto';
}

const FECHA_OPCIONES: { key: string; label: string; dias: number | null }[] = [
  { key: 'todo', label: 'Todo el tiempo', dias: null },
  { key: '7', label: 'Últimos 7 días', dias: 7 },
  { key: '30', label: 'Último mes', dias: 30 },
  { key: '365', label: 'Último año', dias: 365 },
];

// Tarjetas de navegación de "Gestión" (reagrupadas 28/09 — antes "Vídeos
// publicitarios" y "Porras de golf" estaban sueltas, cada una en un sitio
// distinto del panel, en vez de juntas bajo un mismo apartado).
const TARJETAS_GESTION: { href: string; titulo: string; subtitulo: string }[] = [
  { href: '/admin/mesas-drafters', titulo: 'Mesas Drafters', subtitulo: 'Crear torneos/jornadas, mesas, y gestionar jugadores' },
  { href: '/admin/porras-golf', titulo: 'Porras de golf', subtitulo: 'Crear porras (clásica o modo draft) y gestionar las existentes' },
  // Nueva (29/09, pedido de Iñi): porra de fútbol de Primera División por
  // jornada — ver app/admin/porras-futbol.
  { href: '/admin/porras-futbol', titulo: 'Porras de fútbol', subtitulo: 'Crear la porra de cada jornada, cargar los 10 partidos y marcar resultados' },
  // Nueva (06/10, pedido de Iñi): puntos de LaLiga Fantasy + marcadores en
  // vivo para las mesas de fútbol — ver app/admin/resultados-futbol.
  { href: '/admin/resultados-futbol', titulo: 'Resultados de fútbol en vivo', subtitulo: 'Puntos Drafters con datos de ESPN (LaLiga y Champions), marcadores y emparejar jugadores' },
  { href: '/admin/rankings', titulo: 'Ranking de jugadores', subtitulo: 'Ranking mundial de golf y tenis' },
  // Nueva (29/09, pedido de Iñi): "diseña lo que haga falta para que esos
  // pagos... queden hechos" — ver app/admin/pagos-pendientes.
  { href: '/admin/pagos-pendientes', titulo: 'Pagos pendientes', subtitulo: 'Revisar y confirmar el reparto de premios de salas y porras acabadas' },
  // Nueva (28/09, pedido de Iñi): conectar cada competición con su torneo
  // en ESPN para que la clasificación en directo se rellene sola, sin
  // introducir el resultado a mano — ver drafters-schema.sql.
  { href: '/admin/resultados-golf', titulo: 'Resultados de golf en vivo', subtitulo: 'Conectar cada competición con ESPN para la clasificación en directo' },
  // Ruta renombrada de /admin/publicidad a /admin/videos (28/09, aviso de
  // Iñi) — la palabra "publicidad" en la URL hacía que algunos
  // bloqueadores de anuncios del navegador (net::ERR_BLOCKED_BY_CLIENT)
  // bloquearan directamente el trozo de JavaScript de esta pantalla,
  // dejándola en negro sin cargar nada para cualquier admin con un
  // bloqueador de anuncios activo. El contenido y la función no cambian,
  // solo el nombre de la ruta.
  { href: '/admin/videos', titulo: 'Vídeos publicitarios', subtitulo: 'Subir vídeos, prioridad y estadísticas de visualización' },
  { href: '/admin/usuarios', titulo: 'Usuarios', subtitulo: 'Listado completo de usuarios registrados' },
  { href: '/admin/actividad', titulo: 'Registro de actividad', subtitulo: 'Historial de accesos e inscripciones, filtrable por usuario' },
  // Nueva (03/10, pedido de Iñi): registro aparte del de actividad general,
  // para no mezclarlo — ver app/admin/mesas-sin-acceso.
  {
    href: '/admin/mesas-sin-acceso',
    titulo: 'Intentos sin acceso a Mesas Drafters',
    subtitulo: 'Usuarios sin acceso que han construido equipo y llegado al final sin poder confirmar',
  },
];

export default function AdminPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [porrasAdmin, setPorrasAdmin] = useState<PorraAdmin[]>([]);
  const [totalUsuarios, setTotalUsuarios] = useState<number | null>(null);
  const [inscripciones, setInscripciones] = useState<InscripcionFila[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoFila[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filtroDeporte, setFiltroDeporte] = useState<string>('todos');
  const [filtroTipoSala, setFiltroTipoSala] = useState<string>('todos');
  const [filtroBuyIn, setFiltroBuyIn] = useState<string>('todos');
  const [filtroFecha, setFiltroFecha] = useState<string>('todo');

  // Desglose de "Rake ganado" por salas/porras (28/09, pedido de Iñi: "en
  // la caja de Rake sumas ambas cantidades, y que si pulso encima me cargue
  // justo debajo el separado de cada una") — colapsado de serie, se
  // despliega al pulsar la propia tarjeta.
  const [mostrarDesgloseRake, setMostrarDesgloseRake] = useState(false);

  // Mismo patrón (30/09, pedido de Iñi: "no se está teniendo en cuenta
  // cuánto dinero se juegan las porras... quiero que cuente todo, tanto
  // partidas como dinero jugado, pero que luego pueda ver el desglosado de
  // cuánto es de porras y cuánto de mesas drafters") — aplicado también a
  // "Dinero jugado" y "Partidas jugadas", que hasta ahora solo contaban
  // salas (el dato de porras ya se calculaba para el rake, pero no se
  // sumaba a estas dos tarjetas).
  const [mostrarDesgloseDineroJugado, setMostrarDesgloseDineroJugado] = useState(false);
  const [mostrarDesglosePartidas, setMostrarDesglosePartidas] = useState(false);

  // Editar una porra ya creada, directamente desde su propia tarjeta en
  // "Porras creadas" (pedido de Iñi, ronda de correcciones: antes solo se
  // podía tocar su fecha límite indirectamente, editando el torneo entero
  // — ahora también se puede aquí mismo, igual que con "Eliminar").
  const [editandoFechaPorra, setEditandoFechaPorra] = useState<string | null>(null);
  const [fechaPorraEditada, setFechaPorraEditada] = useState('');
  const [guardandoFechaPorra, setGuardandoFechaPorra] = useState(false);
  const [eliminandoPorraId, setEliminandoPorraId] = useState<string | null>(null);

  // Movido a su propio menú (28/09) — antes cargarTodo() traía también
  // salas y jugadores para "Mesas en juego ahora" y los listados de
  // mesas/jugadores: eso vive ahora en /admin/mesas-drafters. Aquí solo
  // hace falta lo que usa el resumen financiero y "Porras creadas".
  async function cargarTodo() {
    const [{ data: porrasData }, { count }, { data: inscripcionesData, error: inscripcionesError }, { data: movimientosData, error: movimientosError }] =
      await Promise.all([
        supabase.from('porras').select('id, major, competicion, estado, precio, fecha_limite_inscripcion, formato').order('created_at', { ascending: false }),
        // Solo el total (head: true, sin traer filas) — el listado completo
        // de usuarios vive en su propia pantalla (/admin/usuarios), a la que
        // se llega pulsando esta misma tarjeta (pedido de Iñi: no quería un
        // listado siempre visible aquí, solo accesible al pulsar el número).
        supabase.from('perfiles').select('id', { count: 'exact', head: true }),
        // Las inscripciones 'reembolsada' son dinero devuelto íntegro (la sala no se
        // llenó a tiempo y no había con quién juntarla) — no cuentan como partida
        // jugada ni deben sumar a la facturación real.
        supabase.from('inscripciones').select('importe, fecha, equipos!inner(modo, salas(deporte, tipo, buy_in), porras(id))').neq('estado', 'reembolsada'),
        supabase.from('movimientos').select('tipo, importe, creado_en'),
      ]);

    setPorrasAdmin((porrasData as PorraAdmin[]) ?? []);
    setTotalUsuarios(count ?? 0);
    if (inscripcionesError) setError('No se han podido cargar las estadísticas de partidas jugadas.');
    else setInscripciones((inscripcionesData as unknown as InscripcionFila[]) ?? []);
    if (movimientosError) setError('No se han podido cargar los movimientos de saldo.');
    else setMovimientos((movimientosData as MovimientoFila[]) ?? []);
  }

  useEffect(() => {
    let activo = true;

    async function verificarAcceso() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfilData } = await supabase
        .from('perfiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (!activo) return;

      const p = perfilData as Perfil | null;
      if (!p || p.rol !== 'admin') {
        router.push('/cuenta');
        return;
      }

      setPerfil(p);
      setAutorizado(true);
      await cargarTodo();
    }

    verificarAcceso();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function eliminarPorra(porra: PorraAdmin) {
    if (!window.confirm(`¿Estás seguro de que quieres eliminar la porra "${porra.major}"? Se reembolsará a los equipos inscritos y se les avisará. Esta acción no se puede deshacer.`)) {
      return;
    }
    setEliminandoPorraId(porra.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('eliminar_porra', { p_porra_id: porra.id });
    setEliminandoPorraId(null);
    if (rpcError) {
      setError('No se ha podido eliminar la porra. Inténtalo de nuevo.');
      return;
    }
    await cargarTodo();
  }

  function empezarEdicionFechaPorra(porra: PorraAdmin) {
    setEditandoFechaPorra(porra.id);
    setFechaPorraEditada(porra.fecha_limite_inscripcion ? porra.fecha_limite_inscripcion.slice(0, 16) : '');
  }

  async function guardarFechaPorra(porraId: string) {
    setGuardandoFechaPorra(true);
    const nuevaFechaIso = fechaPorraEditada ? new Date(fechaPorraEditada).toISOString() : null;
    await supabase.from('porras').update({ fecha_limite_inscripcion: nuevaFechaIso }).eq('id', porraId);
    setGuardandoFechaPorra(false);
    setEditandoFechaPorra(null);
    await cargarTodo();
  }

  if (autorizado === null || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Comprobando acceso...</p>
          </div>
        </div>
      </main>
    );
  }

  const maxDias = FECHA_OPCIONES.find((f) => f.key === filtroFecha)?.dias ?? null;
  const dentroDelPeriodo = (fechaIso: string) => {
    if (maxDias === null) return true;
    const dias = (Date.now() - new Date(fechaIso).getTime()) / (1000 * 60 * 60 * 24);
    return dias <= maxDias;
  };

  const inscripcionesFiltradas = inscripciones.filter((i) => {
    const sala = i.equipos?.salas;
    if (!sala) return false;
    if (filtroDeporte !== 'todos' && sala.deporte !== filtroDeporte) return false;
    if (filtroTipoSala !== 'todos' && sala.tipo !== filtroTipoSala) return false;
    if (filtroBuyIn !== 'todos' && nivelBuyIn(sala.buy_in) !== filtroBuyIn) return false;
    if (!dentroDelPeriodo(i.fecha)) return false;
    return true;
  });

  // Inscripciones de porra (28/09, pedido de Iñi: "lleva también el
  // control del rake ganado por las porras") — misma consulta de arriba,
  // separada por el lado de porras en vez de salas. Los filtros de
  // deporte/tipo de sala/buy-in son propios de las 5 salas de aforo fijo y
  // el Maratón, así que no se aplican aquí (una porra siempre es de golf, y
  // no tiene "tipo de sala" ni buy-in en ese sentido) — solo se respeta el
  // filtro de periodo, que sí tiene sentido para las dos cosas.
  const inscripcionesPorrasFiltradas = inscripciones.filter((i) => {
    if (!i.equipos?.porras) return false;
    if (!dentroDelPeriodo(i.fecha)) return false;
    return true;
  });

  const movimientosFiltrados = movimientos.filter((m) => dentroDelPeriodo(m.creado_en));

  const partidasJugadasSalas = inscripcionesFiltradas.length;
  const partidasJugadasPorras = inscripcionesPorrasFiltradas.length;
  const partidasJugadas = partidasJugadasSalas + partidasJugadasPorras;
  const dineroJugadoSalas = inscripcionesFiltradas.reduce((acc, i) => acc + Number(i.importe), 0);
  const dineroJugadoPorras = inscripcionesPorrasFiltradas.reduce((acc, i) => acc + Number(i.importe), 0);
  const dineroJugado = dineroJugadoSalas + dineroJugadoPorras;
  const rakeGanadoSalas = dineroJugadoSalas * 0.1;
  const rakeGanadoPorras = dineroJugadoPorras * 0.1;
  const rakeGanado = rakeGanadoSalas + rakeGanadoPorras;
  const dineroDepositado = movimientosFiltrados.filter((m) => m.tipo === 'deposito').reduce((acc, m) => acc + Number(m.importe), 0);
  const dineroRetirado = movimientosFiltrados.filter((m) => m.tipo === 'retiro').reduce((acc, m) => acc + Number(m.importe), 0);

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  const statCards: { value: string; label: string; href?: string; onClick?: () => void; expandido?: boolean }[] = [
    { value: `${dineroDepositado.toFixed(2)} €`, label: 'Dinero depositado' },
    { value: `${dineroRetirado.toFixed(2)} €`, label: 'Dinero retirado' },
    {
      value: `${partidasJugadas}`,
      label: 'Partidas jugadas',
      onClick: () => setMostrarDesglosePartidas((v) => !v),
      expandido: mostrarDesglosePartidas,
    },
    {
      value: `${dineroJugado.toFixed(2)} €`,
      label: 'Dinero jugado',
      onClick: () => setMostrarDesgloseDineroJugado((v) => !v),
      expandido: mostrarDesgloseDineroJugado,
    },
    // Clicable (28/09, pedido de Iñi: "lleva también el control del rake
    // ganado por las porras... que si pulso encima me cargue justo debajo
    // el separado de cada una") — suma salas + porras, y despliega el
    // desglose de las dos por separado justo debajo del grid al pulsarla.
    { value: `${rakeGanado.toFixed(2)} €`, label: 'Rake ganado (10%)', onClick: () => setMostrarDesgloseRake((v) => !v), expandido: mostrarDesgloseRake },
    // Clicable (pedido de Iñi): pulsar el número lleva al listado completo
    // de usuarios en su propia pantalla, en vez de mostrarlo siempre aquí.
    { value: `${totalUsuarios ?? '—'}`, label: 'Usuarios registrados', href: '/admin/usuarios' },
  ];

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Panel de administración
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Solo visible para el superadministrador.</p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          {/* Menú de gestión (reagrupado 28/09, pedido de Iñi: "que me lo
              ordenes bien, como un menú") — todas las tarjetas de
              navegación juntas bajo un mismo apartado, en vez de sueltas
              por el panel. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Gestión</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TARJETAS_GESTION.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '14px 16px', textDecoration: 'none' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT }}>{t.titulo}</span>
                    <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>{t.subtitulo}</span>
                  </div>
                  <span style={{ flexShrink: 0, color: S.ACCENT, fontSize: 16, fontWeight: 700 }}>→</span>
                </Link>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, background: '#10150F', border: '1px solid #1E2723', borderRadius: 14, padding: 16 }}>
            <span style={S.sectionLabel}>Filtros del resumen financiero</span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Deporte</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button type="button" style={S.pill(filtroDeporte === 'todos')} onClick={() => setFiltroDeporte('todos')}>Todos</button>
                {DEPORTES.map((d) => (
                  <button key={d} type="button" style={S.pill(filtroDeporte === d)} onClick={() => setFiltroDeporte(d)}>{d}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Tipo de sala</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button type="button" style={S.pill(filtroTipoSala === 'todos')} onClick={() => setFiltroTipoSala('todos')}>Todas</button>
                {TIPOS_SALA.map((t) => (
                  <button key={t} type="button" style={S.pill(filtroTipoSala === t)} onClick={() => setFiltroTipoSala(t)}>{TIPO_SALA_LABELS[t]}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Buy-in</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button type="button" style={S.pill(filtroBuyIn === 'todos')} onClick={() => setFiltroBuyIn('todos')}>Cualquiera</button>
                {(['bajo', 'medio', 'alto'] as const).map((b) => (
                  <button key={b} type="button" style={S.pill(filtroBuyIn === b)} onClick={() => setFiltroBuyIn(b)}>{BUYIN_LABELS[b]}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Periodo</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {FECHA_OPCIONES.map((f) => (
                  <button key={f.key} type="button" style={S.pill(filtroFecha === f.key)} onClick={() => setFiltroFecha(f.key)}>{f.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {statCards.map((c) => {
              const contenido = (
                <>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT }}>{c.value}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: S.MUTED_2 }}>
                    {c.label}
                    {c.href && <span style={{ marginLeft: 5, color: S.ACCENT }}>→</span>}
                    {c.onClick && <span style={{ marginLeft: 5, color: S.ACCENT, display: 'inline-block', transform: c.expandido ? 'rotate(180deg)' : 'none' }}>▾</span>}
                  </span>
                </>
              );
              if (c.href) {
                return (
                  <Link
                    key={c.label}
                    href={c.href}
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14, textDecoration: 'none', cursor: 'pointer' }}
                  >
                    {contenido}
                  </Link>
                );
              }
              if (c.onClick) {
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={c.onClick}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 4,
                      background: S.PANEL,
                      border: `1px solid ${c.expandido ? S.ACCENT : S.CARD_BORDER}`,
                      borderRadius: 12,
                      padding: 14,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {contenido}
                  </button>
                );
              }
              return (
                <div key={c.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
                  {contenido}
                </div>
              );
            })}
          </div>

          {/* Desglose de "Partidas jugadas" por salas/porras (30/09) —
              mismo patrón que el de Rake ganado. */}
          {mostrarDesglosePartidas && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14, marginTop: -4 }}>
              <span style={S.sectionLabel}>Partidas jugadas, por origen</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Mesas Drafters (Doble o Nada, Triple o Nada, Oro y Plata, Tridente, Maratón)</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13.5, color: S.TEXT, flexShrink: 0 }}>{partidasJugadasSalas}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Porras (golf y fútbol)</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13.5, color: S.TEXT, flexShrink: 0 }}>{partidasJugadasPorras}</span>
              </div>
              <p style={{ fontSize: 10.5, color: S.MUTED_3, margin: 0 }}>
                El de mesas respeta los filtros de deporte, tipo de sala y buy-in de arriba; el de porras solo respeta el periodo (una porra no tiene esos otros filtros).
              </p>
            </div>
          )}

          {/* Desglose de "Dinero jugado" por salas/porras (30/09) — mismo
              patrón que el de Rake ganado. */}
          {mostrarDesgloseDineroJugado && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14, marginTop: -4 }}>
              <span style={S.sectionLabel}>Dinero jugado, por origen</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Mesas Drafters (Doble o Nada, Triple o Nada, Oro y Plata, Tridente, Maratón)</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13.5, color: S.TEXT, flexShrink: 0 }}>{dineroJugadoSalas.toFixed(2)} €</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Porras (golf y fútbol)</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13.5, color: S.TEXT, flexShrink: 0 }}>{dineroJugadoPorras.toFixed(2)} €</span>
              </div>
              <p style={{ fontSize: 10.5, color: S.MUTED_3, margin: 0 }}>
                El de mesas respeta los filtros de deporte, tipo de sala y buy-in de arriba; el de porras solo respeta el periodo (una porra no tiene esos otros filtros).
              </p>
            </div>
          )}

          {/* Desglose de "Rake ganado" por salas/porras (28/09) — justo
              debajo del grid, se despliega al pulsar esa tarjeta. */}
          {mostrarDesgloseRake && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14, marginTop: -4 }}>
              <span style={S.sectionLabel}>Rake ganado, por origen</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Salas (Doble o Nada, Triple o Nada, Oro y Plata, Tridente, Maratón)</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13.5, color: S.TEXT, flexShrink: 0 }}>{rakeGanadoSalas.toFixed(2)} €</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Porras (golf y fútbol)</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13.5, color: S.TEXT, flexShrink: 0 }}>{rakeGanadoPorras.toFixed(2)} €</span>
              </div>
              <p style={{ fontSize: 10.5, color: S.MUTED_3, margin: 0 }}>
                El de salas respeta los filtros de deporte, tipo de sala y buy-in de arriba; el de porras solo respeta el periodo (una porra no tiene esos otros filtros).
              </p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Porras creadas</span>
            <p style={{ fontSize: 11.5, color: S.MUTED_3, margin: 0, lineHeight: 1.4 }}>
              Solo lectura — para crear una porra nueva o cambiar su formato, ve a{' '}
              <Link href="/admin/porras-golf" style={{ color: S.ACCENT }}>
                Porras de golf
              </Link>
              .
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porrasAdmin.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay ninguna porra creada.</p>}
              {porrasAdmin.map((p) => {
                const editandoPorra = editandoFechaPorra === p.id;
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: "'Manrope', sans-serif",
                            fontWeight: 700,
                            fontSize: 9.5,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: PORRA_FORMATO_COLOR[p.formato],
                          }}
                        >
                          {PORRA_FORMATO_LABELS[p.formato]}
                        </span>
                        <span
                          style={{
                            fontFamily: "'Manrope', sans-serif",
                            fontWeight: 700,
                            fontSize: 13.5,
                            color: S.TEXT,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.major || p.competicion || '(sin nombre de torneo)'}
                        </span>
                        <span style={{ fontSize: 11, color: S.FAINT }}>{p.estado} · {p.precio.toFixed(2)} €</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => (editandoPorra ? setEditandoFechaPorra(null) : empezarEdicionFechaPorra(p))}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#C9D2CC', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
                        >
                          {editandoPorra ? 'Cancelar' : 'Editar'}
                        </button>
                        <button
                          type="button"
                          disabled={eliminandoPorraId === p.id}
                          onClick={() => eliminarPorra(p)}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ERROR, background: 'transparent', border: `1px solid ${S.ERROR}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: eliminandoPorraId === p.id ? 0.6 : 1 }}
                        >
                          {eliminandoPorraId === p.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </div>
                    {editandoPorra && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 10 }}>
                        <input
                          type="datetime-local"
                          value={fechaPorraEditada}
                          onChange={(e) => setFechaPorraEditada(e.target.value)}
                          style={{ ...S.input, padding: '8px 10px', fontSize: 12.5 }}
                        />
                        <button
                          type="button"
                          disabled={guardandoFechaPorra}
                          onClick={() => guardarFechaPorra(p.id)}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#04140B', background: '#3DDC84', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: guardandoFechaPorra ? 0.7 : 1, whiteSpace: 'nowrap' }}
                        >
                          Guardar fecha límite
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
