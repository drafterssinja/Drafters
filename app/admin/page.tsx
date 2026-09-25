'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { parseListaJugadores, JugadorParseado } from '@/lib/parsePlayerList';
import { precioPorRanking, precioFutbolPorPosicion } from '@/lib/pricing';
import { parsearListadoCuotas } from '@/lib/parsearCuotas';
import { calcularPreciosPorCuota, cuotaValida } from '@/lib/precioPorCuota';
import { generarSalasParaTorneo } from '@/lib/tiposDeSala';
import { calcularGrupoPorra, UMBRAL_MINIMO_ESPANOLES, PUESTO_NO_ENCONTRADO } from '@/lib/porraGrupos';
import { normalizarNombre } from '@/lib/nombreMatch';
import { parsearValoresMercado, FilaValorMercado } from '@/lib/parsearValoresMercado';
import { parsearCuotasPartidosFutbol } from '@/lib/parsearCuotasFutbol';
import { emparejarEquipo } from '@/lib/aliasEquipos';
import { calcularPreciosFutbolDetallado, factorPosicion, fuerzaPorEquipo, PosicionFutbol, JugadorConPrecioFutbol } from '@/lib/precioFutbol';

// El precio de golf/tenis ya no sale del ranking mundial, sino de la cuota
// de "Ganador" de la casa de apuestas de esa semana (decidido con Iñi el
// 23/09) — lib/precioPorCuota.ts. Si el listado pegado no trae ninguna
// cuota reconocible, se mantiene el cálculo antiguo por ranking como
// respaldo (ver previsualizarTorneo/confirmarImportacionTorneo más abajo).
// El grupo de color de la porra clásica NO cambia: sigue saliendo del
// ranking mundial guardado (rankings_mundiales, lib/porraGrupos.ts).
type PreviewJugador = JugadorParseado & { esEspanol: boolean; cuota: number | null };

type Sala = {
  id: string;
  codigo: string;
  nombre: string;
  deporte: string;
  tipo: string;
  estado: string;
  buy_in: number;
  competicion: string;
  fecha_limite_inscripcion: string | null;
};
type PorraAdmin = {
  id: string;
  major: string;
  competicion: string | null;
  estado: string;
  precio: number;
  fecha_limite_inscripcion: string | null;
};
type Jugador = {
  id: string;
  nombre: string;
  deporte: string;
  competicion: string;
  precio: number;
  lesionado: boolean;
};
type InscripcionFila = {
  importe: number;
  fecha: string;
  equipos: { modo: string; salas: { deporte: string; tipo: string; buy_in: number } | null } | null;
};
type MovimientoFila = { tipo: 'deposito' | 'retiro'; importe: number; creado_en: string };

// --- Valor de mercado y cuotas 1X2 de fútbol (ENCARGO parte A) ---
type LigaFutbol = 'la_liga' | 'premier' | 'champions';
const LIGAS_FUTBOL: LigaFutbol[] = ['la_liga', 'premier', 'champions'];
const LIGA_FUTBOL_LABEL: Record<LigaFutbol, string> = { la_liga: 'La Liga', premier: 'Premier League', champions: 'Champions League' };
// Mismo texto que usa app/api/admin/sync-jornada-futbol/route.ts al construir
// `competicion` ("La Liga - Jornada 8") — así se filtran los jugadores de
// cada liga sin necesitar una columna nueva.
const LIGA_FUTBOL_PREFIJO: Record<LigaFutbol, string> = { la_liga: 'La Liga', premier: 'Premier League', champions: 'Champions League' };

type JugadorFutbolDb = { id: string; nombre: string; equipo_real: string | null; posicion: PosicionFutbol | null; valor_mercado: number | null; competicion: string };

// 25/09: ya no hace falta ninguna API para tener el listado de jugadores de
// fútbol — este cargador de valores de mercado es ahora la única fuente
// (trae también la posición, ver lib/parsearValoresMercado.ts), así que
// tiene que poder CREAR jugadores nuevos además de actualizar el valor de
// los que ya existan. "Actualizados" son los que ya había (mismo equipo +
// nombre, con posible reescritura de equipo vía lib/aliasEquipos.ts);
// "nuevos" son altas (fichaje no visto antes, o la primera carga de la
// competición entera, cuando `jugadores` está vacía y no hay nada contra
// qué emparejar todavía).
type FilaValorActualizada = {
  jugadorId: string;
  nombreDb: string;
  equipoDb: string;
  equipoOrigen: string;
  jugadorOrigen: string;
  posicion: PosicionFutbol;
  valor: number;
  probabilidadTitular: number | null;
};
type FilaValorNueva = {
  equipo: string;
  jugador: string;
  posicion: PosicionFutbol;
  valor: number;
  probabilidadTitular: number | null;
};
type FilaValorError = FilaValorMercado & { motivo: string };
type PreviewValorMercado = {
  actualizados: FilaValorActualizada[];
  nuevos: FilaValorNueva[];
  errores: FilaValorError[];
  sinValorEnPlantilla: { id: string; nombre: string; equipo: string | null }[];
};

type PreviewCuotasFutbol = {
  precios: (JugadorConPrecioFutbol & { nombre: string; equipoReal: string | null })[];
  partidosSinCuota: string[]; // equipos que juegan esta jornada pero no aparecieron en el pegado
  partidosNoEmparejados: string[]; // líneas pegadas cuyo equipo no se ha podido emparejar
  topeUsado: number;
  gammaUsado: number;
  reglasCumplidas: boolean;
};

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

export default function AdminPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [porrasAdmin, setPorrasAdmin] = useState<PorraAdmin[]>([]);
  const [jugadores, setJugadores] = useState<Jugador[]>([]);
  const [totalUsuarios, setTotalUsuarios] = useState<number | null>(null);
  const [inscripciones, setInscripciones] = useState<InscripcionFila[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoFila[]>([]);
  const [error, setError] = useState<string | null>(null);

  // "Mesas recientes" y "Jugadores" son listados largos que hoy no aportan
  // mucho de un vistazo — pedido de Iñi: que estén plegados de entrada,
  // como un desplegable, en vez de mostrar siempre todas las filas.
  const [mostrarMesasCreadas, setMostrarMesasCreadas] = useState(false);
  const [mostrarJugadoresCreados, setMostrarJugadoresCreados] = useState(false);
  // Crear mesa aislada (pedido de Iñi, ronda de correcciones): normalmente no
  // hace falta — al crear un torneo/jornada ya se generan solas 2 mesas de
  // cada tipo/buy-in (y la porra, en golf) — así que este formulario se deja
  // oculto de primeras, igual que las listas de mesas/jugadores de abajo.
  const [mostrarCrearMesa, setMostrarCrearMesa] = useState(false);
  // Sincronización automática de fútbol por API (football-data.org): aparcada
  // a petición de Iñi el 25/09 (no funcionaba bien y ya no hace falta, la
  // jornada se crea ahora a mano en "Nuevo torneo o jornada") — se deja el
  // botón por si hiciera falta alguna vez, pero oculto de entrada.
  const [mostrarSyncFutbol, setMostrarSyncFutbol] = useState(false);

  const [filtroDeporte, setFiltroDeporte] = useState<string>('todos');
  const [filtroTipoSala, setFiltroTipoSala] = useState<string>('todos');
  const [filtroBuyIn, setFiltroBuyIn] = useState<string>('todos');
  const [filtroFecha, setFiltroFecha] = useState<string>('todo');

  const [nombreSala, setNombreSala] = useState('');
  const [deporteSala, setDeporteSala] = useState<(typeof DEPORTES)[number]>('futbol');
  const [competicionSala, setCompeticionSala] = useState('');
  const [tipoSala, setTipoSala] = useState<(typeof TIPOS_SALA)[number]>('doble_o_nada');
  const [aforoSala, setAforoSala] = useState(2);
  const [buyInSala, setBuyInSala] = useState(10);
  const [creandoSala, setCreandoSala] = useState(false);

  const [nombreJugador, setNombreJugador] = useState('');
  const [deporteJugador, setDeporteJugador] = useState<(typeof DEPORTES)[number]>('futbol');
  const [competicionJugador, setCompeticionJugador] = useState('');
  const [precioJugador, setPrecioJugador] = useState(10000);
  const [creandoJugador, setCreandoJugador] = useState(false);

  // Precio editable a mano por jugador ya creado (pedido de Iñi, 23/09: el
  // precio se calcula solo por ranking al importar, pero tiene que poder
  // corregirlo él si lo considera necesario).
  const [editandoPrecioId, setEditandoPrecioId] = useState<string | null>(null);
  const [precioEditado, setPrecioEditado] = useState('');
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);

  // Automatización: jornada de fútbol (football-data.org, vía ruta de servidor)
  const [sincronizandoFutbol, setSincronizandoFutbol] = useState(false);
  const [resultadoFutbol, setResultadoFutbol] = useState<
    { competicion: string; jornada: number | null; jugadoresSincronizados: number; salasCreadas: number; fechaLimite: string | null; aviso?: string }[] | null
  >(null);
  const [errorFutbol, setErrorFutbol] = useState<string | null>(null);

  // Valor de mercado de fútbol, por competición (ENCARGO A.4) — se carga la
  // primera vez y se refresca cada pocas semanas.
  const [ligaValorMercado, setLigaValorMercado] = useState<LigaFutbol>('la_liga');
  const [cargasValorMercado, setCargasValorMercado] = useState<Record<LigaFutbol, { cargadoEn: string | null; jugadoresActualizados: number }>>({
    la_liga: { cargadoEn: null, jugadoresActualizados: 0 },
    premier: { cargadoEn: null, jugadoresActualizados: 0 },
    champions: { cargadoEn: null, jugadoresActualizados: 0 },
  });
  const [textoValorMercado, setTextoValorMercado] = useState('');
  const [calculandoPreviewValor, setCalculandoPreviewValor] = useState(false);
  const [previewValorMercado, setPreviewValorMercado] = useState<PreviewValorMercado | null>(null);
  const [avisosValorMercado, setAvisosValorMercado] = useState<string[]>([]);
  const [guardandoValorMercado, setGuardandoValorMercado] = useState(false);
  const [resultadoValorMercado, setResultadoValorMercado] = useState<string | null>(null);
  const [errorValorMercado, setErrorValorMercado] = useState<string | null>(null);

  // Cuotas 1X2 de la jornada de fútbol (25/09: se pegan ahora como parte de
  // "Nuevo torneo o jornada", más abajo, en vez de en un apartado aparte —
  // calculan y guardan el precio final de cada jugador de esa jornada, a
  // partir del valor de mercado ya cargado más el ajuste por partido, y la
  // jornada ya no se elige de una lista de jornadas sincronizadas antes: se
  // crea aquí mismo, con el nombre que le da Iñi (torneoNombre) sobre la
  // liga elegida (ligaJornadaFutbol) — ver previsualizarJornadaFutbol() /
  // confirmarJornadaFutbol()).
  const [ligaJornadaFutbol, setLigaJornadaFutbol] = useState<LigaFutbol>('la_liga');
  const [textoCuotas, setTextoCuotas] = useState('');
  const [calculandoPreviewCuotas, setCalculandoPreviewCuotas] = useState(false);
  const [previewCuotas, setPreviewCuotas] = useState<PreviewCuotasFutbol | null>(null);
  const [avisosCuotasFutbol, setAvisosCuotasFutbol] = useState<string[]>([]);
  const [guardandoCuotas, setGuardandoCuotas] = useState(false);
  const [resultadoCuotas, setResultadoCuotas] = useState<string | null>(null);
  const [errorCuotas, setErrorCuotas] = useState<string | null>(null);

  // Automatización: torneo de golf/tenis, o jornada de fútbol, pegado a mano
  // (25/09: fútbol se ha unido a este mismo panel — antes de esa fecha solo
  // admitía golf/tenis, y fútbol se sincronizaba solo por API — ver
  // "Automatizar jornada de fútbol", ahora aparcado más abajo).
  const [torneoNombre, setTorneoNombre] = useState('');
  const [torneoDeporte, setTorneoDeporte] = useState<'futbol' | 'golf' | 'tenis'>('futbol');
  const [torneoTexto, setTorneoTexto] = useState('');
  const [torneoFechaLimite, setTorneoFechaLimite] = useState('');
  // Checks separados para crear mesas/porra al importar (pedido de Iñi,
  // 23/09): por defecto los dos activados (torneo nuevo de cero), pero se
  // pueden desmarcar por separado — p.ej. si ya borró la porra para
  // recrearla sola y las mesas de Drafters de ese torneo ya están bien, no
  // hace falta duplicarlas.
  const [crearMesas, setCrearMesas] = useState(true);
  const [crearPorraCheck, setCrearPorraCheck] = useState(true);
  const [previewJugadores, setPreviewJugadores] = useState<PreviewJugador[]>([]);
  // Avisos del parseo de cuotas (líneas sin cuota reconocible o con una
  // cuota inválida) — el jugador correspondiente no entra en la vista
  // previa hasta que se corrija el texto pegado y se vuelva a previsualizar.
  const [avisosCuotas, setAvisosCuotas] = useState<string[]>([]);
  const [importandoTorneo, setImportandoTorneo] = useState(false);
  const [resultadoTorneo, setResultadoTorneo] = useState<string | null>(null);

  // Rankings mundiales de golf y tenis (mantenidos aparte, ver
  // drafters-schema.sql sección 4.5) — se usan para saber el puesto REAL de
  // cada inscrito al importar un torneo, en vez de asumir que el orden del
  // listado pegado ya es el ranking.
  const [rankingDeporte, setRankingDeporte] = useState<'golf' | 'tenis'>('golf');
  const [rankingConteos, setRankingConteos] = useState<Record<'golf' | 'tenis', { total: number; actualizado: string | null }>>({
    golf: { total: 0, actualizado: null },
    tenis: { total: 0, actualizado: null },
  });
  const [rankingTexto, setRankingTexto] = useState('');
  const [rankingPreview, setRankingPreview] = useState<JugadorParseado[]>([]);
  const [guardandoRanking, setGuardandoRanking] = useState(false);
  const [resultadoRanking, setResultadoRanking] = useState<string | null>(null);
  const [errorRanking, setErrorRanking] = useState<string | null>(null);
  // Ranking mundial del deporte del torneo que se está importando ahora
  // mismo, cargado al pulsar "Previsualizar listado" — sirve para pintar
  // en cada fila si el jugador se ha encontrado o no (ver más abajo).
  const [mapaRankingActual, setMapaRankingActual] = useState<Map<string, number>>(new Map());

  // true si el listado pegado en "Nuevo torneo" trae cuotas reales (no el
  // respaldo por ranking) — decide qué columnas se ven en la vista previa y
  // qué precio se guarda al confirmar (ver confirmarImportacionTorneo()).
  const usandoCuotas = useMemo(() => previewJugadores.some((j) => j.cuota !== null), [previewJugadores]);
  const preciosPreviewCuota = useMemo(
    () => calcularPreciosPorCuota(previewJugadores.map((j) => ({ nombre: j.nombre, cuota: j.cuota }))),
    [previewJugadores]
  );
  // Puesto DENTRO DE ESTE TORNEO por cuota (más favorito = puesto 1) — es el
  // que decide el grupo de color de la porra clásica cuando hay cuotas
  // (corregido 23/09, ver lib/porraGrupos.ts). Se muestra en la vista previa
  // para que Iñi vea de un vistazo en qué lista caerá cada jugador antes de
  // confirmar — un array en paralelo a previewJugadores (mismo índice).
  const puestosPreviewPorCuota = useMemo(() => {
    const orden = previewJugadores
      .map((j, i) => ({ i, cuota: j.cuota }))
      .sort((a, b) => {
        const aValida = cuotaValida(a.cuota);
        const bValida = cuotaValida(b.cuota);
        if (aValida && bValida) return (a.cuota as number) - (b.cuota as number);
        if (aValida) return -1;
        if (bValida) return 1;
        return a.i - b.i;
      });
    const puestos = new Array<number | null>(previewJugadores.length).fill(null);
    orden.forEach((j, idx) => {
      puestos[j.i] = cuotaValida(j.cuota) ? idx + 1 : null;
    });
    return puestos;
  }, [previewJugadores]);
  // Puesto DENTRO DE ESTE TORNEO por ranking mundial guardado — respaldo
  // cuando el listado no trae cuotas (corregido 23/09, tercera vuelta — Iñi:
  // "en la lista amarilla del 1 al 15 tienen que salir los primeros 15
  // jugadores del ranking [de este torneo]", no los jugadores cuyo puesto
  // mundial absoluto sea <=15. Si el nº1 del ranking mundial no juega este
  // torneo, el mejor clasificado que sí juega tiene que poder ser Amarillo).
  // Mismo criterio de orden que ya usa el precio por ranking (ver
  // confirmarImportacionTorneo): encontrados por puesto mundial ascendente,
  // los no encontrados al final en el orden en que se pegaron.
  const puestosPreviewPorRankingMundial = useMemo(() => {
    const orden = previewJugadores
      .map((j, i) => ({ i, puestoGlobal: mapaRankingActual.get(normalizarNombre(j.nombre)) ?? null }))
      .sort((a, b) => (a.puestoGlobal ?? PUESTO_NO_ENCONTRADO) - (b.puestoGlobal ?? PUESTO_NO_ENCONTRADO) || a.i - b.i);
    const puestos = new Array<number | null>(previewJugadores.length).fill(null);
    orden.forEach((j, idx) => {
      puestos[j.i] = j.puestoGlobal !== null ? idx + 1 : null;
    });
    return puestos;
  }, [previewJugadores, mapaRankingActual]);

  async function cargarTodo() {
    const [{ data: salasData }, { data: porrasData }, { data: jugadoresData }, { count }, { data: inscripcionesData, error: inscripcionesError }, { data: movimientosData, error: movimientosError }] =
      await Promise.all([
        supabase.from('salas').select('id, codigo, nombre, deporte, tipo, estado, buy_in, competicion, fecha_limite_inscripcion').order('created_at', { ascending: false }),
        supabase.from('porras').select('id, major, competicion, estado, precio, fecha_limite_inscripcion').order('created_at', { ascending: false }),
        supabase.from('jugadores').select('id, nombre, deporte, competicion, precio, lesionado').order('created_at', { ascending: false }),
        // Solo el total (head: true, sin traer filas) — el listado completo
        // de usuarios vive en su propia pantalla (/admin/usuarios), a la que
        // se llega pulsando esta misma tarjeta (pedido de Iñi: no quería un
        // listado siempre visible aquí, solo accesible al pulsar el número).
        supabase.from('perfiles').select('id', { count: 'exact', head: true }),
        // Las inscripciones 'reembolsada' son dinero devuelto íntegro (la sala no se
        // llenó a tiempo y no había con quién juntarla) — no cuentan como partida
        // jugada ni deben sumar a la facturación real.
        supabase.from('inscripciones').select('importe, fecha, equipos!inner(modo, salas(deporte, tipo, buy_in))').neq('estado', 'reembolsada'),
        supabase.from('movimientos').select('tipo, importe, creado_en'),
      ]);

    setSalas((salasData as Sala[]) ?? []);
    setPorrasAdmin((porrasData as PorraAdmin[]) ?? []);
    setJugadores((jugadoresData as Jugador[]) ?? []);
    setTotalUsuarios(count ?? 0);
    if (inscripcionesError) setError('No se han podido cargar las estadísticas de partidas jugadas.');
    else setInscripciones((inscripcionesData as unknown as InscripcionFila[]) ?? []);
    if (movimientosError) setError('No se han podido cargar los movimientos de saldo.');
    else setMovimientos((movimientosData as MovimientoFila[]) ?? []);
  }

  async function cargarRankings() {
    const [{ data: golfData }, { data: tenisData }] = await Promise.all([
      supabase.from('rankings_mundiales').select('actualizado_en').eq('deporte', 'golf').order('actualizado_en', { ascending: false }).limit(1),
      supabase.from('rankings_mundiales').select('actualizado_en').eq('deporte', 'tenis').order('actualizado_en', { ascending: false }).limit(1),
    ]);
    const [{ count: golfCount }, { count: tenisCount }] = await Promise.all([
      supabase.from('rankings_mundiales').select('id', { count: 'exact', head: true }).eq('deporte', 'golf'),
      supabase.from('rankings_mundiales').select('id', { count: 'exact', head: true }).eq('deporte', 'tenis'),
    ]);
    setRankingConteos({
      golf: { total: golfCount ?? 0, actualizado: (golfData as { actualizado_en: string }[] | null)?.[0]?.actualizado_en ?? null },
      tenis: { total: tenisCount ?? 0, actualizado: (tenisData as { actualizado_en: string }[] | null)?.[0]?.actualizado_en ?? null },
    });
  }

  async function cargarCargasValorMercado() {
    const { data } = await supabase.from('cargas_valor_mercado_futbol').select('liga, cargado_en, jugadores_actualizados');
    const filas = (data as { liga: LigaFutbol; cargado_en: string; jugadores_actualizados: number }[] | null) ?? [];
    setCargasValorMercado((prev) => {
      const siguiente = { ...prev };
      for (const f of filas) siguiente[f.liga] = { cargadoEn: f.cargado_en, jugadoresActualizados: f.jugadores_actualizados };
      return siguiente;
    });
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
      await Promise.all([cargarTodo(), cargarRankings(), cargarCargasValorMercado()]);
    }

    verificarAcceso();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function crearSala(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreandoSala(true);

    const { error: insertError } = await supabase.from('salas').insert({
      nombre: nombreSala,
      deporte: deporteSala,
      competicion: competicionSala,
      tipo: tipoSala,
      // Maratón no tiene aforo fijo (inscripción sin límite).
      aforo: tipoSala === 'maraton' ? null : aforoSala,
      buy_in: buyInSala,
    });

    setCreandoSala(false);

    if (insertError) {
      setError('No se ha podido crear la mesa. Revisa los datos e inténtalo de nuevo.');
      return;
    }

    setNombreSala('');
    setCompeticionSala('');
    await cargarTodo();
  }

  async function crearJugador(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreandoJugador(true);

    const { error: insertError } = await supabase.from('jugadores').insert({
      nombre: nombreJugador,
      deporte: deporteJugador,
      competicion: competicionJugador,
      precio: precioJugador,
    });

    setCreandoJugador(false);

    if (insertError) {
      setError('No se ha podido añadir el jugador. Revisa los datos e inténtalo de nuevo.');
      return;
    }

    setNombreJugador('');
    setCompeticionJugador('');
    await cargarTodo();
  }

  async function sincronizarJornadaFutbol() {
    setErrorFutbol(null);
    setResultadoFutbol(null);
    setSincronizandoFutbol(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setSincronizandoFutbol(false);
      setErrorFutbol('Tu sesión ha caducado. Vuelve a iniciar sesión.');
      return;
    }

    try {
      const res = await fetch('/api/admin/sync-jornada-futbol', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorFutbol(body.error ?? 'No se ha podido sincronizar la jornada.');
      } else {
        setResultadoFutbol(body.resultados);
        await cargarTodo();
      }
    } catch {
      setErrorFutbol('No se ha podido conectar con el servidor. Inténtalo de nuevo.');
    }
    setSincronizandoFutbol(false);
  }

  // --- Valor de mercado de fútbol (ENCARGO A.4) ---

  async function previsualizarValorMercado() {
    setResultadoValorMercado(null);
    setErrorValorMercado(null);
    setPreviewValorMercado(null);
    setCalculandoPreviewValor(true);

    const { filas, avisos } = parsearValoresMercado(textoValorMercado);

    const prefijo = LIGA_FUTBOL_PREFIJO[ligaValorMercado];
    const { data, error: fetchError } = await supabase
      .from('jugadores')
      .select('id, nombre, equipo_real, posicion, valor_mercado, competicion')
      .eq('deporte', 'futbol')
      .ilike('competicion', `${prefijo}%`);

    setCalculandoPreviewValor(false);

    if (fetchError) {
      setErrorValorMercado('No se han podido cargar los jugadores de esta competición. Inténtalo de nuevo.');
      return;
    }

    // Ya no hace falta ninguna sincronización previa por API: si esta liga
    // no tiene todavía ningún jugador guardado, es la primera carga — todas
    // las filas pegadas se crean como jugadores nuevos (25/09).
    const jugadoresDb = (data as JugadorFutbolDb[] | null) ?? [];
    const equiposCandidatos = Array.from(new Set(jugadoresDb.map((j) => j.equipo_real).filter((e): e is string => !!e)));

    const actualizados: FilaValorActualizada[] = [];
    const nuevos: FilaValorNueva[] = [];
    const errores: FilaValorError[] = [];
    const usados = new Set<string>();
    const avisosPosicion: string[] = [];

    for (const fila of filas) {
      if (!fila.posicion) {
        errores.push({ ...fila, motivo: `Posición "${fila.posicionOrigen}" no reconocida — usa portero/defensa/centrocampista/delantero.` });
        continue;
      }
      // Si el equipo ya se conocía (partidas anteriores de esta liga), se
      // emparejan nombres distintos del mismo equipo real (lib/aliasEquipos.ts,
      // p.ej. "Atlético" = "Club Atlético de Madrid"). Si el equipo es nuevo
      // del todo (primera carga de la liga, o un equipo recién visto), se da
      // por bueno tal cual está escrito — a partir de ahora es su nombre
      // canónico.
      const equipoDb = equiposCandidatos.length > 0 ? emparejarEquipo(fila.equipo, equiposCandidatos) : null;
      const equipoFinal = equipoDb ?? fila.equipo;

      const jugadoresDelEquipo = equipoDb ? jugadoresDb.filter((j) => j.equipo_real === equipoDb) : [];
      const nombreNormalizado = normalizarNombre(fila.jugador);
      const apodoNormalizado = fila.apodo ? normalizarNombre(fila.apodo) : null;
      let jugadorDb = jugadoresDelEquipo.find((j) => normalizarNombre(j.nombre) === nombreNormalizado);
      if (!jugadorDb && apodoNormalizado) {
        jugadorDb = jugadoresDelEquipo.find((j) => normalizarNombre(j.nombre) === apodoNormalizado);
      }

      if (jugadorDb) {
        actualizados.push({
          jugadorId: jugadorDb.id,
          nombreDb: jugadorDb.nombre,
          equipoDb: equipoFinal,
          equipoOrigen: fila.equipo,
          jugadorOrigen: fila.jugador,
          posicion: fila.posicion,
          valor: fila.valor,
          probabilidadTitular: fila.probabilidadTitular,
        });
        usados.add(jugadorDb.id);
      } else {
        nuevos.push({
          equipo: equipoFinal,
          jugador: fila.jugador,
          posicion: fila.posicion,
          valor: fila.valor,
          probabilidadTitular: fila.probabilidadTitular,
        });
      }
    }

    const sinValorEnPlantilla = jugadoresDb.filter((j) => !usados.has(j.id)).map((j) => ({ id: j.id, nombre: j.nombre, equipo: j.equipo_real }));

    setAvisosValorMercado([...avisos, ...avisosPosicion]);
    setPreviewValorMercado({ actualizados, nuevos, errores, sinValorEnPlantilla });
  }

  async function guardarValorMercado() {
    if (!previewValorMercado || (previewValorMercado.actualizados.length === 0 && previewValorMercado.nuevos.length === 0)) return;
    setGuardandoValorMercado(true);
    setErrorValorMercado(null);
    setResultadoValorMercado(null);

    const { actualizados, nuevos } = previewValorMercado;

    if (actualizados.length > 0) {
      // nombre/deporte incluidos también aquí por el mismo motivo que en
      // confirmarJornadaFutbol() más abajo (bug real de Iñi, 25/09): el
      // upsert de PostgREST comprueba las columnas NOT NULL sin default
      // (nombre, deporte) antes de resolver el conflicto por id, aunque
      // estos jugadores ya existan y el UPDATE final no las toque.
      const { error: errorValores } = await supabase.from('jugadores').upsert(
        actualizados.map((f) => ({
          id: f.jugadorId,
          nombre: f.nombreDb,
          deporte: 'futbol',
          valor_mercado: f.valor,
          posicion: f.posicion,
          equipo_real: f.equipoDb,
        })),
        { onConflict: 'id' }
      );
      if (errorValores) {
        setGuardandoValorMercado(false);
        setErrorValorMercado('No se han podido guardar los valores. Inténtalo de nuevo.');
        return;
      }
      const conProbabilidad = actualizados.filter((f) => f.probabilidadTitular !== null);
      if (conProbabilidad.length > 0) {
        await supabase.from('jugadores').upsert(
          conProbabilidad.map((f) => ({
            id: f.jugadorId,
            nombre: f.nombreDb,
            deporte: 'futbol',
            probabilidad_titular: f.probabilidadTitular,
          })),
          { onConflict: 'id' }
        );
      }
    }

    if (nuevos.length > 0) {
      const { error: errorNuevos } = await supabase.from('jugadores').insert(
        nuevos.map((f) => ({
          nombre: f.jugador,
          deporte: 'futbol',
          // Etiqueta de partida (sin jornada todavía) — al crear una jornada
          // para esta liga (ver "Nuevo torneo o jornada" más abajo) se
          // sustituye por "<Liga> - <nombre de la jornada>" para los
          // jugadores cuyo equipo juegue esa jornada.
          competicion: LIGA_FUTBOL_PREFIJO[ligaValorMercado],
          equipo_real: f.equipo,
          posicion: f.posicion,
          valor_mercado: f.valor,
          probabilidad_titular: f.probabilidadTitular,
          precio: precioFutbolPorPosicion(f.posicion),
        }))
      );
      if (errorNuevos) {
        setGuardandoValorMercado(false);
        setErrorValorMercado('Los valores existentes se han guardado, pero no se han podido crear los jugadores nuevos. Inténtalo de nuevo.');
        return;
      }
    }

    const totalGuardados = actualizados.length + nuevos.length;
    await supabase
      .from('cargas_valor_mercado_futbol')
      .upsert({ liga: ligaValorMercado, cargado_en: new Date().toISOString(), jugadores_actualizados: totalGuardados }, { onConflict: 'liga' });

    setGuardandoValorMercado(false);
    setResultadoValorMercado(
      `Valores de ${LIGA_FUTBOL_LABEL[ligaValorMercado]} guardados: ${actualizados.length} actualizados, ${nuevos.length} jugadores nuevos.`
    );
    setTextoValorMercado('');
    setPreviewValorMercado(null);
    setAvisosValorMercado([]);
    await cargarCargasValorMercado();
    await cargarTodo();
  }

  // --- Nueva jornada de fútbol (25/09: ya no depende de football-data.org —
  // Iñi le pone él mismo el nombre a la jornada, sobre la liga elegida, y
  // pega las cuotas 1X2 de sus partidos; eso calcula el precio final de cada
  // jugador de esos equipos a partir del valor de mercado ya cargado (ver
  // "Valor de mercado de fútbol") y, al confirmar, abre las mesas — mismo
  // papel que "Nuevo torneo" cumple para golf/tenis. Ver confirmarJornadaFutbol()
  // y la rama torneoDeporte === 'futbol' de "Nuevo torneo o jornada" en el JSX. ---

  function nombreJornadaFutbolCompleto() {
    return `${LIGA_FUTBOL_PREFIJO[ligaJornadaFutbol]} - ${torneoNombre.trim()}`;
  }

  async function previsualizarJornadaFutbol() {
    setResultadoCuotas(null);
    setErrorCuotas(null);
    setPreviewCuotas(null);
    if (!torneoNombre.trim()) {
      setErrorCuotas('Ponle primero un nombre a la jornada (p.ej. "Jornada 9").');
      return;
    }
    setCalculandoPreviewCuotas(true);

    const { partidos, avisos } = parsearCuotasPartidosFutbol(textoCuotas);

    // Todos los jugadores de esta liga con valor de mercado ya cargado (no
    // solo los de una jornada concreta — la jornada todavía no existe, se
    // crea al confirmar). Los equipos que no aparezcan en las cuotas pegadas
    // simplemente no entran en esta jornada — se quedan como estaban.
    const prefijo = LIGA_FUTBOL_PREFIJO[ligaJornadaFutbol];
    const { data, error: fetchError } = await supabase
      .from('jugadores')
      .select('id, nombre, equipo_real, posicion, valor_mercado, competicion')
      .eq('deporte', 'futbol')
      .ilike('competicion', `${prefijo}%`);

    setCalculandoPreviewCuotas(false);

    if (fetchError) {
      setErrorCuotas('No se han podido cargar los jugadores de esta liga. Inténtalo de nuevo.');
      return;
    }

    const jugadoresLiga = (data as JugadorFutbolDb[] | null) ?? [];
    if (jugadoresLiga.length === 0) {
      setErrorCuotas(`Todavía no hay ningún jugador de ${LIGA_FUTBOL_LABEL[ligaJornadaFutbol]} cargado — pega antes su valor de mercado ("Valor de mercado de fútbol", más arriba).`);
      return;
    }

    const equiposDeLaLiga = Array.from(new Set(jugadoresLiga.map((j) => j.equipo_real).filter((e): e is string => !!e)));

    const partidosResueltos: { equipoLocal: string; equipoVisitante: string; cuota1: number; cuotaX: number; cuota2: number }[] = [];
    const partidosNoEmparejados: string[] = [];
    for (const p of partidos) {
      const local = emparejarEquipo(p.equipoLocal, equiposDeLaLiga);
      const visitante = emparejarEquipo(p.equipoVisitante, equiposDeLaLiga);
      if (!local || !visitante) {
        partidosNoEmparejados.push(`${p.equipoLocal} - ${p.equipoVisitante}${!local ? ` (no se reconoce "${p.equipoLocal}")` : ''}${!visitante ? ` (no se reconoce "${p.equipoVisitante}")` : ''}`);
        continue;
      }
      partidosResueltos.push({ equipoLocal: local, equipoVisitante: visitante, cuota1: p.cuota1, cuotaX: p.cuotaX, cuota2: p.cuota2 });
    }

    // Solo entran en esta jornada los jugadores cuyo equipo aparece en un
    // partido con cuota reconocida — el resto de la plantilla de la liga se
    // queda fuera (no se les toca el precio ni la competición).
    const equiposDeLaJornada = new Set(partidosResueltos.flatMap((p) => [p.equipoLocal, p.equipoVisitante]));
    const jugadoresDb = jugadoresLiga.filter((j) => j.equipo_real && equiposDeLaJornada.has(j.equipo_real));

    if (jugadoresDb.length === 0) {
      setErrorCuotas('Ninguno de los equipos de las cuotas pegadas se ha podido emparejar con jugadores ya cargados de esta liga — revisa los nombres de equipo.');
      return;
    }

    const fuerzaEquipo = fuerzaPorEquipo(partidosResueltos);

    const jugadoresSinPosicion = jugadoresDb.filter((j) => !j.posicion);
    const entrada = jugadoresDb
      .filter((j): j is JugadorFutbolDb & { posicion: PosicionFutbol } => !!j.posicion)
      .map((j) => {
        const fuerza = j.equipo_real ? fuerzaEquipo.get(j.equipo_real) : undefined;
        const factor = fuerza !== undefined ? factorPosicion(fuerza, j.posicion) : 1;
        return { id: j.id, posicion: j.posicion, valorMercado: j.valor_mercado, factorPartido: factor };
      });

    const resultado = calcularPreciosFutbolDetallado(entrada);
    const porId = new Map(jugadoresDb.map((j) => [j.id, j]));
    const precios = resultado.precios.map((p) => ({ ...p, nombre: porId.get(p.id)?.nombre ?? '?', equipoReal: porId.get(p.id)?.equipo_real ?? null }));

    const avisosTotales = [...avisos];
    if (jugadoresSinPosicion.length > 0) {
      avisosTotales.push(`${jugadoresSinPosicion.length} jugador(es) sin posición conocida, no se les ha calculado precio: ${jugadoresSinPosicion.map((j) => j.nombre).join(', ')}`);
    }
    setAvisosCuotasFutbol(avisosTotales);
    setPreviewCuotas({
      precios,
      partidosSinCuota: [], // ya no aplica: solo entran equipos con cuota, ver partidosNoEmparejados para lo que sí faltó
      partidosNoEmparejados,
      topeUsado: resultado.topeUsado,
      gammaUsado: resultado.gammaUsado,
      reglasCumplidas: resultado.reglasCumplidas,
    });
  }

  async function confirmarJornadaFutbol() {
    if (!previewCuotas || previewCuotas.precios.length === 0) return;
    setGuardandoCuotas(true);
    setErrorCuotas(null);
    setResultadoCuotas(null);

    const nombreJornada = nombreJornadaFutbolCompleto();

    // Fija el precio, marca la jornada (competicion) de cada jugador que
    // juega esta jornada, y le pone al día su equipo (por si vino de un
    // alias distinto). Antes de esto estos jugadores podían pertenecer a la
    // jornada anterior de la misma liga (o a ninguna, si es su primera
    // jornada) — sustituye ese valor sin más, igual que hacía la
    // sincronización automática por API.
    // nombre/deporte van también en el upsert aunque estos jugadores ya
    // existan: PostgREST hace el upsert como "INSERT ... ON CONFLICT (id) DO
    // UPDATE", y Postgres exige que la fila del INSERT cumpla ya las
    // columnas NOT NULL sin default (nombre, deporte) ANTES de comprobar el
    // conflicto — aunque el UPDATE final no las vaya a tocar, si no van en
    // el objeto Postgres intenta insertarlas como null y falla. Bug real
    // encontrado por Iñi al confirmar una jornada de 639 jugadores.
    const { error: errorPrecios } = await supabase.from('jugadores').upsert(
      previewCuotas.precios.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        deporte: 'futbol',
        precio: p.precio,
        valor_a_revisar: p.sinValor,
        competicion: nombreJornada,
      })),
      { onConflict: 'id' }
    );

    if (errorPrecios) {
      setGuardandoCuotas(false);
      setErrorCuotas('No se han podido guardar los precios. Inténtalo de nuevo.');
      return;
    }

    const { partidos } = parsearCuotasPartidosFutbol(textoCuotas);
    const equiposDeLaJornada = Array.from(new Set(previewCuotas.precios.map((p) => p.equipoReal).filter((e): e is string => !!e)));
    const filasCuotas = partidos
      .map((p) => {
        const local = emparejarEquipo(p.equipoLocal, equiposDeLaJornada);
        const visitante = emparejarEquipo(p.equipoVisitante, equiposDeLaJornada);
        if (!local || !visitante) return null;
        return { competicion: nombreJornada, equipo_local: local, equipo_visitante: visitante, cuota_1: p.cuota1, cuota_x: p.cuotaX, cuota_2: p.cuota2 };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    if (filasCuotas.length > 0) {
      await supabase.from('cuotas_partido_futbol').upsert(filasCuotas, { onConflict: 'competicion,equipo_local,equipo_visitante' });
    }

    // Igual que al abrir un torneo de golf/tenis: crea las mesas de esta
    // jornada si todavía no existían (nunca duplica si se confirma dos
    // veces por error).
    let salasCreadas = 0;
    if (crearMesas) {
      const fechaLimiteIso = torneoFechaLimite ? new Date(torneoFechaLimite).toISOString() : null;
      const { count: salasExistentes } = await supabase
        .from('salas')
        .select('id', { count: 'exact', head: true })
        .eq('competicion', nombreJornada);
      if (!salasExistentes) {
        const nuevasSalas = generarSalasParaTorneo({ competicionLabel: nombreJornada, deporte: 'futbol', fechaLimiteIso });
        const { error: salasError } = await supabase.from('salas').insert(nuevasSalas);
        if (!salasError) salasCreadas = nuevasSalas.length;
      }
    }

    setGuardandoCuotas(false);
    setResultadoCuotas(
      `"${nombreJornada}" creada: ${previewCuotas.precios.length} jugadores con precio (TOPE ${previewCuotas.topeUsado} €, γ ${previewCuotas.gammaUsado}).` +
        (crearMesas ? ` ${salasCreadas} salas nuevas creadas.` : ' Mesas de Drafters no marcadas para crear.')
    );
    setTextoCuotas('');
    setTorneoNombre('');
    setTorneoFechaLimite('');
    setPreviewCuotas(null);
    setAvisosCuotasFutbol([]);
    await cargarTodo();
  }

  async function previsualizarTorneo() {
    setResultadoTorneo(null);

    // Primero se intenta leer el listado como nombre + cuota de "Ganador"
    // (lib/parsearCuotas.ts) — si trae al menos una cuota reconocible, el
    // precio de cada jugador saldrá de ahí (lib/precioPorCuota.ts). Si no
    // se reconoce ninguna cuota (p. ej. Iñi ha pegado solo una lista de
    // nombres, como antes), se cae al importador antiguo por ranking.
    const { jugadores: conCuota, avisos } = parsearListadoCuotas(torneoTexto);
    if (conCuota.length > 0) {
      setPreviewJugadores(conCuota.map((j, i) => ({ nombre: j.nombre, rank: i + 1, esEspanol: false, cuota: j.cuota })));
      setAvisosCuotas(avisos);
    } else {
      setPreviewJugadores(parseListaJugadores(torneoTexto).map((j) => ({ ...j, esEspanol: false, cuota: null })));
      setAvisosCuotas([]);
    }

    // Carga el ranking mundial de este deporte para poder mostrar, fila a
    // fila, si cada jugador se ha encontrado o no — el grupo de color de la
    // porra clásica sigue saliendo de aquí (no de la cuota), así que esto
    // no cambia con el precio por cuotas. Así Iñi puede corregir el nombre
    // en la vista previa ANTES de confirmar, en vez de enterarse después
    // con el aviso de "no encontrados".
    const { data } = await supabase.from('rankings_mundiales').select('nombre, puesto').eq('deporte', torneoDeporte);
    const mapa = new Map<string, number>();
    ((data as { nombre: string; puesto: number }[] | null) ?? []).forEach((r) => mapa.set(normalizarNombre(r.nombre), r.puesto));
    setMapaRankingActual(mapa);
  }

  function quitarDeVistaPrevia(index: number) {
    setPreviewJugadores((prev) => prev.filter((_, i) => i !== index));
  }

  function editarNombreVistaPrevia(index: number, nombre: string) {
    setPreviewJugadores((prev) => prev.map((j, i) => (i === index ? { ...j, nombre } : j)));
  }

  function editarCuotaVistaPrevia(index: number, texto: string) {
    const cuota = texto.trim() === '' ? null : Number(texto);
    setPreviewJugadores((prev) => prev.map((j, i) => (i === index ? { ...j, cuota: cuota !== null && Number.isFinite(cuota) ? cuota : null } : j)));
  }

  function toggleEspanolVistaPrevia(index: number) {
    setPreviewJugadores((prev) => prev.map((j, i) => (i === index ? { ...j, esEspanol: !j.esEspanol } : j)));
  }

  function previsualizarRanking() {
    setResultadoRanking(null);
    setErrorRanking(null);
    setRankingPreview(parseListaJugadores(rankingTexto));
  }

  function quitarDeRankingPreview(index: number) {
    setRankingPreview((prev) => prev.filter((_, i) => i !== index));
  }

  function editarNombreRankingPreview(index: number, nombre: string) {
    setRankingPreview((prev) => prev.map((j, i) => (i === index ? { ...j, nombre } : j)));
  }

  async function guardarRanking() {
    if (rankingPreview.length === 0) return;
    setGuardandoRanking(true);
    setErrorRanking(null);
    setResultadoRanking(null);

    // reemplazar_ranking_mundial() borra e inserta en una sola transacción
    // (ver drafters-schema.sql) — sustituye SIEMPRE la lista entera de este
    // deporte, nunca hace un merge fila a fila con la anterior.
    const { error: rpcError } = await supabase.rpc('reemplazar_ranking_mundial', {
      p_deporte: rankingDeporte,
      p_jugadores: rankingPreview.map((j) => ({ nombre: j.nombre, puesto: j.rank })),
    });

    setGuardandoRanking(false);
    if (rpcError) {
      setErrorRanking('No se ha podido guardar el ranking. Inténtalo de nuevo.');
      return;
    }

    setResultadoRanking(`Ranking de ${rankingDeporte === 'golf' ? 'golf' : 'tenis'} actualizado: ${rankingPreview.length} jugadores.`);
    setRankingPreview([]);
    setRankingTexto('');
    await cargarRankings();
  }

  async function confirmarImportacionTorneo() {
    const nombreTorneo = torneoNombre.trim();
    if (!nombreTorneo || previewJugadores.length === 0) return;

    setImportandoTorneo(true);
    setError(null);
    setResultadoTorneo(null);

    const total = previewJugadores.length;
    const esGolf = torneoDeporte === 'golf';

    // Cruza el listado de inscritos contra el ranking mundial guardado
    // (sección 4.5 del esquema) — el precio y el grupo de porra de cada
    // jugador se calculan a partir de su puesto REAL, no del orden en que
    // se pegó el listado de este torneo (pedido de Iñi, 23/09). Un jugador
    // que no aparezca en el ranking mundial se trata como si tuviera un
    // puesto muy bajo: nunca cae en Amarillo/Verde, y su precio queda cerca
    // del mínimo — nunca bloquea la importación.
    const { data: rankingData } = await supabase.from('rankings_mundiales').select('nombre, puesto').eq('deporte', torneoDeporte);
    const mapaRanking = new Map<string, number>();
    ((rankingData as { nombre: string; puesto: number }[] | null) ?? []).forEach((r) => {
      mapaRanking.set(normalizarNombre(r.nombre), r.puesto);
    });

    let noEncontrados = 0;
    const conPuestoGlobal = previewJugadores.map((j, i) => {
      const puestoGlobal = mapaRanking.get(normalizarNombre(j.nombre));
      if (puestoGlobal === undefined) noEncontrados += 1;
      return { ...j, i, puestoGlobal: puestoGlobal ?? null };
    });

    // Precio (23/09): si el listado pegado traía cuotas de "Ganador", el
    // precio de cada jugador sale de ahí (lib/precioPorCuota.ts) — ya no
    // del ranking mundial. Si no había ninguna cuota reconocible (se pegó
    // solo una lista de nombres), se mantiene el cálculo antiguo por
    // ranking como respaldo, exactamente igual que antes.
    const precioPorIndice = new Map<number, number>();
    // Grupo de la porra clásica (23/09, tercera corrección — Iñi: "me has
    // entendido mal" otra vez): el puesto que decide el tramo (Amarillo/
    // Verde/Azul/Morado) es SIEMPRE la posición DENTRO DE ESTE TORNEO, nunca
    // un puesto absoluto — con cuotas, por la cuota de "Ganador" (más
    // favorito = puesto 1); sin cuotas, por el ranking mundial guardado,
    // pero reordenando el campo de este torneo por ese ranking y usando la
    // posición resultante DENTRO DEL CAMPO (idéntico criterio al precio por
    // ranking, precioPorRanking) — no si el puesto mundial absoluto del
    // jugador es <=15. Antes de esta corrección se usaba el puesto absoluto
    // del ranking mundial para el grupo cuando no había cuotas: si el nº1
    // del mundo no jugaba este torneo, la lista Amarillo se quedaba vacía
    // aunque hubiera 15 jugadores razonables en el campo — eso era el
    // malentendido.
    const puestoParaGrupo = new Map<number, number>();
    if (usandoCuotas) {
      const conPrecioCuota = calcularPreciosPorCuota(previewJugadores.map((j) => ({ nombre: j.nombre, cuota: j.cuota })));
      conPrecioCuota.forEach((p, i) => precioPorIndice.set(i, p.precio));

      const ordenPorCuota = previewJugadores
        .map((j, i) => ({ i, cuota: j.cuota }))
        .sort((a, b) => {
          const aValida = cuotaValida(a.cuota);
          const bValida = cuotaValida(b.cuota);
          if (aValida && bValida) return (a.cuota as number) - (b.cuota as number);
          if (aValida) return -1;
          if (bValida) return 1;
          return a.i - b.i;
        });
      ordenPorCuota.forEach((j, idx) => puestoParaGrupo.set(j.i, cuotaValida(j.cuota) ? idx + 1 : PUESTO_NO_ENCONTRADO));
    } else {
      // Reordena el campo de este torneo según el puesto mundial real (los
      // no encontrados van al final, en el orden en que venían) y usa esa
      // posición DENTRO DEL CAMPO tanto para el precio (precioPorRanking)
      // como para el grupo de la porra — misma orden, mismo índice relativo.
      const ordenPorRankingMundial = [...conPuestoGlobal].sort((a, b) => (a.puestoGlobal ?? PUESTO_NO_ENCONTRADO) - (b.puestoGlobal ?? PUESTO_NO_ENCONTRADO) || a.i - b.i);
      ordenPorRankingMundial.forEach((j, idx) => {
        precioPorIndice.set(j.i, precioPorRanking(idx + 1, total));
        puestoParaGrupo.set(j.i, idx + 1);
      });
    }

    const numEspanoles = esGolf ? previewJugadores.filter((j) => j.esEspanol).length : 0;
    const filas = conPuestoGlobal.map((j) => ({
      nombre: j.nombre,
      deporte: torneoDeporte,
      competicion: nombreTorneo,
      precio: precioPorIndice.get(j.i)!,
      // El grupo de la porra clásica (listas por color) solo aplica a golf
      // por ahora — ver lib/porraGrupos.ts para la regla completa.
      grupo_porra: esGolf ? calcularGrupoPorra(puestoParaGrupo.get(j.i) ?? PUESTO_NO_ENCONTRADO, j.esEspanol, numEspanoles) : null,
      es_espanol: esGolf ? j.esEspanol : false,
    }));

    // Si ya había jugadores de este mismo torneo (competición + deporte) —
    // p.ej. porque se pegó el listado dos veces por error, o porque se está
    // reimportando a propósito para corregir algo — se sustituyen enteros
    // por el listado nuevo en vez de añadirse encima. Antes, al no
    // comprobarse esto, un reimport accidental dejaba a cada jugador
    // duplicado dentro de la porra (bug reportado por Iñi, 23/09: "Open de
    // Francia" con cada jugador dos veces). Mismo criterio de "sustituir
    // entero" que reemplazarRanking() ya usa para el ranking mundial.
    const { error: borrarError } = await supabase.from('jugadores').delete().eq('deporte', torneoDeporte).eq('competicion', nombreTorneo);
    if (borrarError) {
      setImportandoTorneo(false);
      setError('No se ha podido preparar la importación (borrado de jugadores previos). Inténtalo de nuevo.');
      return;
    }

    const { error: insertError } = await supabase.from('jugadores').insert(filas);
    if (insertError) {
      setImportandoTorneo(false);
      setError('No se han podido importar los jugadores. Revisa el listado e inténtalo de nuevo.');
      return;
    }

    const fechaLimiteIso = torneoFechaLimite ? new Date(torneoFechaLimite).toISOString() : null;

    let salasCreadas = 0;
    if (crearMesas) {
      const { count: salasExistentes } = await supabase
        .from('salas')
        .select('id', { count: 'exact', head: true })
        .eq('competicion', nombreTorneo);

      if (!salasExistentes) {
        const nuevasSalas = generarSalasParaTorneo({
          competicionLabel: nombreTorneo,
          deporte: torneoDeporte,
          fechaLimiteIso,
        });
        const { error: salasError } = await supabase.from('salas').insert(nuevasSalas);
        if (!salasError) salasCreadas = nuevasSalas.length;
      }
    }

    // Porra clásica: por ahora solo para golf, una por torneo, usando el
    // mismo listado de jugadores (ya repartido en sus listas por color).
    let porraCreada = false;
    if (esGolf && crearPorraCheck) {
      const { count: porraExistente } = await supabase
        .from('porras')
        .select('id', { count: 'exact', head: true })
        .eq('competicion', nombreTorneo);
      if (!porraExistente) {
        const { error: porraError } = await supabase.from('porras').insert({
          major: nombreTorneo,
          competicion: nombreTorneo,
          fecha_limite_inscripcion: fechaLimiteIso,
          estado: 'disponible',
        });
        if (!porraError) porraCreada = true;
      }
    }

    const sinCuotaValida = usandoCuotas ? previewJugadores.filter((j) => !cuotaValida(j.cuota)).length : 0;

    setImportandoTorneo(false);
    setResultadoTorneo(
      `Importados ${filas.length} jugadores de "${nombreTorneo}" (precio ${usandoCuotas ? 'por cuota' : 'por ranking'}).` +
        (crearMesas ? ` ${salasCreadas} salas nuevas creadas.` : ' Mesas de Drafters no marcadas para crear.') +
        (esGolf ? (crearPorraCheck ? ` ${porraCreada ? 'Porra clásica creada.' : 'Porra clásica ya existía.'}` : ' Porra clásica no marcada para crear.') : '') +
        (noEncontrados > 0
          ? ` ⚠️ ${noEncontrados} jugador${noEncontrados === 1 ? '' : 'es'} no ${noEncontrados === 1 ? 'se ha encontrado' : 'se han encontrado'} en el ranking mundial de ${esGolf ? 'golf' : 'tenis'} — revisa que el nombre coincida exactamente, si no ${esGolf ? 'su grupo de porra se ha calculado' : 'se ha calculado'} como si fuera de los últimos del ranking${usandoCuotas ? ' (el precio no se ve afectado, viene de la cuota)' : '.'}`
          : '') +
        (sinCuotaValida > 0
          ? ` ⚠️ ${sinCuotaValida} jugador${sinCuotaValida === 1 ? '' : 'es'} sin cuota válida — se ${sinCuotaValida === 1 ? 'le' : 'les'} ha puesto el precio mínimo (${new Intl.NumberFormat('es-ES').format(3500)} €).`
          : '')
    );
    setPreviewJugadores([]);
    setAvisosCuotas([]);
    setTorneoTexto('');
    setTorneoNombre('');
    setTorneoFechaLimite('');
    setCrearMesas(true);
    setCrearPorraCheck(true);
    await cargarTodo();
  }

  async function toggleLesionado(jugador: Jugador) {
    await supabase.from('jugadores').update({ lesionado: !jugador.lesionado }).eq('id', jugador.id);
    await cargarTodo();
  }

  // Eliminar un jugador concreto de la ficha maestra (pedido de Iñi, 23/09:
  // "por ejemplo se ha dado de baja del torneo, poder eliminarlo de esa
  // lista") — a diferencia de "Marcar lesión" (que lo deja elegible pero
  // avisando), esto lo quita del todo: ya no se puede fichar. Si algún
  // equipo ya lo había elegido antes de la baja, su ficha simplemente deja
  // de aparecer en ese equipo — no se reembolsa ni se deshace nada más, es
  // el mismo riesgo que ya se avisa en la pantalla de confirmar equipo.
  const [eliminandoJugadorId, setEliminandoJugadorId] = useState<string | null>(null);

  async function eliminarJugador(jugador: Jugador) {
    if (!window.confirm(`¿Estás seguro de que quieres eliminar a "${jugador.nombre}" de esta lista? No se puede deshacer.`)) {
      return;
    }
    setEliminandoJugadorId(jugador.id);
    await supabase.from('jugadores').delete().eq('id', jugador.id);
    setEliminandoJugadorId(null);
    await cargarTodo();
  }

  function empezarEdicionPrecio(jugador: Jugador) {
    setEditandoPrecioId(jugador.id);
    setPrecioEditado(String(jugador.precio));
  }

  async function guardarPrecioEditado(jugador: Jugador) {
    const nuevoPrecio = Number(precioEditado);
    if (!Number.isFinite(nuevoPrecio) || nuevoPrecio < 0) return;
    setGuardandoPrecio(true);
    await supabase.from('jugadores').update({ precio: nuevoPrecio }).eq('id', jugador.id);
    setGuardandoPrecio(false);
    setEditandoPrecioId(null);
    await cargarTodo();
  }

  async function cerrarSala(sala: Sala) {
    await supabase.from('salas').update({ estado: 'finalizada' }).eq('id', sala.id);
    await cargarTodo();
  }

  // Eliminar torneo/jornada y eliminar porra (pedido de Iñi, 23/09): borra
  // de verdad, reembolsando y avisando a quien estuviera inscrito (todo
  // eso lo hace la función de base de datos, en una sola transacción — ver
  // eliminar_torneo()/eliminar_porra() en drafters-schema.sql).
  const [eliminandoTorneo, setEliminandoTorneo] = useState<string | null>(null);
  const [eliminandoPorraId, setEliminandoPorraId] = useState<string | null>(null);

  async function eliminarTorneo(competicion: string, deporte: string) {
    if (!window.confirm(`¿Estás seguro de que quieres eliminar el torneo/jornada "${competicion}" (${deporte})? Se borrarán todas sus mesas, se reembolsará a los inscritos y se les avisará. Esta acción no se puede deshacer.`)) {
      return;
    }
    setEliminandoTorneo(competicion);
    setError(null);
    const { error: rpcError } = await supabase.rpc('eliminar_torneo', { p_competicion: competicion });
    setEliminandoTorneo(null);
    if (rpcError) {
      setError('No se ha podido eliminar el torneo/jornada. Inténtalo de nuevo.');
      return;
    }
    await cargarTodo();
  }

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

  // Editar torneo/jornada: por ahora, la fecha límite de inscripción (el
  // campo que de verdad afecta a todas sus mesas y a su porra a la vez) —
  // se aplica a todas las salas de esa competición y, si la hay, también a
  // su porra clásica, en la misma acción.
  const [editandoFechaTorneo, setEditandoFechaTorneo] = useState<string | null>(null);
  const [fechaTorneoEditada, setFechaTorneoEditada] = useState('');
  const [guardandoFechaTorneo, setGuardandoFechaTorneo] = useState(false);

  function empezarEdicionFechaTorneo(competicion: string, fechaActual: string | null) {
    setEditandoFechaTorneo(competicion);
    setFechaTorneoEditada(fechaActual ? fechaActual.slice(0, 16) : '');
  }

  async function guardarFechaTorneo(competicion: string) {
    setGuardandoFechaTorneo(true);
    const nuevaFechaIso = fechaTorneoEditada ? new Date(fechaTorneoEditada).toISOString() : null;
    await Promise.all([
      supabase.from('salas').update({ fecha_limite_inscripcion: nuevaFechaIso }).eq('competicion', competicion),
      supabase.from('porras').update({ fecha_limite_inscripcion: nuevaFechaIso }).eq('competicion', competicion),
    ]);
    setGuardandoFechaTorneo(false);
    setEditandoFechaTorneo(null);
    await cargarTodo();
  }

  // Editar una porra ya creada, directamente desde su propia tarjeta en
  // "Porras creadas" (pedido de Iñi, ronda de correcciones: antes solo se
  // podía tocar su fecha límite indirectamente, editando el torneo entero
  // — ahora también se puede aquí mismo, igual que con "Eliminar").
  const [editandoFechaPorra, setEditandoFechaPorra] = useState<string | null>(null);
  const [fechaPorraEditada, setFechaPorraEditada] = useState('');
  const [guardandoFechaPorra, setGuardandoFechaPorra] = useState(false);

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

  const mesasPorDeporte = DEPORTES.map((d) => ({
    deporte: d,
    total: salas.filter((s) => s.deporte === d && s.estado !== 'finalizada').length,
  }));

  // Agrupa las mesas por torneo/jornada (misma competición + deporte) para
  // el panel de "Torneos y jornadas creados" — pedido de Iñi, 23/09: poder
  // ver, editar y eliminar cada torneo entero, no mesa a mesa.
  const torneosAgrupados = Object.values(
    salas.reduce<Record<string, { competicion: string; deporte: string; mesas: number; fechaLimite: string | null }>>((acc, s) => {
      const key = `${s.deporte}::${s.competicion}`;
      if (!acc[key]) acc[key] = { competicion: s.competicion, deporte: s.deporte, mesas: 0, fechaLimite: s.fecha_limite_inscripcion };
      acc[key].mesas += 1;
      return acc;
    }, {})
  ).sort((a, b) => a.competicion.localeCompare(b.competicion));

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

  const movimientosFiltrados = movimientos.filter((m) => dentroDelPeriodo(m.creado_en));

  const partidasJugadas = inscripcionesFiltradas.length;
  const dineroJugado = inscripcionesFiltradas.reduce((acc, i) => acc + Number(i.importe), 0);
  const rakeGanado = dineroJugado * 0.1;
  const dineroDepositado = movimientosFiltrados.filter((m) => m.tipo === 'deposito').reduce((acc, m) => acc + Number(m.importe), 0);
  const dineroRetirado = movimientosFiltrados.filter((m) => m.tipo === 'retiro').reduce((acc, m) => acc + Number(m.importe), 0);

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  const statCards: { value: string; label: string; href?: string }[] = [
    { value: `${dineroDepositado.toFixed(2)} €`, label: 'Dinero depositado' },
    { value: `${dineroRetirado.toFixed(2)} €`, label: 'Dinero retirado' },
    { value: `${partidasJugadas}`, label: 'Partidas jugadas' },
    { value: `${dineroJugado.toFixed(2)} €`, label: 'Dinero jugado' },
    { value: `${rakeGanado.toFixed(2)} €`, label: 'Rake ganado (10%)' },
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => setMostrarSyncFutbol((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={S.sectionLabel}>Automatizar jornada de fútbol (aparcado)</span>
              <span
                style={{
                  fontSize: 13,
                  color: S.MUTED_2,
                  transform: mostrarSyncFutbol ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                  flexShrink: 0,
                }}
              >
                ▾
              </span>
            </button>
            {mostrarSyncFutbol && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
              <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
                Trae la próxima jornada real de La Liga, Premier League y Champions League (football-data.org), sincroniza
                los jugadores de los equipos que juegan, fija la fecha límite de inscripción al inicio del primer
                partido y abre 2 salas de cada variante (Doble o Nada, Triple o Nada, Oro y Plata, Tridente) más el
                Maratón, si esa jornada no las tenía ya. De momento no se usa — la jornada se crea a mano en
                &quot;Nuevo torneo o jornada&quot;, más abajo.
              </p>
              <button
                type="button"
                onClick={sincronizarJornadaFutbol}
                disabled={sincronizandoFutbol}
                style={{ ...S.primaryButton, marginTop: 0, opacity: sincronizandoFutbol ? 0.7 : 1 }}
              >
                {sincronizandoFutbol ? 'Sincronizando (puede tardar hasta un minuto)...' : 'Sincronizar próxima jornada'}
              </button>
              {errorFutbol && <p style={S.errorText}>{errorFutbol}</p>}
              {resultadoFutbol && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {resultadoFutbol.map((r) => (
                    <div key={r.competicion} style={{ fontSize: 12, color: r.aviso ? S.ERROR : S.MUTED_2 }}>
                      <strong style={{ color: S.TEXT }}>{r.competicion}</strong>
                      {r.aviso
                        ? ` — ${r.aviso}`
                        : ` — Jornada ${r.jornada}: ${r.jugadoresSincronizados} jugadores, ${r.salasCreadas} salas nuevas.`}
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Valor de mercado de fútbol</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
              <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
                Pega la tabla de valores del fantasy oficial de cada competición (una línea por jugador:
                <code style={{ background: S.BG, padding: '1px 5px', borderRadius: 4 }}>Equipo · Jugador · Valor</code>, separados por tabulador) para
                cargarla la primera vez o actualizarla más adelante. Se empareja siempre por equipo + nombre, nunca solo
                por nombre, para no confundir jugadores homónimos de equipos distintos.
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {LIGAS_FUTBOL.map((l) => (
                  <button key={l} type="button" onClick={() => { setLigaValorMercado(l); setPreviewValorMercado(null); setResultadoValorMercado(null); setErrorValorMercado(null); }} style={S.pill(ligaValorMercado === l)}>
                    {LIGA_FUTBOL_LABEL[l]}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                {cargasValorMercado[ligaValorMercado].cargadoEn
                  ? `Valores de ${LIGA_FUTBOL_LABEL[ligaValorMercado]} cargados el ${new Date(cargasValorMercado[ligaValorMercado].cargadoEn!).toLocaleDateString('es-ES')} (${cargasValorMercado[ligaValorMercado].jugadoresActualizados} jugadores).`
                  : `Todavía no se han cargado valores de ${LIGA_FUTBOL_LABEL[ligaValorMercado]}.`}
              </span>

              <div style={S.field}>
                <span style={S.label}>Tabla de valores pegada (Equipo · Jugador · Posición · Valor · % titular opcional)</span>
                <textarea
                  value={textoValorMercado}
                  onChange={(e) => setTextoValorMercado(e.target.value)}
                  placeholder={'Barcelona\tLamine Yamal\tDelantero\t158.927.883\nReal Madrid\tKylian Mbappé\tDelantero\t153.400.000\nSevilla\tRafa Garrido (Rafita)\tDefensa\t1.200.000\t62%'}
                  rows={6}
                  style={{ ...S.input, fontFamily: 'monospace', fontSize: 12.5, resize: 'vertical' }}
                />
                <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                  Posición: portero/defensa/centrocampista/delantero (también valen POR/DEF/MED/DEL). No hace falta haber
                  sincronizado nada antes — si un jugador o un equipo no existía todavía, se crea al guardar.
                </span>
              </div>
              <button
                type="button"
                onClick={previsualizarValorMercado}
                disabled={!textoValorMercado.trim() || calculandoPreviewValor}
                style={{ ...S.secondaryLinkButton, opacity: textoValorMercado.trim() && !calculandoPreviewValor ? 1 : 0.5 }}
              >
                {calculandoPreviewValor ? 'Comprobando...' : 'Previsualizar'}
              </button>

              {avisosValorMercado.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {avisosValorMercado.map((a, i) => (
                    <span key={i} style={{ fontSize: 11, color: S.MUTED_3 }}>⚠ {a}</span>
                  ))}
                </div>
              )}

              {previewValorMercado && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, color: S.TEXT, fontWeight: 600 }}>
                      Se actualizan: {previewValorMercado.actualizados.length}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
                      {previewValorMercado.actualizados.map((f, i) => (
                        <div key={i} style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                          {f.nombreDb} <span style={{ color: S.MUTED_3 }}>({f.equipoDb} · {f.posicion})</span> — {f.valor.toLocaleString('es-ES')} €
                          {f.probabilidadTitular !== null ? ` · ${f.probabilidadTitular}% titular` : ''}
                        </div>
                      ))}
                    </div>
                  </div>

                  {previewValorMercado.nuevos.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12, color: '#F0B94D', fontWeight: 600 }}>
                        Se crean como jugadores nuevos: {previewValorMercado.nuevos.length} (revisa que el equipo esté bien escrito, sobre todo si ya tenías otros jugadores de ese mismo equipo)
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
                        {previewValorMercado.nuevos.map((f, i) => (
                          <div key={i} style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                            {f.jugador} <span style={{ color: S.MUTED_3 }}>({f.equipo} · {f.posicion})</span> — {f.valor.toLocaleString('es-ES')} €
                            {f.probabilidadTitular !== null ? ` · ${f.probabilidadTitular}% titular` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {previewValorMercado.errores.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12, color: S.ERROR, fontWeight: 600 }}>
                        Con error: {previewValorMercado.errores.length} (corrígelos en el texto pegado y vuelve a previsualizar — no se guardan)
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
                        {previewValorMercado.errores.map((f, i) => (
                          <div key={i} style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                            {f.equipo} — {f.jugador}{f.apodo ? ` (${f.apodo})` : ''}: <span style={{ color: S.MUTED_3 }}>{f.motivo}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {previewValorMercado.sinValorEnPlantilla.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12, color: S.MUTED_2, fontWeight: 600 }}>
                        Jugadores ya guardados que no aparecen en esta tabla: {previewValorMercado.sinValorEnPlantilla.length} (conservan su valor anterior)
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
                        {previewValorMercado.sinValorEnPlantilla.map((j) => (
                          <div key={j.id} style={{ fontSize: 11.5, color: S.MUTED_3 }}>{j.nombre} ({j.equipo ?? '?'})</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={guardarValorMercado}
                    disabled={guardandoValorMercado || (previewValorMercado.actualizados.length === 0 && previewValorMercado.nuevos.length === 0)}
                    style={{ ...S.primaryButton, marginTop: 0, opacity: guardandoValorMercado ? 0.7 : 1 }}
                  >
                    {guardandoValorMercado
                      ? 'Guardando...'
                      : `Guardar (${previewValorMercado.actualizados.length + previewValorMercado.nuevos.length} jugadores)`}
                  </button>
                </div>
              )}
              {errorValorMercado && <p style={S.errorText}>{errorValorMercado}</p>}
              {resultadoValorMercado && <p style={S.infoText}>{resultadoValorMercado}</p>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Rankings mundiales (golf y tenis)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
              <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
                El ranking mundial que guardes aquí es lo que usa la app para calcular el precio y el grupo de la porra
                clásica de cada jugador al importar un torneo (más abajo) — no hace falta volver a pegarlo por cada
                torneo, solo actualizarlo de vez en cuando.
              </p>

              <div style={{ display: 'flex', gap: 8 }}>
                {(['golf', 'tenis'] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setRankingDeporte(d)} style={S.pill(rankingDeporte === d)}>
                    {d === 'golf' ? 'Golf' : 'Tenis'} · {rankingConteos[d].total}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                {rankingConteos[rankingDeporte].total > 0
                  ? `Guardado: ${rankingConteos[rankingDeporte].total} jugadores${
                      rankingConteos[rankingDeporte].actualizado ? ` · actualizado ${new Date(rankingConteos[rankingDeporte].actualizado!).toLocaleDateString('es-ES')}` : ''
                    }.`
                  : 'Todavía no hay ranking guardado para este deporte.'}
              </span>

              <div style={S.field}>
                <span style={S.label}>Ranking mundial pegado (uno por línea, en orden de ranking)</span>
                <textarea
                  value={rankingTexto}
                  onChange={(e) => setRankingTexto(e.target.value)}
                  placeholder={'1  Scottie Scheffler\n2  Rory McIlroy\n3  Jon Rahm\n...'}
                  rows={6}
                  style={{ ...S.input, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
                />
              </div>
              <button type="button" onClick={previsualizarRanking} disabled={!rankingTexto.trim()} style={{ ...S.secondaryLinkButton, opacity: rankingTexto.trim() ? 1 : 0.5 }}>
                Previsualizar ranking
              </button>

              {rankingPreview.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                    {rankingPreview.length} jugadores detectados — al guardar, sustituye por completo el ranking de {rankingDeporte === 'golf' ? 'golf' : 'tenis'} que hubiera antes.
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                    {rankingPreview.map((j, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 28, flexShrink: 0, fontSize: 11, color: S.MUTED_3, textAlign: 'right' }}>#{j.rank}</span>
                        <input
                          value={j.nombre}
                          onChange={(e) => editarNombreRankingPreview(i, e.target.value)}
                          style={{ ...S.input, padding: '8px 10px', fontSize: 13 }}
                        />
                        <button
                          type="button"
                          onClick={() => quitarDeRankingPreview(i)}
                          aria-label="Quitar"
                          style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, color: S.ERROR, width: 32, height: 32, cursor: 'pointer' }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={guardarRanking}
                    disabled={guardandoRanking}
                    style={{ ...S.primaryButton, marginTop: 0, opacity: guardandoRanking ? 0.7 : 1 }}
                  >
                    {guardandoRanking ? 'Guardando...' : `Guardar ranking de ${rankingDeporte === 'golf' ? 'golf' : 'tenis'} (${rankingPreview.length} jugadores)`}
                  </button>
                </div>
              )}
              {errorRanking && <p style={S.errorText}>{errorRanking}</p>}
              {resultadoRanking && <p style={S.infoText}>{resultadoRanking}</p>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Nuevo torneo o jornada</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['futbol', 'golf', 'tenis'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setTorneoDeporte(d);
                      setTorneoNombre('');
                      setTorneoTexto('');
                      setTextoCuotas('');
                      setPreviewJugadores([]);
                      setPreviewCuotas(null);
                      setAvisosCuotasFutbol([]);
                      setResultadoTorneo(null);
                      setResultadoCuotas(null);
                      setErrorCuotas(null);
                    }}
                    style={S.pill(torneoDeporte === d)}
                  >
                    {d === 'futbol' ? 'Fútbol' : d === 'golf' ? 'Golf' : 'Tenis'}
                  </button>
                ))}
              </div>

              {torneoDeporte === 'futbol' ? (
                <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
                  Con el valor de mercado ya cargado (arriba, por liga), elige la liga y ponle nombre a la jornada
                  (p. ej. &quot;Jornada 9&quot;) y pega las cuotas 1X2 de cada partido — eso calcula el precio final
                  de cada jugador de los equipos que juegan, y al confirmar se abren las mesas de esa jornada, igual
                  que en un torneo de golf o tenis. Solo entran en la jornada los equipos que aparezcan en las
                  cuotas pegadas; el resto de la plantilla de la liga se queda como estaba.
                </p>
              ) : (
                <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
                  No hay ninguna API gratuita (ni forma fiable/legal de hacer scraping) de las webs de PGA Tour, DP World
                  Tour, ATP o WTA. Pega aquí el listado de INSCRITOS de este torneo — una línea por jugador, en
                  cualquier orden. Si cada línea lleva también la cuota de &quot;Ganador&quot; de la casa de apuestas
                  (p. ej. <code>Aaberg, Ludvig 8,50</code>), el precio de cada jugador sale de esa cuota — el favorito
                  cuesta el 38% del presupuesto y el resto en proporción, para que no quepan dos o tres favoritos en el
                  mismo equipo. La misma cuota decide también el grupo de color de la porra clásica: Amarillo son los
                  15 favoritos de este torneo, Verde del 16 al 35, y así — nunca hace falta el ranking mundial guardado
                  más abajo si pegas cuotas. Si pegas solo nombres, sin cuotas, tanto el precio como el grupo de la
                  porra se calculan por el ranking mundial guardado, pero siempre en relación a este torneo: Amarillo
                  son los 15 jugadores mejor clasificados que juegan este torneo, no los jugadores cuyo puesto mundial
                  sea 1-15 (si el nº1 del mundo no juega, el mejor clasificado que sí juega puede ser Amarillo).
                </p>
              )}

              {torneoDeporte === 'futbol' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {LIGAS_FUTBOL.map((l) => (
                    <button key={l} type="button" onClick={() => { setLigaJornadaFutbol(l); setPreviewCuotas(null); setResultadoCuotas(null); setErrorCuotas(null); }} style={S.pill(ligaJornadaFutbol === l)}>
                      {LIGA_FUTBOL_LABEL[l]}
                    </button>
                  ))}
                </div>
              )}

              <div style={S.field}>
                <span style={S.label}>{torneoDeporte === 'futbol' ? 'Nombre de la jornada' : 'Nombre del torneo'}</span>
                <input
                  value={torneoNombre}
                  onChange={(e) => setTorneoNombre(e.target.value)}
                  placeholder={torneoDeporte === 'futbol' ? 'Jornada 9' : 'PGA Tour · The Open, ATP 500 Hamburgo...'}
                  style={S.input}
                />
                {torneoDeporte === 'futbol' && torneoNombre.trim() && (
                  <span style={{ fontSize: 11, color: S.MUTED_3 }}>Se guardará como &quot;{nombreJornadaFutbolCompleto()}&quot;.</span>
                )}
              </div>
              <div style={S.field}>
                <span style={S.label}>Fecha y hora límite de inscripción</span>
                <input type="datetime-local" value={torneoFechaLimite} onChange={(e) => setTorneoFechaLimite(e.target.value)} style={S.input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={S.label}>Qué crear al confirmar</span>
                <p style={{ fontSize: 11, color: S.MUTED_3, margin: 0, lineHeight: 1.4 }}>
                  Los jugadores importados siempre sustituyen a los que ya hubiera de este mismo torneo (nunca se
                  duplican). Desmarca lo que no quieras recrear — por ejemplo, si solo has borrado la porra para
                  rehacerla y las mesas de Drafters ya están bien tal cual.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: S.TEXT, cursor: 'pointer', padding: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={crearMesas}
                    onChange={(e) => setCrearMesas(e.target.checked)}
                    style={{ width: 18, height: 18, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                  />
                  Crear mesas de Drafters
                </label>
                {torneoDeporte === 'golf' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: S.TEXT, cursor: 'pointer', padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      checked={crearPorraCheck}
                      onChange={(e) => setCrearPorraCheck(e.target.checked)}
                      style={{ width: 18, height: 18, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                    />
                    Crear la porra
                  </label>
                )}
              </div>

              {torneoDeporte === 'futbol' ? (
                <>
                  <div style={S.field}>
                    <span style={S.label}>Cuotas 1X2 pegadas (una línea por partido)</span>
                    <textarea
                      value={textoCuotas}
                      onChange={(e) => setTextoCuotas(e.target.value)}
                      placeholder={'Real Madrid - Osasuna 1,25 6,50 11,00\nCelta - Girona 2,10 3,30 3,60'}
                      rows={5}
                      style={{ ...S.input, fontFamily: 'monospace', fontSize: 12.5, resize: 'vertical' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={previsualizarJornadaFutbol}
                    disabled={!textoCuotas.trim() || !torneoNombre.trim() || calculandoPreviewCuotas}
                    style={{ ...S.secondaryLinkButton, opacity: textoCuotas.trim() && torneoNombre.trim() && !calculandoPreviewCuotas ? 1 : 0.5 }}
                  >
                    {calculandoPreviewCuotas ? 'Calculando...' : 'Previsualizar precios'}
                  </button>

                  {avisosCuotasFutbol.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {avisosCuotasFutbol.map((a, i) => (
                        <span key={i} style={{ fontSize: 11, color: S.MUTED_3 }}>⚠ {a}</span>
                      ))}
                    </div>
                  )}

                  {previewCuotas && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <span style={{ fontSize: 11.5, color: previewCuotas.reglasCumplidas ? S.MUTED_2 : S.ERROR }}>
                        TOPE {previewCuotas.topeUsado.toLocaleString('es-ES')} € · γ {previewCuotas.gammaUsado}
                        {previewCuotas.reglasCumplidas ? ' · reglas de seguridad cumplidas.' : ' · aviso: ninguna combinación probada cumple del todo las dos reglas de seguridad — revisa los precios.'}
                      </span>

                      {previewCuotas.partidosNoEmparejados.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 11.5, color: S.ERROR }}>Partidos pegados sin emparejar:</span>
                          {previewCuotas.partidosNoEmparejados.map((p, i) => (
                            <span key={i} style={{ fontSize: 11, color: S.MUTED_3 }}>{p}</span>
                          ))}
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 320, overflowY: 'auto' }}>
                        {[...previewCuotas.precios]
                          .sort((a, b) => b.precio - a.precio)
                          .map((p) => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: p.sinValor ? S.MUTED_3 : S.MUTED_2 }}>
                              <span>
                                {p.nombre} <span style={{ color: S.MUTED_3 }}>({p.equipoReal ?? '?'} · {p.posicion})</span>
                                {p.sinValor ? ' — sin valor, precio mediano' : ''}
                              </span>
                              <span style={{ color: S.TEXT, flexShrink: 0 }}>{p.precio.toLocaleString('es-ES')} €</span>
                            </div>
                          ))}
                      </div>

                      <button
                        type="button"
                        onClick={confirmarJornadaFutbol}
                        disabled={guardandoCuotas}
                        style={{ ...S.primaryButton, marginTop: 0, opacity: guardandoCuotas ? 0.7 : 1 }}
                      >
                        {guardandoCuotas ? 'Guardando...' : `Confirmar jornada (${previewCuotas.precios.length} jugadores)`}
                      </button>
                    </div>
                  )}
                  {errorCuotas && <p style={S.errorText}>{errorCuotas}</p>}
                  {resultadoCuotas && <p style={S.infoText}>{resultadoCuotas}</p>}
                </>
              ) : (
              <div style={S.field}>
                <span style={S.label}>Listado pegado de la web del circuito</span>
                <textarea
                  value={torneoTexto}
                  onChange={(e) => setTorneoTexto(e.target.value)}
                  placeholder={'Con cuotas:\nAaberg, Ludvig 8,50\nFitzpatrick, Matthew 9,50\n...\n\nSolo nombres (sin cuotas, precio por ranking):\n1  Scottie Scheffler\n2  Rory McIlroy\n...'}
                  rows={6}
                  style={{ ...S.input, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
                />
              </div>
              )}
              {torneoDeporte !== 'futbol' && (
              <button type="button" onClick={previsualizarTorneo} disabled={!torneoTexto.trim()} style={{ ...S.secondaryLinkButton, opacity: torneoTexto.trim() ? 1 : 0.5 }}>
                Previsualizar listado
              </button>
              )}

              {torneoDeporte !== 'futbol' && previewJugadores.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                    {previewJugadores.length} jugadores detectados{usandoCuotas ? ' · precio calculado por cuota' : ' · precio calculado por ranking (sin cuotas en el listado)'} —
                    revisa y corrige antes de confirmar.
                    {torneoDeporte === 'golf' &&
                      ` Marca "ES" en los jugadores españoles — con ${UMBRAL_MINIMO_ESPANOLES} o más marcados se les crea una lista aparte.`}
                  </span>
                  {avisosCuotas.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: '#F0B94D' }}>
                      {avisosCuotas.map((a, i) => (
                        <li key={i}>{a} — no está en la lista de abajo; corrige el texto pegado y vuelve a previsualizar si falta.</li>
                      ))}
                    </ul>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                    {previewJugadores.map((j, i) => {
                      const precioCalc = preciosPreviewCuota[i];
                      // El puesto que se muestra aquí es el que de verdad decide el
                      // grupo de la porra (sección "de dónde sale el puesto" en
                      // lib/porraGrupos.ts): con cuotas, la posición por cuota
                      // dentro de este torneo; sin cuotas, la posición DENTRO DE
                      // ESTE TORNEO según el ranking mundial guardado (corregido
                      // 23/09, tercera vuelta — no el puesto mundial absoluto: si
                      // el nº1 del mundo no juega este torneo, el mejor clasificado
                      // que sí juega tiene que poder ser Amarillo).
                      const puestoGrupo = usandoCuotas ? puestosPreviewPorCuota[i] : puestosPreviewPorRankingMundial[i];
                      const tituloPuesto = usandoCuotas
                        ? puestoGrupo !== null
                          ? 'Puesto en este torneo por cuota de Ganador (decide el grupo de la porra)'
                          : 'Sin cuota válida — revísala (decide el grupo de la porra)'
                        : puestoGrupo !== null
                          ? 'Puesto en este torneo según el ranking mundial guardado (decide el grupo de la porra, sin cuotas)'
                          : 'No encontrado en el ranking mundial guardado — revisa el nombre (afecta al grupo de porra)';
                      return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          title={tituloPuesto}
                          style={{ width: 40, flexShrink: 0, fontSize: 10.5, fontWeight: 700, textAlign: 'right', color: puestoGrupo !== null ? S.ACCENT : S.ERROR }}
                        >
                          {puestoGrupo !== null ? `#${puestoGrupo}` : '¿?'}
                        </span>
                        <input
                          value={j.nombre}
                          onChange={(e) => editarNombreVistaPrevia(i, e.target.value)}
                          style={{ ...S.input, padding: '8px 10px', fontSize: 13 }}
                        />
                        {usandoCuotas && (
                          <input
                            type="number"
                            step="0.01"
                            min={1.01}
                            title="Cuota de Ganador"
                            value={j.cuota ?? ''}
                            onChange={(e) => editarCuotaVistaPrevia(i, e.target.value)}
                            style={{ ...S.input, width: 64, flexShrink: 0, padding: '8px 6px', fontSize: 12, textAlign: 'right' }}
                          />
                        )}
                        {usandoCuotas && (
                          <span
                            title={precioCalc.sinCuota ? 'Sin cuota válida — precio mínimo' : 'Precio calculado por cuota'}
                            style={{ width: 60, flexShrink: 0, fontSize: 11, fontWeight: 800, textAlign: 'right', color: precioCalc.sinCuota ? S.ERROR : '#F0B94D' }}
                          >
                            {precioCalc.precio} €
                          </span>
                        )}
                        {torneoDeporte === 'golf' && (
                          <label
                            title="Jugador español"
                            style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11, color: S.MUTED_2, cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              checked={j.esEspanol}
                              onChange={() => toggleEspanolVistaPrevia(i)}
                              style={{ width: 15, height: 15, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                            />
                            ES
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() => quitarDeVistaPrevia(i)}
                          aria-label="Quitar"
                          style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, color: S.ERROR, width: 32, height: 32, cursor: 'pointer' }}
                        >
                          ×
                        </button>
                      </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={confirmarImportacionTorneo}
                    disabled={importandoTorneo || !torneoNombre.trim()}
                    style={{ ...S.primaryButton, marginTop: 0, opacity: importandoTorneo || !torneoNombre.trim() ? 0.7 : 1 }}
                  >
                    {importandoTorneo ? 'Importando...' : `Confirmar e importar ${previewJugadores.length} jugadores`}
                  </button>
                </div>
              )}
              {resultadoTorneo && <p style={S.infoText}>{resultadoTorneo}</p>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={S.sectionLabel}>Mesas en juego ahora</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {mesasPorDeporte.map((m) => (
                <div key={m.deporte} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 12 }}>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>{m.total}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: S.MUTED_2 }}>{m.deporte}</span>
                </div>
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
                  </span>
                </>
              );
              return c.href ? (
                <Link
                  key={c.label}
                  href={c.href}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14, textDecoration: 'none', cursor: 'pointer' }}
                >
                  {contenido}
                </Link>
              ) : (
                <div key={c.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
                  {contenido}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => setMostrarCrearMesa((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={S.sectionLabel}>Crear mesa aislada</span>
              <span
                style={{
                  fontSize: 13,
                  color: S.MUTED_2,
                  transform: mostrarCrearMesa ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                  flexShrink: 0,
                }}
              >
                ▾
              </span>
            </button>
            {mostrarCrearMesa && (
              <>
                <p style={{ fontSize: 11, color: S.MUTED_3, margin: 0 }}>
                  Normalmente no hace falta: al crear un torneo o jornada ya se generan solas 2 mesas de cada
                  tipo/buy-in (y la porra, en golf). Usa esto solo para un caso suelto.
                </p>
                <form onSubmit={crearSala} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
                  <div style={S.field}>
                    <span style={S.label}>Nombre</span>
                    <input required value={nombreSala} onChange={(e) => setNombreSala(e.target.value)} style={S.input} />
                  </div>
                  <div style={S.field}>
                    <span style={S.label}>Deporte</span>
                    <select value={deporteSala} onChange={(e) => setDeporteSala(e.target.value as typeof deporteSala)} style={S.selectInput}>
                      {DEPORTES.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div style={S.field}>
                    <span style={S.label}>Competición</span>
                    <input required value={competicionSala} onChange={(e) => setCompeticionSala(e.target.value)} placeholder="La Liga, PGA Tour..." style={S.input} />
                  </div>
                  <div style={S.field}>
                    <span style={S.label}>Tipo</span>
                    <select value={tipoSala} onChange={(e) => setTipoSala(e.target.value as typeof tipoSala)} style={S.selectInput}>
                      {TIPOS_SALA.map((t) => <option key={t} value={t}>{TIPO_SALA_LABELS[t]}</option>)}
                    </select>
                  </div>
                  {tipoSala !== 'maraton' && (
                    <div style={S.field}>
                      <span style={S.label}>Aforo</span>
                      <input type="number" min={2} required value={aforoSala} onChange={(e) => setAforoSala(Number(e.target.value))} style={S.input} />
                    </div>
                  )}
                  {tipoSala === 'maraton' && (
                    <p style={{ fontSize: 11.5, color: S.MUTED_2, margin: 0 }}>El Maratón no tiene aforo fijo — inscripción sin límite.</p>
                  )}
                  <div style={S.field}>
                    <span style={S.label}>Buy-in (€ simulados)</span>
                    <input type="number" min={0} required value={buyInSala} onChange={(e) => setBuyInSala(Number(e.target.value))} style={S.input} />
                  </div>
                  <button type="submit" disabled={creandoSala} style={{ ...S.primaryButton, marginTop: 0, opacity: creandoSala ? 0.7 : 1 }}>
                    {creandoSala ? 'Creando...' : 'Crear mesa'}
                  </button>
                </form>
                <p style={{ fontSize: 11, color: S.MUTED_3, margin: 0 }}>
                  Recuerda crear al menos 2 mesas de cada tipo/deporte/competición — cuando una se cierre, el sistema
                  repone automáticamente hasta llegar a ese mínimo.
                </p>
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Torneos y jornadas creados</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {torneosAgrupados.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay ningún torneo o jornada creado.</p>}
              {torneosAgrupados.map((t) => {
                const key = `${t.deporte}::${t.competicion}`;
                const editando = editandoFechaTorneo === t.competicion;
                return (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.competicion}
                        </span>
                        <span style={{ fontSize: 11, color: S.FAINT }}>{t.deporte} · {t.mesas} mesa{t.mesas === 1 ? '' : 's'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => (editando ? setEditandoFechaTorneo(null) : empezarEdicionFechaTorneo(t.competicion, t.fechaLimite))}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#C9D2CC', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
                        >
                          {editando ? 'Cancelar' : 'Editar'}
                        </button>
                        <button
                          type="button"
                          disabled={eliminandoTorneo === t.competicion}
                          onClick={() => eliminarTorneo(t.competicion, t.deporte)}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ERROR, background: 'transparent', border: `1px solid ${S.ERROR}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: eliminandoTorneo === t.competicion ? 0.6 : 1 }}
                        >
                          {eliminandoTorneo === t.competicion ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </div>
                    {editando && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="datetime-local"
                            value={fechaTorneoEditada}
                            onChange={(e) => setFechaTorneoEditada(e.target.value)}
                            style={{ ...S.input, padding: '8px 10px', fontSize: 12.5 }}
                          />
                          <button
                            type="button"
                            disabled={guardandoFechaTorneo}
                            onClick={() => guardarFechaTorneo(t.competicion)}
                            style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#04140B', background: '#3DDC84', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: guardandoFechaTorneo ? 0.7 : 1, whiteSpace: 'nowrap' }}
                          >
                            Guardar fecha límite
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 10 }}>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
                            Jugadores de este torneo
                          </span>
                          {jugadores.filter((j) => j.deporte === t.deporte && j.competicion === t.competicion).length === 0 && (
                            <p style={{ fontSize: 11.5, color: S.MUTED_3, margin: 0 }}>No hay jugadores importados para este torneo.</p>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 260, overflowY: 'auto' }}>
                            {jugadores
                              .filter((j) => j.deporte === t.deporte && j.competicion === t.competicion)
                              .map((j) => (
                                <div key={j.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#10150F', border: '1px solid #1E2723', borderRadius: 8, padding: '7px 10px' }}>
                                  <span style={{ minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {j.nombre}
                                  </span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                    <span style={{ fontSize: 11, color: '#F0B94D', fontWeight: 700 }}>{j.precio} €</span>
                                    <button
                                      type="button"
                                      disabled={eliminandoJugadorId === j.id}
                                      onClick={() => eliminarJugador(j)}
                                      aria-label={`Eliminar a ${j.nombre}`}
                                      style={{ background: 'transparent', border: `1px solid ${S.ERROR}`, borderRadius: 7, color: S.ERROR, width: 26, height: 26, cursor: 'pointer', opacity: eliminandoJugadorId === j.id ? 0.6 : 1 }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: S.MUTED_3, margin: 0 }}>
              Al eliminar un torneo/jornada se borran todas sus mesas, se reembolsa íntegramente a quien estuviera
              inscrito y se le avisa — la porra clásica de ese mismo torneo (si la hay) no se toca aquí, se elimina
              aparte más abajo.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Porras creadas</span>
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
                            color: S.ACCENT,
                          }}
                        >
                          Porra
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => setMostrarMesasCreadas((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={S.sectionLabel}>Listado de mesas creadas ({salas.length})</span>
              <span
                style={{
                  fontSize: 13,
                  color: S.MUTED_2,
                  transform: mostrarMesasCreadas ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                  flexShrink: 0,
                }}
              >
                ▾
              </span>
            </button>
            {mostrarMesasCreadas && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {salas.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.nombre}
                    </span>
                    <span style={{ fontSize: 11, color: S.FAINT }}>{s.codigo} · {s.deporte}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span
                      style={{
                        fontFamily: "'Manrope', sans-serif",
                        fontWeight: 700,
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: s.estado === 'finalizada' ? S.MUTED_2 : S.ACCENT,
                        background: s.estado === 'finalizada' ? 'rgba(139,149,143,0.12)' : 'rgba(61,220,132,0.12)',
                        borderRadius: 999,
                        padding: '5px 10px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.estado}
                    </span>
                    {s.estado !== 'finalizada' && (
                      <button
                        type="button"
                        onClick={() => cerrarSala(s)}
                        style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11.5, color: '#C9D2CC', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}
                      >
                        Cerrar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => setMostrarJugadoresCreados((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={S.sectionLabel}>Listado de jugadores creados ({jugadores.length})</span>
              <span
                style={{
                  fontSize: 13,
                  color: S.MUTED_2,
                  transform: mostrarJugadoresCreados ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                  flexShrink: 0,
                }}
              >
                ▾
              </span>
            </button>
            {mostrarJugadoresCreados && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jugadores.map((j) => (
                <div key={j.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {j.nombre}
                    </span>
                    {j.lesionado && (
                      <span style={{ flexShrink: 0, width: 13, height: 13, borderRadius: '50%', background: S.ERROR, display: 'inline-block' }} title="Lesionado" />
                    )}
                    <span style={{ flexShrink: 0, fontSize: 10.5, color: S.FAINT }}>· {j.deporte}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {editandoPrecioId === j.id ? (
                      <>
                        <input
                          type="number"
                          min={0}
                          autoFocus
                          value={precioEditado}
                          onChange={(e) => setPrecioEditado(e.target.value)}
                          style={{ ...S.input, width: 80, padding: '5px 8px', fontSize: 12.5 }}
                        />
                        <button
                          type="button"
                          disabled={guardandoPrecio}
                          onClick={() => guardarPrecioEditado(j)}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#04140B', background: '#3DDC84', border: 'none', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', opacity: guardandoPrecio ? 0.7 : 1 }}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditandoPrecioId(null)}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#C9D2CC', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, padding: '5px 9px', cursor: 'pointer' }}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => empezarEdicionPrecio(j)}
                        title="Editar precio"
                        style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 12.5, color: '#F0B94D', background: 'transparent', border: '1px solid transparent', borderRadius: 8, padding: '4px 6px', cursor: 'pointer' }}
                      >
                        {j.precio} € ✎
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleLesionado(j)}
                      style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#C9D2CC', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, padding: '5px 9px', cursor: 'pointer' }}
                    >
                      {j.lesionado ? 'Quitar lesión' : 'Marcar lesión'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Añadir jugador</span>
            <form onSubmit={crearJugador} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
              <div style={S.field}>
                <span style={S.label}>Nombre</span>
                <input required value={nombreJugador} onChange={(e) => setNombreJugador(e.target.value)} style={S.input} />
              </div>
              <div style={S.field}>
                <span style={S.label}>Deporte</span>
                <select value={deporteJugador} onChange={(e) => setDeporteJugador(e.target.value as typeof deporteJugador)} style={S.selectInput}>
                  {DEPORTES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={S.field}>
                <span style={S.label}>Competición / jornada</span>
                <input required value={competicionJugador} onChange={(e) => setCompeticionJugador(e.target.value)} style={S.input} />
              </div>
              <div style={S.field}>
                <span style={S.label}>Precio virtual (€)</span>
                <input type="number" min={0} required value={precioJugador} onChange={(e) => setPrecioJugador(Number(e.target.value))} style={S.input} />
              </div>
              <button type="submit" disabled={creandoJugador} style={{ ...S.primaryButton, marginTop: 0, opacity: creandoJugador ? 0.7 : 1 }}>
                {creandoJugador ? 'Creando...' : 'Añadir jugador'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
