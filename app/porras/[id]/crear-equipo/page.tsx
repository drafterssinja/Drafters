'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import { marcarFavoritosPorDefecto } from '@/lib/favoritosJugador';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros, inicialesJugador } from '@/lib/salaShared';
import { GRUPO_PORRA_LABELS, ORDEN_GRUPOS, COLOR_GRUPO, type GrupoPorra } from '@/lib/porraGrupos';
import { EQUIPO_PRESUPUESTO, TAMANO_EQUIPO_GOLF_TENIS, colorPresupuesto } from '@/lib/draftConfig';
import { PorraFormato, PORRA_FORMATO_LABELS, PORRA_FORMATO_COLOR } from '@/lib/porraFormato';
import EscudoEquipoFutbol from '@/components/EscudoEquipoFutbol';

// ============================================================================
// CREAR EQUIPO EN UNA PORRA — dos formatos (isPorraEquipo + isPorraConfirmar
// de Main.dc.html, líneas 1462-1550, adaptado)
// ============================================================================
// Hasta el 28/09 solo existía el formato "clásica" (un jugador por cada
// grupo de color, más un comodín, sin presupuesto de fantasía). Pedido de
// Iñi ese día: un segundo formato, "de sueldo de 100.000 con un valor de
// cada uno de los jugadores" — igual mecanismo que las Mesas Drafters de
// golf/tenis (lib/draftConfig.ts), pero dentro de una porra: sin aforo,
// precio de entrada fijo (porra.precio) y equipos ilimitados por
// participante, exactamente igual que la porra clásica en todo lo demás.
//
// Esta pantalla ahora tiene un paso previo "info" (mismo patrón que
// app/salas/[id]/crear-equipo, PuntuacionInfoScreen) que explica qué modo
// es ESTA porra en concreto antes de dejar elegir jugadores (pedido de Iñi,
// 28/09: "antes de que el jugador empiece a elegir los equipos, se le
// explica esa porra en concreto de qué manera se va a... si va a ser modo
// draft o modo porra clásica con grupos") — se salta en modoEdicion, igual
// que la de salas (si ya tienes equipo, ya sabes de qué modo es).
//
// El formato de la porra decide qué paso "draft" se muestra (por grupos de
// color o por presupuesto) pero el paso "confirm" y el envío final
// (inscribirse_en_porra / editar_equipo_porra) son las mismas funciones
// para los dos — la validación de la composición del equipo (grupos vs.
// presupuesto) vive en el servidor, ver drafters-schema.sql.

type PorraRow = { id: string; major: string; precio: number; competicion: string | null; estado: string; formato: PorraFormato; fecha_limite_inscripcion: string | null };
type JugadorRow = { id: string; nombre: string; grupo_porra: GrupoPorra | null; precio: number; baja?: boolean };
// Porra de fútbol por jornadas (29/09) — sin jugadores que elegir, 10
// partidos públicos (iguales para todos) a pronosticar (1/X/2). El nombre
// del equipo NO se pide aquí (se calcula solo, "Sindeler"/"Sindeler
// II"/..., ver inscribirse_en_porra_futbol() en drafters-schema.sql), así
// que esta porra tampoco tiene un paso de "editar equipo" ya inscrito en
// esta primera vuelta (pedido de Iñi: inscripción simple, sin editar).
type PartidoFutbol = {
  id: string;
  orden: number;
  equipo_local: string;
  equipo_visitante: string;
  escudo_local_url: string | null;
  escudo_visitante_url: string | null;
};
type PrediccionFutbol = '1' | 'x' | '2';

const COMODIN_COLOR = '#2DD4BF';

export default function CrearEquipoPorraPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const porraId = params.id;
  const searchParams = useSearchParams();
  // Con ?equipo=<id> esta misma pantalla edita un equipo ya inscrito, en vez
  // de crear uno nuevo (pedido de Iñi, 23/09: "en las porras puedo
  // participar todas las veces que quiera" — así que ya no se bloquea por
  // tener equipo, y además se puede editar el que ya tienes).
  const equipoEditandoId = searchParams.get('equipo');
  const modoEdicion = !!equipoEditandoId;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porra, setPorra] = useState<PorraRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [nombreEquipo, setNombreEquipo] = useState('');
  // Formato "clásica": un titular por grupo + comodín.
  const [selected, setSelected] = useState<Map<GrupoPorra, string>>(new Map());
  const [comodinId, setComodinId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<GrupoPorra | 'comodin' | null>(null);
  // Formato "presupuesto": hasta 5 jugadores libres, sin grupos.
  const [selectedPresupuesto, setSelectedPresupuesto] = useState<string[]>([]);
  // Formato "futbol_jornada": los 10 partidos de la jornada + mi pronóstico
  // de cada uno (partido_id -> '1'|'x'|'2').
  const [partidosFutbol, setPartidosFutbol] = useState<PartidoFutbol[]>([]);
  const [prediccionesFutbol, setPrediccionesFutbol] = useState<Map<string, PrediccionFutbol>>(new Map());
  // Paso previo "info" (28/09): se salta al editar un equipo ya existente.
  const [step, setStep] = useState<'info' | 'draft' | 'confirm'>(modoEdicion ? 'draft' : 'info');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

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

      const [{ data: perfilData }, { data: porraData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('porras').select('id,major,precio,competicion,estado,formato,fecha_limite_inscripcion').eq('id', porraId).single(),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);

      if (!porraData) {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }
      const porraRow = porraData as PorraRow;

      // La porra de fútbol todavía no está visible para usuarios normales
      // (oculta a propósito mientras se termina de probar). Se bloquea
      // también el acceso directo por URL a esta pantalla. (29/09)
      if (porraRow.formato === 'futbol_jornada') {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }

      // FALLO CORREGIDO (03/10, aviso de Iñi: "te deja crear otro equipo
      // cuando no se debería... ya ha pasado la fecha límite y la porra
      // lleva dos días jugándose") — antes esta pantalla (y las funciones
      // del servidor inscribirse_en_porra()/editar_equipo_porra()) solo
      // miraban `estado === 'finalizada'`, pero una porra no pasa a
      // 'finalizada' hasta que se liquida del todo (a mano, o 1h después de
      // acabar el torneo con el cierre automático de golf) — así que había
      // una ventana real, de días, en la que se seguían pudiendo crear o
      // editar equipos aunque ya hubiera pasado la fecha límite de
      // inscripción. Ahora se comprueba también aquí (igual que ya hacía
      // salas/[id]/crear-equipo) y, por si acaso, también del lado del
      // servidor en las dos funciones (drafters-schema.sql).
      const limiteYaPasado = !!porraRow.fecha_limite_inscripcion && new Date(porraRow.fecha_limite_inscripcion).getTime() <= Date.now();
      if (porraRow.estado === 'finalizada' || limiteYaPasado) {
        // replace, no push — ver el mismo comentario en salas/[id]/crear-equipo (bug de la flecha de volver, 23/09).
        router.replace(`/porras/${porraId}`);
        return;
      }

      // (Tras el bloqueo de arriba, formato aquí nunca es 'futbol_jornada'
      // en la práctica; se compara como string para no tocar el resto de
      // la lógica de fútbol ya desarrollada más abajo.)
      const esFutbolRow = (porraRow.formato as string) === 'futbol_jornada';

      const [{ data: jugData }, { data: equipoEditandoData }, { data: partidosFutbolData }] = await Promise.all([
        porraRow.competicion
          ? supabase.from('jugadores').select('id,nombre,grupo_porra,precio,baja').eq('deporte', 'golf').eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] as JugadorRow[] }),
        equipoEditandoId
          ? supabase
              .from('equipos')
              .select('id, nombre_equipo, jugadores, usuario_id')
              .eq('id', equipoEditandoId)
              .eq('porra_id', porraId)
              .eq('usuario_id', session.user.id)
              .maybeSingle()
          : Promise.resolve({ data: null as { id: string; nombre_equipo: string | null; jugadores: string[] } | null }),
        esFutbolRow
          ? supabase.from('partidos_porra_futbol').select('*').eq('porra_id', porraId).order('orden', { ascending: true })
          : Promise.resolve({ data: [] as PartidoFutbol[] }),
      ]);

      if (!activo) return;

      // Las bajas (jugadores que no van a jugar, marcados por el admin) no se pueden fichar: se quitan de la lista, y si un equipo ya existente los tenía, al editarlo ese hueco queda libre para elegir otro.
      const jugRows = ((jugData as JugadorRow[]) ?? []).filter((j) => !j.baja).filter((j) => porraRow.formato === 'clasica' ? j.grupo_porra !== null : true);
      setPorra(porraRow);
      setJugadores(jugRows);
      setPartidosFutbol((partidosFutbolData as PartidoFutbol[]) ?? []);

      if (equipoEditandoId) {
        const equipoEditando = equipoEditandoData as { id: string; nombre_equipo: string | null; jugadores: string[] } | null;
        if (!equipoEditando) {
          setError('No se ha encontrado ese equipo, o no es tuyo.');
          setCargando(false);
          return;
        }
        setNombreEquipo(equipoEditando.nombre_equipo ?? '');

        if (porraRow.formato === 'presupuesto') {
          setSelectedPresupuesto((equipoEditando.jugadores ?? []).filter((id) => jugRows.some((j) => j.id === id)));
        } else {
          // Reconstruye qué jugador es el titular de cada grupo y cuál es el
          // comodín a partir de la lista de ids guardada — un grupo con dos
          // jugadores guardados es el grupo del comodín (da igual cuál de los
          // dos se pinte como "titular" y cuál como "comodín", el resultado
          // final es el mismo equipo).
          const jugadoresPorIdLocal = new Map(jugRows.map((j) => [j.id, j]));
          const porGrupo = new Map<GrupoPorra, string[]>();
          (equipoEditando.jugadores ?? []).forEach((id) => {
            const j = jugadoresPorIdLocal.get(id);
            if (!j || !j.grupo_porra) return;
            const arr = porGrupo.get(j.grupo_porra) ?? [];
            arr.push(id);
            porGrupo.set(j.grupo_porra, arr);
          });
          const nuevoSelected = new Map<GrupoPorra, string>();
          let nuevoComodin: string | null = null;
          porGrupo.forEach((ids, grupo) => {
            const ordenados = [...ids].sort();
            nuevoSelected.set(grupo, ordenados[0]);
            if (ordenados[1]) nuevoComodin = ordenados[1];
          });
          setSelected(nuevoSelected);
          setComodinId(nuevoComodin);
        }
      }

      const primerGrupo = ORDEN_GRUPOS.find((g) => jugRows.some((j) => j.grupo_porra === g));
      setActiveGroup(primerGrupo ?? null);
      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, porraId, equipoEditandoId]);

  // Flechas de "volver" bien ordenadas entre info → draft → confirm (mismo
  // arreglo que en salas/[id]/crear-equipo — ver el comentario largo de
  // ahí): cada avance de paso añade una entrada al historial con
  // `history.pushState`, y un único listener de `popstate` decide a qué
  // paso volver.
  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      const paso = (event.state as { paso?: 'draft' | 'confirm' } | null)?.paso;
      setStep(paso === 'confirm' ? 'confirm' : paso === 'draft' ? 'draft' : 'info');
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function avanzarPaso(siguiente: 'draft' | 'confirm') {
    window.history.pushState({ paso: siguiente }, '', window.location.href);
    setStep(siguiente);
  }

  const gruposDisponibles = useMemo(() => ORDEN_GRUPOS.filter((g) => jugadores.some((j) => j.grupo_porra === g)), [jugadores]);
  // Se calcula a partir de los grupos que YA tiene esta porra en concreto
  // (repartidos al importar el torneo, lib/porraGrupos.ts) — si existe el
  // grupo "Españoles" es porque esta porra tiene 3 o más inscritos
  // españoles; si no existe, es porque tiene menos de 3. No hace falta
  // volver a contar españoles aquí.
  const hayListaEspanoles = gruposDisponibles.includes('espanoles');
  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);
  const seleccionados: { jugador: JugadorRow; esComodin: boolean }[] = [
    ...gruposDisponibles
      .map((g) => (selected.has(g) ? jugadoresPorId.get(selected.get(g)!) : null))
      .filter((j): j is JugadorRow => !!j)
      .map((j) => ({ jugador: j, esComodin: false })),
    ...(comodinId && jugadoresPorId.has(comodinId) ? [{ jugador: jugadoresPorId.get(comodinId)!, esComodin: true }] : []),
  ];

  const totalHuecos = gruposDisponibles.length > 0 ? gruposDisponibles.length + 1 : 0;
  const huecosRellenos = selected.size + (comodinId ? 1 : 0);
  const equipoCompleto = totalHuecos > 0 && huecosRellenos === totalHuecos;
  const nombreValido = nombreEquipo.trim().length > 0;
  const puedeConfirmar = equipoCompleto && nombreValido;

  // Formato "presupuesto": lista completa ordenada por precio (más caro
  // primero, mismo criterio visual que las Mesas Drafters), gasto y
  // presupuesto restante — mismo EQUIPO_PRESUPUESTO que ellas
  // (lib/draftConfig.ts).
  const jugadoresPresupuestoOrdenados = useMemo(() => [...jugadores].sort((a, b) => b.precio - a.precio), [jugadores]);
  const gastoPresupuesto = useMemo(
    () => selectedPresupuesto.reduce((acc, id) => acc + (jugadoresPorId.get(id)?.precio ?? 0), 0),
    [selectedPresupuesto, jugadoresPorId]
  );
  const restantePresupuesto = EQUIPO_PRESUPUESTO - gastoPresupuesto;
  const equipoCompletoPresupuesto = selectedPresupuesto.length === TAMANO_EQUIPO_GOLF_TENIS;
  const puedeConfirmarPresupuesto = equipoCompletoPresupuesto && restantePresupuesto >= 0 && nombreValido;

  function toggleJugador(jugador: JugadorRow) {
    const grupo = jugador.grupo_porra;
    if (!grupo) return;
    setSelected((prev) => {
      const nuevo = new Map(prev);
      if (nuevo.get(grupo) === jugador.id) {
        nuevo.delete(grupo);
      } else {
        nuevo.set(grupo, jugador.id);
      }
      return nuevo;
    });
    // Tras elegir, salta al siguiente grupo que todavía no tenga jugador; si
    // ya están todos los grupos de color completos, salta al comodín.
    const siguiente = gruposDisponibles.find((g) => g !== grupo && !selected.has(g));
    if (siguiente) setActiveGroup(siguiente);
    else if (!comodinId) setActiveGroup('comodin');
  }

  function toggleComodin(jugador: JugadorRow) {
    setComodinId((prev) => (prev === jugador.id ? null : jugador.id));
  }

  // Autoscroll entre grupos (28/09, pedido de Iñi: "igual que hacemos en el
  // fútbol cuando ya has elegido, por ejemplo, a todos los defensas, que
  // automáticamente se te desplace hasta la siguiente lista" — mismo patrón
  // que salas/[id]/crear-equipo usa para las líneas de fútbol: `grupoRefs`
  // guarda el bloque de cada grupo de color, `gruposCompletadosRef` recuerda
  // si cada uno estaba ya completo en el render anterior, para detectar el
  // momento exacto en que se acaba de rellenar. Al completar el último grupo
  // de color (el modo comodín usa la lista entera) y al elegir el comodín,
  // "vuelva otra vez al inicio".
  //
  // Corrección (01/10, aviso de Iñi): el destino de "volver al inicio" era
  // `listTopRef` — el banner "Grupo activo" de arriba, que es
  // `position: sticky`. Al estar ya "pegado" arriba del todo mientras se
  // mira cualquier grupo que no sea el primero, `scrollIntoView` sobre un
  // elemento sticky no siempre recorre todo el camino hasta el verdadero
  // principio de la lista (Iñi: "se desplaza solamente hasta el primer
  // español, no hasta el primer jugador de todos del grupo amarillo") — se
  // cambia el destino al bloque real del primer grupo (`grupoRefs` del
  // primer elemento de `gruposDisponibles`, el mismo ref ya usado para
  // saltar ENTRE grupos, sin el problema del sticky), que es exactamente
  // donde está la lista del grupo Amarillo.
  const grupoRefs = useRef<Partial<Record<GrupoPorra, HTMLDivElement | null>>>({});
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const gruposCompletadosRef = useRef<Partial<Record<GrupoPorra, boolean>>>({});
  const comodinCompletadoRef = useRef(false);

  function irAlPrimerGrupo() {
    const primerGrupo = gruposDisponibles[0];
    const el = primerGrupo ? grupoRefs.current[primerGrupo] : listTopRef.current;
    (el ?? listTopRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    if (porra?.formato !== 'clasica') return;
    gruposDisponibles.forEach((grupo, i) => {
      const completoAhora = selected.has(grupo);
      const completoAntes = gruposCompletadosRef.current[grupo] ?? false;
      if (completoAhora && !completoAntes) {
        const siguienteGrupo = gruposDisponibles[i + 1];
        if (siguienteGrupo) {
          grupoRefs.current[siguienteGrupo]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          irAlPrimerGrupo();
        }
      }
      gruposCompletadosRef.current[grupo] = completoAhora;
    });
  }, [porra?.formato, gruposDisponibles, selected]);

  useEffect(() => {
    if (porra?.formato !== 'clasica') return;
    const completoAhora = !!comodinId;
    if (completoAhora && !comodinCompletadoRef.current) {
      irAlPrimerGrupo();
    }
    comodinCompletadoRef.current = completoAhora;
  }, [porra?.formato, comodinId]);

  function toggleJugadorPresupuesto(jugador: JugadorRow) {
    setSelectedPresupuesto((prev) => {
      if (prev.includes(jugador.id)) return prev.filter((id) => id !== jugador.id);
      if (prev.length >= TAMANO_EQUIPO_GOLF_TENIS) return prev;
      return [...prev, jugador.id];
    });
  }

  async function confirmarInscripcion() {
    setEnviando(true);
    setErrorEnvio(null);
    const jugadoresElegidos =
      porra?.formato === 'presupuesto' ? selectedPresupuesto : [...Array.from(selected.values()), ...(comodinId ? [comodinId] : [])];
    const { error: rpcError } = modoEdicion
      ? await supabase.rpc('editar_equipo_porra', {
          p_equipo_id: equipoEditandoId,
          p_jugadores: jugadoresElegidos,
          p_nombre_equipo: nombreEquipo.trim(),
        })
      : await supabase.rpc('inscribirse_en_porra', {
          p_porra_id: porraId,
          p_jugadores: jugadoresElegidos,
          p_nombre_equipo: nombreEquipo.trim(),
        });
    if (rpcError) {
      setErrorEnvio(traducirError(rpcError.message));
      setEnviando(false);
      return;
    }
    // Registro de actividad (28/09, pedido de Iñi): solo la inscripción
    // nueva, no al editar un equipo ya inscrito.
    if (!modoEdicion && porra) {
      await supabase.rpc('registrar_evento_actividad', { p_tipo: 'inscripcion', p_detalle: { modo: 'porra', nombre: porra.major } });
    }
    // Favoritos por defecto (04/10, pedido de Iñi): los jugadores de un
    // equipo recién creado se marcan solos como favoritos — ver el
    // comentario largo en lib/favoritosJugador.ts (solo al crear, nunca al
    // editar). No bloquea el redirect aunque tarde o falle: ya se ha
    // confirmado la inscripción, que es lo que de verdad importa aquí.
    if (!modoEdicion && perfil) {
      marcarFavoritosPorDefecto(perfil.id, jugadoresElegidos);
    }
    // replace, no push — ver el mismo comentario en salas/[id]/crear-equipo (bug de la flecha de volver, 23/09).
    router.replace(`/porras/${porraId}`);
  }

  if (cargando || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = formatEuros(perfil.saldo_simulado);
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  if (error || !porra) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.ERROR }}>{error ?? 'No se ha encontrado esta porra.'}</p>
          </div>
        </div>
      </main>
    );
  }

  const esPresupuesto = porra.formato === 'presupuesto';
  const esFutbol = porra.formato === 'futbol_jornada';
  const partidosConPronostico = partidosFutbol.filter((p) => prediccionesFutbol.has(p.id)).length;
  const puedeConfirmarFutbol = partidosFutbol.length > 0 && partidosConPronostico === partidosFutbol.length;

  function elegirPronostico(partidoId: string, pronostico: PrediccionFutbol) {
    setPrediccionesFutbol((prev) => {
      const nuevo = new Map(prev);
      if (nuevo.get(partidoId) === pronostico) nuevo.delete(partidoId);
      else nuevo.set(partidoId, pronostico);
      return nuevo;
    });
  }

  async function confirmarInscripcionFutbol() {
    setEnviando(true);
    setErrorEnvio(null);
    const p_predicciones = partidosFutbol.map((p) => ({ partido_id: p.id, prediccion: prediccionesFutbol.get(p.id) }));
    const { error: rpcError } = await supabase.rpc('inscribirse_en_porra_futbol', { p_porra_id: porraId, p_predicciones });
    if (rpcError) {
      setErrorEnvio(traducirError(rpcError.message));
      setEnviando(false);
      return;
    }
    if (porra) {
      await supabase.rpc('registrar_evento_actividad', { p_tipo: 'inscripcion', p_detalle: { modo: 'porra', nombre: porra.major } });
    }
    router.replace(`/porras/${porraId}`);
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />

        {step === 'info' ? (
          <PorraModoInfoScreen porra={porra} hayListaEspanoles={hayListaEspanoles} onEntendido={() => avanzarPaso('draft')} onVolver={() => router.back()} />
        ) : step === 'draft' ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 20px 24px' }}>
              <button type="button" onClick={() => router.back()} style={backArrowStyle}>
                ←
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{porra.major}</span>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT }}>{modoEdicion ? 'Edita tu equipo' : 'Crea tu equipo'}</h1>
                <p style={{ fontSize: 13, color: S.MUTED_2 }}>
                  {esFutbol
                    ? 'Marca 1, X o 2 en los 10 partidos.'
                    : esPresupuesto
                      ? `Elige ${TAMANO_EQUIPO_GOLF_TENIS} jugadores dentro de un presupuesto de ${formatEuros(EQUIPO_PRESUPUESTO)}.`
                      : 'Elige un jugador de cada grupo de color, más un comodín de cualquier lista.'}
                </p>
              </div>

              {!esFutbol && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>Nombre del equipo</label>
                  <input type="text" value={nombreEquipo} onChange={(e) => setNombreEquipo(e.target.value)} placeholder="Ej. Los Birdies de Iñi" style={S.input} />
                </div>
              )}

              {esFutbol ? (
                partidosFutbol.length === 0 ? (
                  <p style={{ fontSize: 13, color: S.MUTED_2 }}>Esta jornada todavía no tiene partidos cargados.</p>
                ) : (
                  <>
                    <div style={{ position: 'sticky', top: 0, zIndex: 5, background: S.BG, paddingTop: 2, paddingBottom: 6, margin: '0 -20px', paddingLeft: 20, paddingRight: 20 }}>
                      <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>Pronósticos</span>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: puedeConfirmarFutbol ? '#3DDC84' : S.MUTED_3 }}>
                          {partidosConPronostico}/{partidosFutbol.length}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {partidosFutbol.map((p) => {
                        const elegido = prediccionesFutbol.get(p.id);
                        return (
                          <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 12px', background: S.PANEL, border: `1px solid ${elegido ? 'rgba(61,220,132,0.4)' : '#1E2723'}`, borderRadius: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <EscudoEquipoFutbol nombre={p.equipo_local} url={p.escudo_local_url} size={26} />
                              <span style={{ flex: 1, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, color: S.TEXT, textAlign: 'right' }}>{p.equipo_local}</span>
                              <span style={{ flexShrink: 0, fontSize: 10, color: S.MUTED_3 }}>vs</span>
                              <span style={{ flex: 1, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, color: S.TEXT }}>{p.equipo_visitante}</span>
                              <EscudoEquipoFutbol nombre={p.equipo_visitante} url={p.escudo_visitante_url} size={26} />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {(['1', 'x', '2'] as const).map((opcion) => (
                                <button
                                  key={opcion}
                                  type="button"
                                  onClick={() => elegirPronostico(p.id, opcion)}
                                  style={{
                                    flex: 1,
                                    fontFamily: "'Barlow Condensed', sans-serif",
                                    fontWeight: 800,
                                    fontSize: 15,
                                    padding: '9px 0',
                                    borderRadius: 8,
                                    border: `1px solid ${elegido === opcion ? '#3DDC84' : S.BORDER}`,
                                    background: elegido === opcion ? '#3DDC84' : 'transparent',
                                    color: elegido === opcion ? '#04140B' : S.MUTED,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {opcion.toUpperCase()}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )
              ) : esPresupuesto ? (
                jugadores.length === 0 ? (
                  <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no se ha subido el listado de jugadores de este torneo.</p>
                ) : (
                  <>
                    <div style={{ position: 'sticky', top: 0, zIndex: 5, background: S.BG, paddingTop: 2, paddingBottom: 6, margin: '0 -20px', paddingLeft: 20, paddingRight: 20 }}>
                      <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>
                          Presupuesto restante · {selectedPresupuesto.length}/{TAMANO_EQUIPO_GOLF_TENIS} jugadores
                        </span>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: colorPresupuesto(restantePresupuesto) }}>{formatEuros(restantePresupuesto)}</span>
                      </div>
                    </div>

                    {selectedPresupuesto.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {selectedPresupuesto.map((id) => {
                          const j = jugadoresPorId.get(id);
                          if (!j) return null;
                          return (
                            <span
                              key={id}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(61,220,132,0.1)', border: '1px solid rgba(61,220,132,0.4)', borderRadius: 999, padding: '5px 10px' }}
                            >
                              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 12, color: S.TEXT }}>{j.nombre}</span>
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  toggleJugadorPresupuesto(j);
                                }}
                                style={{ color: S.ERROR, fontWeight: 800, textDecoration: 'none' }}
                              >
                                ×
                              </a>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {jugadoresPresupuestoOrdenados.map((j) => {
                        const isSelected = selectedPresupuesto.includes(j.id);
                        const huecosLlenos = selectedPresupuesto.length >= TAMANO_EQUIPO_GOLF_TENIS;
                        const noAlcanza = j.precio > restantePresupuesto;
                        const disabled = !isSelected && (huecosLlenos || noAlcanza);
                        return (
                          <a
                            key={j.id}
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              if (disabled) return;
                              toggleJugadorPresupuesto(j);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '9px 8px',
                              background: isSelected ? 'rgba(61,220,132,0.1)' : S.PANEL,
                              border: `1px solid ${isSelected ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                              borderRadius: 10,
                              textDecoration: 'none',
                              opacity: disabled ? 0.4 : 1,
                              pointerEvents: disabled ? 'none' : 'auto',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#F0B94D' }}>{j.precio.toLocaleString('es-ES')} €</span>
                            </div>
                            <span
                              style={{
                                flexShrink: 0,
                                width: 23,
                                height: 23,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: 14,
                                border: `1px solid ${isSelected ? '#3DDC84' : S.BORDER}`,
                                background: isSelected ? '#3DDC84' : 'transparent',
                                color: isSelected ? '#04140B' : S.MUTED,
                              }}
                            >
                              {isSelected ? '−' : '+'}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: '#4E574F' }}>Elige libremente hasta {TAMANO_EQUIPO_GOLF_TENIS} jugadores sin superar el presupuesto.</span>
                  </>
                )
              ) : gruposDisponibles.length === 0 ? (
                <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no se ha subido el listado de jugadores de este torneo.</p>
              ) : (
                <>
                  <div ref={listTopRef} style={{ position: 'sticky', top: 0, zIndex: 5, background: S.BG, paddingTop: 2, paddingBottom: 6, margin: '0 -20px', paddingLeft: 20, paddingRight: 20, scrollMarginTop: 0 }}>
                    <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_2 }}>Grupo activo</span>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, color: activeGroup === 'comodin' ? COMODIN_COLOR : activeGroup ? COLOR_GRUPO[activeGroup] : S.MUTED_3 }}>
                        {activeGroup === 'comodin' ? 'Comodín (cualquier lista)' : activeGroup ? GRUPO_PORRA_LABELS[activeGroup] : '—'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {gruposDisponibles.map((grupo) => (
                        <div
                          key={grupo}
                          ref={(el) => {
                            grupoRefs.current[grupo] = el;
                          }}
                          style={{ display: 'flex', flexDirection: 'column', gap: 7, scrollMarginTop: 90 }}
                        >
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: COLOR_GRUPO[grupo] }}>
                            {GRUPO_PORRA_LABELS[grupo]}
                          </span>
                          {jugadores
                            .filter((j) => j.grupo_porra === grupo)
                            .sort((a, b) => b.precio - a.precio)
                            .map((j) => {
                            const modoComodin = activeGroup === 'comodin';
                            const isSelectedPrimario = selected.get(grupo) === j.id;
                            const isSelectedComodin = comodinId === j.id;
                            // Un jugador ya elegido (da igual si como titular de su
                            // lista o como comodín) siempre se puede tocar para quitarlo,
                            // esté el grupo o el comodín activo o no — también al editar
                            // un equipo ya inscrito (06/10, aviso de Iñi: al editar, tocar
                            // al jugador elegido ya no lo quitaba).
                            const isSelected = isSelectedPrimario || isSelectedComodin;
                            // No se puede usar el mismo jugador físico dos veces: si ya
                            // está puesto como comodín, no se puede volver a elegir como
                            // titular de su grupo, y viceversa.
                            const usadoEnOtroHueco = modoComodin
                              ? Array.from(selected.values()).includes(j.id) && !isSelectedComodin
                              : comodinId === j.id && !isSelectedPrimario;
                            const isActive = modoComodin ? true : grupo === activeGroup;
                            const disabled = !isSelected && (usadoEnOtroHueco || !isActive);
                            return (
                              <a
                                key={j.id}
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (disabled) return;
                                  if (isSelectedPrimario) {
                                    // Quitar al titular de su lista y dejar activa esa lista
                                    // para poder elegir al sustituto directamente.
                                    setSelected((prev) => {
                                      const nuevo = new Map(prev);
                                      nuevo.delete(grupo);
                                      return nuevo;
                                    });
                                    setActiveGroup(grupo);
                                  } else if (isSelectedComodin) {
                                    setComodinId(null);
                                    setActiveGroup('comodin');
                                  } else if (modoComodin) toggleComodin(j);
                                  else toggleJugador(j);
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '9px 8px',
                                  background: isSelected ? 'rgba(61,220,132,0.1)' : S.PANEL,
                                  border: `1px solid ${isSelected ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                                  borderRadius: 10,
                                  textDecoration: 'none',
                                  opacity: disabled ? 0.4 : 1,
                                  pointerEvents: disabled ? 'none' : 'auto',
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: COLOR_GRUPO[grupo] }}>{GRUPO_PORRA_LABELS[grupo]}</span>
                                </div>
                                <span
                                  style={{
                                    flexShrink: 0,
                                    width: 23,
                                    height: 23,
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 800,
                                    fontSize: 14,
                                    border: `1px solid ${isSelected ? '#3DDC84' : S.BORDER}`,
                                    background: isSelected ? '#3DDC84' : 'transparent',
                                    color: isSelected ? '#04140B' : S.MUTED,
                                  }}
                                >
                                  {isSelected ? '−' : '+'}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    <div style={{ flexShrink: 0, width: 96, display: 'flex', flexDirection: 'column', gap: 6, position: 'sticky', top: 128 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3, textAlign: 'center' }}>Tu equipo</span>
                      {gruposDisponibles.map((grupo) => {
                        const jugadorId = selected.get(grupo);
                        const j = jugadorId ? jugadoresPorId.get(jugadorId) : null;
                        const isActive = grupo === activeGroup;
                        return (
                          <a
                            key={grupo}
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setActiveGroup(grupo);
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 2,
                              background: isActive ? 'rgba(61,220,132,0.08)' : 'transparent',
                              border: `1.5px solid ${isActive ? '#3DDC84' : COLOR_GRUPO[grupo] + '55'}`,
                              borderRadius: 9,
                              padding: '6px 3px',
                              textDecoration: 'none',
                              width: '100%',
                            }}
                          >
                            {j ? (
                              <span key={j.id} style={{ animation: 'slotPop 0.4s cubic-bezier(.34,1.56,.64,1) both', width: 26, height: 26, borderRadius: '50%', background: COLOR_GRUPO[grupo], color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                                {inicialesJugador(j.nombre)}
                              </span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', border: `1.5px dashed ${COLOR_GRUPO[grupo]}` }} />
                            )}
                            {j && <span style={{ width: '100%', fontSize: 8.5, fontWeight: 700, color: S.TEXT, textAlign: 'center', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>}
                            <span style={{ fontSize: 7.5, fontWeight: 700, color: COLOR_GRUPO[grupo], lineHeight: 1.15, textAlign: 'center' }}>{GRUPO_PORRA_LABELS[grupo].split(' ')[0]}</span>
                          </a>
                        );
                      })}

                      {(() => {
                        const j = comodinId ? jugadoresPorId.get(comodinId) : null;
                        const isActive = activeGroup === 'comodin';
                        return (
                          <a
                            key="comodin"
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setActiveGroup('comodin');
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 2,
                              background: isActive ? 'rgba(61,220,132,0.08)' : 'transparent',
                              border: `1.5px solid ${isActive ? '#3DDC84' : COMODIN_COLOR + '55'}`,
                              borderRadius: 9,
                              padding: '6px 3px',
                              textDecoration: 'none',
                              width: '100%',
                            }}
                          >
                            {j ? (
                              <span key={j.id} style={{ animation: 'slotPop 0.4s cubic-bezier(.34,1.56,.64,1) both', width: 26, height: 26, borderRadius: '50%', background: COMODIN_COLOR, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                                {inicialesJugador(j.nombre)}
                              </span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', border: `1.5px dashed ${COMODIN_COLOR}` }} />
                            )}
                            {j && <span style={{ width: '100%', fontSize: 8.5, fontWeight: 700, color: S.TEXT, textAlign: 'center', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>}
                            <span style={{ fontSize: 7.5, fontWeight: 700, color: COMODIN_COLOR, lineHeight: 1.15, textAlign: 'center' }}>Comodín</span>
                          </a>
                        );
                      })()}
                    </div>
                  </div>

                  <span style={{ fontSize: 11, color: '#4E574F' }}>Toca un hueco de la derecha para elegir su grupo, y luego un jugador de la lista. El hueco "Comodín" acepta un jugador de cualquiera de las listas.</span>
                </>
              )}
            </div>

            <div style={{ position: 'sticky', bottom: 0, padding: '8px 20px 12px', background: 'linear-gradient(180deg, rgba(11,15,14,0) 0%, #0B0F0E 40%)' }}>
              {esFutbol ? (
                <button type="button" disabled={!puedeConfirmarFutbol} onClick={() => avanzarPaso('confirm')} style={submitButtonStyle(puedeConfirmarFutbol, '#3DDC84')}>
                  {puedeConfirmarFutbol ? 'Revisar e inscribirme' : `Faltan ${partidosFutbol.length - partidosConPronostico} pronósticos`}
                </button>
              ) : esPresupuesto ? (
                <button type="button" disabled={!puedeConfirmarPresupuesto} onClick={() => avanzarPaso('confirm')} style={submitButtonStyle(puedeConfirmarPresupuesto, '#3DDC84')}>
                  {!nombreValido
                    ? 'Ponle nombre a tu equipo'
                    : restantePresupuesto < 0
                      ? 'Te has pasado del presupuesto'
                      : equipoCompletoPresupuesto
                        ? modoEdicion
                          ? 'Revisar cambios'
                          : 'Revisar e inscribirme'
                        : `Faltan ${TAMANO_EQUIPO_GOLF_TENIS - selectedPresupuesto.length} jugadores`}
                </button>
              ) : (
                <button type="button" disabled={!puedeConfirmar} onClick={() => avanzarPaso('confirm')} style={submitButtonStyle(puedeConfirmar, '#3DDC84')}>
                  {!nombreValido ? 'Ponle nombre a tu equipo' : equipoCompleto ? (modoEdicion ? 'Revisar cambios' : 'Revisar e inscribirme') : `Faltan ${totalHuecos - huecosRellenos} jugadores`}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '28px 20px 56px' }}>
            <button type="button" onClick={() => router.back()} style={backArrowStyle}>
              ←
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{porra.major}</span>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT }}>{modoEdicion ? 'Confirma los cambios' : 'Confirma tu equipo'}</h1>
              <p style={{ fontSize: 13, color: S.MUTED_2 }}>
                {PORRA_FORMATO_LABELS[porra.formato]}
                {modoEdicion ? ' · sin coste adicional, ya está pagado' : ` · ${formatEuros(porra.precio)} por equipo`}
              </p>
            </div>

            <div style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!esFutbol && (
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>{nombreEquipo.trim()}</span>
              )}
              {esFutbol && (
                <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>El nombre de tu equipo se genera solo (tu usuario, o "usuario II"/"III"... si ya tienes otro en esta jornada).</span>
              )}
              {esFutbol
                ? partidosFutbol.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <EscudoEquipoFutbol nombre={p.equipo_local} url={p.escudo_local_url} size={26} />
                      <span style={{ flex: 1, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12.5, color: S.TEXT, textAlign: 'right' }}>{p.equipo_local}</span>
                      <span style={{ flexShrink: 0, minWidth: 26, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14, color: '#3DDC84' }}>
                        {(prediccionesFutbol.get(p.id) ?? '—').toString().toUpperCase()}
                      </span>
                      <span style={{ flex: 1, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 12.5, color: S.TEXT }}>{p.equipo_visitante}</span>
                      <EscudoEquipoFutbol nombre={p.equipo_visitante} url={p.escudo_visitante_url} size={26} />
                    </div>
                  ))
                : esPresupuesto
                ? selectedPresupuesto.map((id) => {
                    const j = jugadoresPorId.get(id);
                    if (!j) return null;
                    return (
                      <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: '#3DDC84', color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                          {inicialesJugador(j.nombre)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#F0B94D' }}>{j.precio.toLocaleString('es-ES')} €</span>
                        </div>
                      </div>
                    );
                  })
                : seleccionados.map(({ jugador: j, esComodin }) => {
                    const color = esComodin ? COMODIN_COLOR : COLOR_GRUPO[j.grupo_porra as GrupoPorra];
                    const etiqueta = esComodin ? `Comodín · ${GRUPO_PORRA_LABELS[j.grupo_porra as GrupoPorra]}` : GRUPO_PORRA_LABELS[j.grupo_porra as GrupoPorra];
                    return (
                      <div key={`${j.id}-${esComodin ? 'comodin' : 'titular'}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: color, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)' }}>
                          {inicialesJugador(j.nombre)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color }}>{etiqueta}</span>
                        </div>
                      </div>
                    );
                  })}
              {esPresupuesto && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1E2723', marginTop: 4, paddingTop: 10 }}>
                  <span style={{ fontSize: 13, color: S.MUTED_2 }}>Presupuesto usado</span>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15, color: colorPresupuesto(restantePresupuesto) }}>
                    {gastoPresupuesto.toLocaleString('es-ES')} € / {EQUIPO_PRESUPUESTO.toLocaleString('es-ES')} €
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: esPresupuesto ? undefined : '1px solid #1E2723', marginTop: esPresupuesto ? undefined : 4, paddingTop: esPresupuesto ? undefined : 10 }}>
                <span style={{ fontSize: 13, color: S.MUTED_2 }}>{modoEdicion ? 'Ya pagado' : 'Precio del equipo'}</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15, color: '#F0B94D' }}>{formatEuros(porra.precio)}</span>
              </div>
            </div>

            <p style={{ fontSize: 11, lineHeight: 1.5, color: S.MUTED_3, margin: 0 }}>
              {esFutbol
                ? 'El resultado real de cada partido lo marca el admin a mano en cuanto termina. Una vez inscrito, tu pronóstico no se puede editar — revisa bien antes de confirmar.'
                : 'El listado de jugadores es el oficial facilitado por la competición/circuito correspondiente. Drafters no se hace responsable de que algún jugador cause baja de última hora y, por tanto, no puntúe — recomendamos comprobar que los jugadores elegidos siguen confirmados antes de que empiece.'}
            </p>

            {errorEnvio && <p style={S.errorText}>{errorEnvio}</p>}

            <button
              type="button"
              disabled={enviando}
              onClick={esFutbol ? confirmarInscripcionFutbol : confirmarInscripcion}
              style={{ ...submitButtonStyle(true, '#3DDC84'), opacity: enviando ? 0.7 : 1, fontSize: 16, padding: 14, minHeight: 44, borderRadius: 10 }}
            >
              {enviando ? (modoEdicion ? 'Guardando...' : 'Inscribiendo...') : modoEdicion ? 'Guardar cambios' : 'Confirmar inscripción'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// Pantalla previa "qué modo es esta porra" (28/09, pedido de Iñi: "antes de
// que el jugador empiece a elegir los equipos, se le explica esa porra en
// concreto... si va a ser modo draft o modo porra clásica con grupos") —
// mismo patrón que PuntuacionInfoScreen de salas/[id]/crear-equipo: se ve
// siempre antes del draft (salvo al editar un equipo ya existente), con un
// botón "Entendido" que avanza al paso de elegir jugadores.
function PorraModoInfoScreen({
  porra,
  hayListaEspanoles,
  onEntendido,
  onVolver,
}: {
  porra: PorraRow;
  hayListaEspanoles: boolean;
  onEntendido: () => void;
  onVolver: () => void;
}) {
  const formato = porra.formato;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 20px 100px' }}>
      <button type="button" onClick={onVolver} style={backArrowStyle}>
        ←
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: PORRA_FORMATO_COLOR[formato] }}>{porra.major}</span>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>Cómo funciona esta porra</h1>
        <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Léelo antes de elegir tu equipo.</p>
      </div>

      <div style={{ background: S.PANEL, border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span
          style={{
            alignSelf: 'flex-start',
            fontFamily: "'Manrope', sans-serif",
            fontWeight: 700,
            fontSize: 11,
            color: PORRA_FORMATO_COLOR[formato],
            background: `${PORRA_FORMATO_COLOR[formato]}1F`,
            border: `1px solid ${PORRA_FORMATO_COLOR[formato]}55`,
            borderRadius: 999,
            padding: '4px 10px',
          }}
        >
          {PORRA_FORMATO_LABELS[formato]}
        </span>

        {formato === 'futbol_jornada' ? (
          <p style={{ fontSize: 13, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
            Pronostica el resultado (<strong style={{ color: S.TEXT }}>1</strong>, <strong style={{ color: S.TEXT }}>X</strong> o <strong style={{ color: S.TEXT }}>2</strong>) de los{' '}
            <strong style={{ color: S.TEXT }}>10 partidos</strong> de la jornada. Tu equipo se llamará automáticamente como tu nombre de usuario (y "II", "III"... si te apuntas más de
            una vez) — no hace falta ponerle nombre. Puedes apuntarte tantas veces como quieras.
          </p>
        ) : formato === 'presupuesto' ? (
          <p style={{ fontSize: 13, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
            En esta porra no hay grupos de color: eliges libremente <strong style={{ color: S.TEXT }}>{TAMANO_EQUIPO_GOLF_TENIS} jugadores</strong>, los que quieras, sin superar un
            presupuesto de <strong style={{ color: '#F0B94D' }}>{formatEuros(EQUIPO_PRESUPUESTO)}</strong>. Cuanto mejor es un jugador, más caro sale — el reto es armar el mejor equipo
            posible sin pasarte del presupuesto.
          </p>
        ) : hayListaEspanoles ? (
          <p style={{ fontSize: 13, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
            En esta porra el campo está repartido en grupos de color. Como participan 3 o más jugadores españoles, hay una lista aparte,{' '}
            <strong style={{ color: COLOR_GRUPO.espanoles }}>Españoles</strong>, con todos ellos — no cuentan para ningún otro grupo. El resto se reparte en{' '}
            <strong style={{ color: COLOR_GRUPO.amarillo }}>Amarillo</strong> (puesto 1-15), <strong style={{ color: COLOR_GRUPO.verde }}>Verde</strong> (16-35) y{' '}
            <strong style={{ color: COLOR_GRUPO.azul }}>Azul</strong> (36 en adelante, sin tope). Eliges un jugador de cada grupo que tenga esta porra, más un comodín de cualquiera de
            esas listas.
          </p>
        ) : (
          <p style={{ fontSize: 13, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
            En esta porra el campo está repartido en grupos de color: <strong style={{ color: COLOR_GRUPO.amarillo }}>Amarillo</strong> (puesto 1-15),{' '}
            <strong style={{ color: COLOR_GRUPO.verde }}>Verde</strong> (16-35), <strong style={{ color: COLOR_GRUPO.azul }}>Azul</strong> (36-70) y{' '}
            <strong style={{ color: COLOR_GRUPO.morado }}>Morado</strong> (71 en adelante). Eliges un jugador de cada grupo que tenga esta porra, más un comodín de cualquiera de esas
            listas.
          </p>
        )}
        <span style={{ fontSize: 11, color: S.FAINT }}>
          {formato === 'futbol_jornada'
            ? 'El resultado real de cada partido lo marca el admin a mano en cuanto termina — tu clasificación se actualiza sola según aciertes más o menos pronósticos.'
            : formato === 'clasica'
              ? 'El puesto de cada jugador es siempre el suyo dentro de este torneo, no un ranking mundial absoluto.'
              : 'El precio de cada jugador es el mismo que se usa en las Mesas Drafters de este torneo.'}
        </span>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '8px 0 12px', background: 'linear-gradient(180deg, rgba(11,15,14,0) 0%, #0B0F0E 40%)' }}>
        <button type="button" onClick={onEntendido} style={submitButtonStyle(true, '#3DDC84')}>
          Entendido, elegir jugadores
        </button>
      </div>
    </div>
  );
}

const backArrowStyle: React.CSSProperties = { width: 34, height: 34, padding: 0, margin: '0 0 4px', border: 'none', background: 'transparent', color: '#3DDC84', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, alignSelf: 'flex-start' };

function submitButtonStyle(enabled: boolean, activeColor: string): React.CSSProperties {
  return {
    pointerEvents: enabled ? 'auto' : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: enabled ? '#04140B' : S.MUTED_3,
    background: enabled ? activeColor : S.PANEL,
    padding: '9px 24px',
    borderRadius: 9,
    minHeight: 34,
    textAlign: 'center',
    width: '100%',
    border: 'none',
    cursor: enabled ? 'pointer' : 'default',
  };
}

function traducirError(mensaje: string): string {
  return mensaje.replace(/^ERROR:\s*/i, '');
}
