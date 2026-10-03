'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import AnuncioVideoInline from '@/components/AnuncioVideoInline';
import * as S from '@/lib/mockupStyles';
import { formatEuros, posicionLabel, parteParaPremios } from '@/lib/salaShared';
import { GRUPO_PORRA_LABELS, ORDEN_GRUPOS, COLOR_GRUPO, type GrupoPorra } from '@/lib/porraGrupos';
import { formatGolfScore, calcularBonosPodio, COLOR_TIPO_RESULTADO, ETIQUETA_TIPO_RESULTADO, type TipoResultadoHoyo } from '@/lib/golfScoring';
import { normalizarNombre } from '@/lib/nombreMatch';
import { calcularTramosPorInscritos, repartirPremiosConEmpates, type ClasificacionEntrada } from '@/lib/repartoPremios';
import { cargarFavoritos, alternarFavoritoEquipo } from '@/lib/favoritosEquipo';
import { cargarFavoritosJugador, alternarFavoritoJugador } from '@/lib/favoritosJugador';
import { reproducirSonidoAviso, leerPreferenciaSonido, guardarPreferenciaSonido } from '@/lib/sonidoAviso';
import { cargarParesBiblioteca } from '@/lib/paresBiblioteca';
import EstrellaFavorito from '@/components/EstrellaFavorito';
import TablaHoyoAHoyo, { type CasillaHoyo, type FilaRondaTabla } from '@/components/TablaHoyoAHoyo';

// ============================================================================
// PORRA CLÁSICA — CLASIFICACIÓN EN DIRECTO (nuevo, 27/09, undécima vuelta)
// ============================================================================
// Reproduce el diseño exacto de isPorraClasificacion (Main.dc.html, líneas
// 1553-1667) — pedido explícito de Iñi: "tienes tú el diseño que hicimos
// para la parte de la clasificación de las porras. Está perfecto... lo
// quiero tal como lo teníamos, tanto la parte de la clasificación de los
// participantes, que cuando pulsan un participante se vean los cinco
// jugadores que tienes, que cuando pulsas encima de un jugador, abajo se
// vean la parte de los jugadores con los resultados que van haciendo. Todo
// eso tiene que ser así."
//
// Lo que es real aquí: la porra, sus jugadores/grupos de color, la
// plantilla real de 5 jugadores de cada equipo inscrito
// (equipos_porra_clasificacion()) y — desde el 28/09 — la puntuación en
// vivo de verdad: `jugadores.resultado_en_vivo_*` y
// `resultados_golf_hoyo` se rellenan solos cada minuto, desde ESPN o desde
// Data Golf según la fuente elegida para esa competición (ver
// app/api/admin/actualizar-golf-en-vivo/route.ts y el admin
// /admin/resultados-golf, donde se conecta cada competición con su
// torneo — CAMBIO 03/10: con Data Golf, el hoyo a hoyo no viene dado
// directamente, se CALCULA a partir del resultado en vivo; esta pantalla
// no necesita saberlo, pinta igual sea cual sea el origen del dato).
// Mientras un jugador no tenga ningún resultado todavía
// (torneo sin empezar, o su competición sin conectar en el admin) se ve
// como "E" (par) — mismo placeholder de antes, pero ahora es el estado
// real de "sin datos todavía", no un valor inventado. El botón "simular
// resultado" de la maqueta (pensado para pruebas internas) se ha quitado a
// propósito — no es algo que deba ver un usuario real, mismo criterio que
// ya aplicó Iñi para el vídeo explicativo.
//
// Corrección de Iñi (28/09): la porra clásica NO puntúa por el sistema de
// puntos de las Mesas Drafters — puntúa con el resultado de golf de
// siempre (golpes respecto al par: birdie -1, bogey +1, eagle -2, doble
// bogey +2...), exactamente el mismo criterio con el que ya estaba
// diseñado el panel "hoyo a hoyo" de la maqueta. Ver lib/golfScoring.ts.
//
// El "Bono de podio" (nuevo, 29/09; corrección 02/10) es una regla fija de
// TODAS las porras de golf, no una opción por porra: "el primer jugador del
// torneo va a restar menos 10, el segundo menos 5 y el tercero menos 3" se
// aplica siempre, tanto aquí (clasificación en directo) como al liquidar
// los premios (ver /admin/pagos-pendientes/porra/[id] y
// lib/golfScoring.ts). Ya no existe un interruptor ni en esta pantalla ni
// en /admin/porras-golf — antes sí lo había (porras.bono_podio_activo,
// columna ya retirada, ver drafters-schema.sql), pero Iñi aclaró que el
// bono siempre tiene que funcionar, para todas las porras, sin
// configuración posible.

type PorraRow = { id: string; major: string; competicion: string | null; estado: string; fecha_limite_inscripcion: string | null; formato: string; precio: number };
type JugadorRow = {
  id: string;
  nombre: string;
  grupo_porra: GrupoPorra | null;
  precio: number;
  resultado_en_vivo_total: number | null;
  resultado_en_vivo_thru: number | null;
  resultado_en_vivo_ronda: number | null;
  resultado_en_vivo_posicion: string | null;
};
type EquipoClasif = { equipoId: string; nombreEquipo: string | null; jugadores: string[]; createdAt: string };
type HoyoRow = { ronda: number; hoyo: number; par: number; golpes: number; campo_id: string | null; tipo_resultado: TipoResultadoHoyo };

type Vista = 'porra' | 'torneo' | 'premios' | 'informacion';

// Total de un equipo: suma de los totales (respecto al par) de sus 5
// jugadores — a los que todavía no tienen resultado (no han salido, o su
// torneo no está conectado) se les cuenta como 0 (par) en la suma, para no
// dejar el total del equipo en blanco solo porque a uno le falte por
// empezar. `bonosPorJugador` es el resultado de calcularBonosPodio() sobre
// el campo completo (siempre se aplica — ver comentario de más arriba) —
// ver lib/golfScoring.ts para las reglas de empate.
function totalEquipo(jugadoresIds: string[], jugadoresPorId: Map<string, JugadorRow>, bonosPorJugador: Map<string, number>): number {
  return jugadoresIds.reduce((acc, id) => {
    const j = jugadoresPorId.get(id);
    if (!j) return acc;
    const bono = bonosPorJugador.get(id) ?? 0;
    return acc + (j.resultado_en_vivo_total ?? 0) + bono;
  }, 0);
}

// CAMBIO 03/10 (pedido de Iñi): "después de cuántos hoyos lleva ese
// resultado" y, si ha acabado la vuelta, una "F" — mismo criterio que
// cualquier marcador de golf real (ESPN ya lo llama "thru" tal cual).
function estadoJugador(j: JugadorRow): string | null {
  if (j.resultado_en_vivo_posicion === null && j.resultado_en_vivo_thru === null) return null;
  const posicion = j.resultado_en_vivo_posicion ? `Pos. ${j.resultado_en_vivo_posicion}` : null;
  const ronda = j.resultado_en_vivo_ronda ? `Ronda ${j.resultado_en_vivo_ronda}` : null;
  const thru = j.resultado_en_vivo_thru !== null ? (j.resultado_en_vivo_thru >= 18 ? 'F' : `Thru ${j.resultado_en_vivo_thru}`) : null;
  return [posicion, ronda, thru].filter(Boolean).join(' · ') || null;
}

export default function PorraClasificacionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const porraId = params.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porra, setPorra] = useState<PorraRow | null>(null);
  const [jugadores, setJugadores] = useState<JugadorRow[]>([]);
  const [equipos, setEquipos] = useState<EquipoClasif[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>('porra');
  // Bono de podio: al LIQUIDAR la porra, el bono siempre se aplica de
  // verdad (ya no es opcional, ver DRAFTERS_Cambios_02-10_Bono_Podio_Siempre_Activo.md)
  // — pero Iñi aclaró el 02/10 que en ESTA pantalla (la clasificación en
  // directo, antes de que la porra termine) sí quiere poder elegir
  // VERLA con o sin el bono restado, como una simulación: "tiene que
  // haber una pestaña que si yo pulso la pestaña se esté restando esos
  // menos 10, menos 5, menos 3... y que si yo quito la pestaña, que se
  // elimine [de lo que se ve]". Por eso `mostrarBono` sigue existiendo
  // (empieza en true, ya que es la regla real) y decide qué se pinta en
  // esta pantalla — la liquidación real (admin/pagos-pendientes) nunca
  // depende de este estado, solo del cálculo incondicional.
  const [mostrarBono, setMostrarBono] = useState(true);
  // Info del bono de podio (02/10): además del interruptor de arriba, un
  // botón "i" que de primeras no muestra ningún texto y, al pasar el
  // ratón (o pulsarlo en móvil, donde no hay hover), despliega una
  // explicación corta EN UNA CAPA SUPERPUESTA (position: absolute) para
  // que nunca desplace la clasificación de abajo.
  const [mostrarInfoBono, setMostrarInfoBono] = useState(false);
  const [equipoSeleccionadoId, setEquipoSeleccionadoId] = useState<string | null>(null);
  const [jugadorFocoId, setJugadorFocoId] = useState<string | null>(null);
  const [hoyosFoco, setHoyosFoco] = useState<HoyoRow[] | 'cargando' | null>(null);
  // Nombre de cada campo, solo para torneos con más de uno (01/10, pedido de
  // Iñi) — competicion -> campo_id -> nombre. Vacío en el 99% de los
  // torneos (un solo campo, nunca hay filas en campos_golf_live para esa
  // competición), así que no afecta en nada si el torneo no lo necesita.
  const [nombresCampo, setNombresCampo] = useState<Record<string, string>>({});
  // Par de los 18 hoyos de cada campo, desde la biblioteca reutilizable
  // (campos_golf_biblioteca) — nuevo, 03/10, para poder pintar la fila "Par"
  // de la tabla de hoyo a hoyo completa desde el principio del torneo, sin
  // esperar a que se haya jugado nada. Con Data Golf (fuente por defecto)
  // esto se rellena solo desde el primer ciclo de sincronización, porque
  // Data Golf da los 18 pares del campo de golpe; campo_id -> array de 18.
  const [paresPorCampoId, setParesPorCampoId] = useState<Record<string, (number | null)[]>>({});
  // Buscadores (nuevo, 01/10, pedido de Iñi): filtran la lista ya ordenada
  // sin tocar la posición que se muestra — el número de cada fila sigue
  // siendo su puesto real en la clasificación completa, no su puesto dentro
  // del resultado filtrado.
  const [busquedaEquipo, setBusquedaEquipo] = useState('');
  const [busquedaJugador, setBusquedaJugador] = useState('');
  // Favoritos de equipo (02/10, pedido de Iñi) — ver lib/favoritosEquipo.ts.
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [soloFavoritos, setSoloFavoritos] = useState(false);
  // Favoritos de jugador (03/10, pedido de Iñi) — mismo mecanismo que los
  // de equipo, ver lib/favoritosJugador.ts.
  const [favoritosJugador, setFavoritosJugador] = useState<Set<string>>(new Set());
  const [soloFavoritosJugador, setSoloFavoritosJugador] = useState(false);
  // Sonido de aviso (03/10, pedido de Iñi) — ver lib/sonidoAviso.ts.
  const [sonidoActivado, setSonidoActivado] = useState(true);
  // Cola de avisos de resultado no-par (03/10) — ver el efecto de más abajo.
  const [avisos, setAvisos] = useState<{ id: string; jugador: string; tipo: TipoResultadoHoyo }[]>([]);
  // Torneo terminado (nuevo, 03/10, pedido de Iñi): lo decide en exclusiva
  // la ruta de sincronización (ver el bloque "CIERRE AUTOMÁTICO..." en
  // drafters-schema.sql — torneos_golf_live.finalizado_en), nunca esta
  // pantalla. En cuanto está puesto, la pestaña "Premios" pasa a llamarse
  // "Clasificación final" y muestra el reparto ya calculado en vez de solo
  // los tramos — ver más abajo.
  const [torneoFinalizado, setTorneoFinalizado] = useState(false);

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

      const [{ data: perfilData }, { data: porraData }, favoritosSet, favoritosJugadorSet] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase.from('porras').select('id,major,competicion,estado,fecha_limite_inscripcion,formato,precio').eq('id', porraId).single(),
        cargarFavoritos(session.user.id),
        cargarFavoritosJugador(session.user.id),
      ]);

      if (!activo) return;
      if (perfilData) setPerfil(perfilData as Perfil);
      setFavoritos(favoritosSet);
      setFavoritosJugador(favoritosJugadorSet);

      if (!porraData) {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }

      // Esta pantalla es la clasificación en directo de golf; la porra de
      // fútbol todavía no está visible para usuarios normales (oculta a
      // propósito mientras se termina de probar). (29/09)
      if ((porraData as PorraRow).formato === 'futbol_jornada') {
        setError('No se ha encontrado esta porra.');
        setCargando(false);
        return;
      }
      const porraRow = porraData as PorraRow;
      setPorra(porraRow);

      const [{ data: jugData }, { data: equiposData }, { data: camposData }, { data: estadoTorneoData }] = await Promise.all([
        porraRow.competicion
          ? supabase
              .from('jugadores')
              .select('id,nombre,grupo_porra,precio,resultado_en_vivo_total,resultado_en_vivo_thru,resultado_en_vivo_ronda,resultado_en_vivo_posicion')
              .eq('deporte', 'golf')
              .eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] as JugadorRow[] }),
        // equipos_porra_clasificacion() es una función de base de datos
        // (RPC): solo devuelve filas una vez la porra ha "empezado" (misma
        // marca que participantes_porra()) — antes de eso, da una lista
        // vacía, y esta pantalla lo trata como "todavía no ha empezado"
        // más abajo.
        supabase.rpc('equipos_porra_clasificacion', { p_porra_id: porraId }),
        // Nombre de cada campo (01/10) — vacío salvo en los pocos torneos
        // con más de un campo que el admin ya haya nombrado.
        porraRow.competicion
          ? supabase.from('campos_golf_live').select('campo_id,nombre').eq('competicion', porraRow.competicion)
          : Promise.resolve({ data: [] as { campo_id: string; nombre: string }[] }),
        // Si el torneo ya se dio por terminado (03/10) — ver el comentario
        // de torneoFinalizado más arriba.
        porraRow.competicion
          ? supabase.rpc('obtener_estado_torneo_golf', { p_competicion: porraRow.competicion })
          : Promise.resolve({ data: [] as { finalizado_en: string | null }[] }),
      ]);

      if (!activo) return;

      setJugadores(((jugData as JugadorRow[]) ?? []).filter((j) => j.grupo_porra !== null));
      const filaEstadoTorneo = ((estadoTorneoData as { finalizado_en: string | null }[]) ?? [])[0];
      setTorneoFinalizado(!!filaEstadoTorneo?.finalizado_en);
      const camposArr = (camposData as { campo_id: string; nombre: string }[]) ?? [];
      setNombresCampo(Object.fromEntries(camposArr.map((c) => [c.campo_id, c.nombre])));
      if (camposArr.length > 0) {
        setParesPorCampoId(await cargarParesBiblioteca(camposArr));
      }

      const filasEquipos = (equiposData as { equipo_id: string; nombre_equipo: string | null; jugadores: string[]; created_at: string }[]) ?? [];
      const equiposOrdenados = filasEquipos
        .map((f) => ({ equipoId: f.equipo_id, nombreEquipo: f.nombre_equipo, jugadores: f.jugadores ?? [], createdAt: f.created_at }))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setEquipos(equiposOrdenados);
      if (equiposOrdenados.length > 0) setEquipoSeleccionadoId(equiposOrdenados[0].equipoId);

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router, porraId]);

  const jugadoresPorId = useMemo(() => new Map(jugadores.map((j) => [j.id, j])), [jugadores]);

  // Bono de podio de cada jugador del campo (01/10, reglas de empate — ver
  // lib/golfScoring.ts), calculado siempre sobre el campo completo (no solo
  // los jugadores de un equipo) porque el desempate necesita comparar a
  // TODOS los jugadores empatados, estén o no en la misma porra.
  const mapaBonosPodio = useMemo(() => calcularBonosPodio(jugadores), [jugadores]);
  // Lo que de verdad se pinta en esta pantalla (02/10): el bono completo
  // si `mostrarBono` está activado (el valor de partida, y lo que se
  // aplica siempre al liquidar), o un mapa vacío si Iñi lo apaga para ver
  // la clasificación "en crudo", sin el bono restado.
  const bonosParaMostrar = useMemo(() => (mostrarBono ? mapaBonosPodio : new Map<string, number>()), [mostrarBono, mapaBonosPodio]);

  // Orden de la vista "Torneo" (corregido 01/10, aviso de Iñi: "quiero que
  // salga ordenado por clasificación" — antes salía agrupado por lista de
  // color/precio, p.ej. todos los "Azul" juntos y dentro de ese bloque sin
  // relación con su puesto real en el torneo).
  // Segunda corrección de Iñi, mismo día: "la E es como si fuese el par, es
  // decir, el cero... cuando acabe el menos uno, el siguiente no es el más
  // uno... las E's cuentan como un 0" — por eso aquí NO hay un tratamiento
  // especial para "sin resultado todavía": al no tener resultado,
  // `resultado_en_vivo_total` es null y `?? 0` lo trata exactamente igual
  // que una E de verdad, así que cae solo en su sitio correcto del orden
  // (entre los -1 y los +1), nunca al final. A igualdad de golpes se
  // desempata por precio, para que el orden no salte sin motivo entre
  // sincronizaciones de 5 en 5 minutos (y es lo único que manda antes de
  // que empiece el torneo, cuando nadie tiene resultado todavía).
  const campoOrdenado = useMemo(() => {
    return jugadores.slice().sort((a, b) => {
      const diff = (a.resultado_en_vivo_total ?? 0) - (b.resultado_en_vivo_total ?? 0);
      return diff !== 0 ? diff : b.precio - a.precio;
    });
  }, [jugadores]);

  // Orden de la vista "Porra" (nuevo, 01/10, aviso de Iñi: "no se queda
  // ordenada la porra... que el primero sea el que va a menos golpes") —
  // antes la lista de equipos salía por orden de inscripción. totalEquipo()
  // ya trata a un jugador sin resultado como 0 (ver su comentario arriba),
  // así que una E de equipo cae igual de bien colocada que en campoOrdenado,
  // sin necesidad de ningún caso especial aquí tampoco.
  const equiposOrdenados = useMemo(() => {
    return equipos.slice().sort((a, b) => {
      const diff = totalEquipo(a.jugadores, jugadoresPorId, bonosParaMostrar) - totalEquipo(b.jugadores, jugadoresPorId, bonosParaMostrar);
      return diff !== 0 ? diff : a.createdAt.localeCompare(b.createdAt);
    });
  }, [equipos, jugadoresPorId, bonosParaMostrar]);

  // Hoyo a hoyo del jugador con el foco puesto — extraído a su propia
  // función (03/10) para poder llamarla también desde el refresco
  // automático de más abajo, no solo al cambiar de jugador.
  async function cargarHoyosFoco(jugadorId: string): Promise<void> {
    const { data } = await supabase
      .from('resultados_golf_hoyo')
      .select('ronda,hoyo,par,golpes,campo_id,tipo_resultado')
      .eq('jugador_id', jugadorId)
      .order('ronda', { ascending: true })
      .order('hoyo', { ascending: true });
    setHoyosFoco((data as HoyoRow[]) ?? []);
  }

  // Hoyo a hoyo del jugador con el foco puesto (pedido de Iñi, 28/09: "cuando
  // pinchas en un resultado, abajo se ven los resultados hoyo a hoyo... de
  // qué par es cada hoyo... y el color según sea eagle/birdie/par/bogey/doble
  // bogey"). Se pide solo cuando hace falta (no de golpe para los 5 del
  // equipo), y solo se guarda lo más reciente por si el usuario cambia de
  // jugador rápido mientras todavía está cargando el anterior. CAMBIO 03/10:
  // ya no hay una "ronda seleccionada" — la tabla de hoyo a hoyo (ver más
  // abajo) muestra TODAS las rondas conocidas a la vez, una fila por ronda.
  useEffect(() => {
    let activo = true;
    if (!jugadorFocoId) {
      setHoyosFoco(null);
      return;
    }
    setHoyosFoco('cargando');
    cargarHoyosFoco(jugadorFocoId).then(() => {
      if (!activo) return;
    });
    return () => {
      activo = false;
    };
  }, [jugadorFocoId]);

  // Marca/desmarca un equipo como favorito (02/10) — actualización
  // optimista en pantalla, igual se guarda en segundo plano en
  // equipos_favoritos (ver lib/favoritosEquipo.ts).
  async function alternarFavorito(equipoId: string) {
    if (!perfil) return;
    const estabaMarcado = favoritos.has(equipoId);
    setFavoritos((prev) => {
      const next = new Set(prev);
      if (estabaMarcado) next.delete(equipoId);
      else next.add(equipoId);
      return next;
    });
    await alternarFavoritoEquipo(perfil.id, equipoId, estabaMarcado);
  }

  // Marca/desmarca un jugador como favorito (03/10) — mismo patrón que
  // alternarFavorito() de arriba, ver lib/favoritosJugador.ts.
  async function alternarFavoritoJug(jugadorId: string) {
    if (!perfil) return;
    const estabaMarcado = favoritosJugador.has(jugadorId);
    setFavoritosJugador((prev) => {
      const next = new Set(prev);
      if (estabaMarcado) next.delete(jugadorId);
      else next.add(jugadorId);
      return next;
    });
    await alternarFavoritoJugador(perfil.id, jugadorId, estabaMarcado);
  }

  // ============================================================================
  // ACTUALIZACIÓN AUTOMÁTICA + AVISOS DE RESULTADO (nuevo, 03/10, pedido de Iñi)
  // ============================================================================
  // "Yo estoy aquí viendo la pantalla... debería verse cómo se va
  // actualizando" — cada minuto (mismo ritmo que el cron de sincronización,
  // ver app/api/admin/actualizar-golf-en-vivo/route.ts) se vuelve a pedir
  // el resultado en vivo de todos los jugadores de esta porra, y se revisa
  // si ha aparecido algún hoyo nuevo (de cualquier jugador, no solo el que
  // tenga el foco puesto) que no sea par — en ese caso se encola un aviso
  // con sonido. Usa refs para que el intervalo (creado una sola vez) lea
  // siempre el estado más reciente sin tener que recrearse.
  const sonidoActivadoRef = useRef(sonidoActivado);
  sonidoActivadoRef.current = sonidoActivado;
  const jugadorFocoIdRef = useRef(jugadorFocoId);
  jugadorFocoIdRef.current = jugadorFocoId;
  const ultimaRevisionRef = useRef<string | null>(null);

  useEffect(() => {
    setSonidoActivado(leerPreferenciaSonido());
  }, []);

  useEffect(() => {
    const competicion = porra?.competicion;
    if (!competicion) return;

    async function revisar() {
      const { data: jugData } = await supabase
        .from('jugadores')
        .select('id,nombre,grupo_porra,precio,resultado_en_vivo_total,resultado_en_vivo_thru,resultado_en_vivo_ronda,resultado_en_vivo_posicion')
        .eq('deporte', 'golf')
        .eq('competicion', competicion as string);
      const jugadoresNuevos = ((jugData as JugadorRow[]) ?? []).filter((j) => j.grupo_porra !== null);
      if (jugadoresNuevos.length > 0) setJugadores(jugadoresNuevos);

      const idsActuales = jugadoresNuevos.map((j) => j.id);
      const desde = ultimaRevisionRef.current;
      const ahora = new Date().toISOString();
      if (desde && idsActuales.length > 0) {
        const { data: hoyosNuevos } = await supabase
          .from('resultados_golf_hoyo')
          .select('jugador_id,tipo_resultado,actualizado_en')
          .in('jugador_id', idsActuales)
          .gt('actualizado_en', desde)
          .order('actualizado_en', { ascending: true });

        const nombrePorId = new Map(jugadoresNuevos.map((j) => [j.id, j.nombre]));
        ((hoyosNuevos as { jugador_id: string; tipo_resultado: TipoResultadoHoyo }[]) ?? [])
          .filter((h) => h.tipo_resultado !== 'par')
          .forEach((h) => {
            const nombreJugador = nombrePorId.get(h.jugador_id);
            if (!nombreJugador) return;
            setAvisos((prev) => [...prev, { id: `${h.jugador_id}:::${Date.now()}:::${Math.random()}`, jugador: nombreJugador, tipo: h.tipo_resultado }]);
            if (sonidoActivadoRef.current) reproducirSonidoAviso();
          });
      }
      ultimaRevisionRef.current = ahora;

      if (jugadorFocoIdRef.current) await cargarHoyosFoco(jugadorFocoIdRef.current);
    }

    ultimaRevisionRef.current = new Date().toISOString();
    const intervalo = setInterval(revisar, 60000);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [porra?.competicion]);

  // Quita el primer aviso de la cola a los 5 segundos de mostrarse (pedido
  // de Iñi: "una tira que dure 5 segundos") — si llega uno nuevo detrás
  // mientras el actual sigue visible, no le reinicia el cronómetro (solo
  // depende del id del PRIMERO de la cola, no de la cola entera).
  useEffect(() => {
    if (avisos.length === 0) return;
    const idAMostrar = avisos[0].id;
    const timer = setTimeout(() => {
      setAvisos((prev) => prev.filter((a) => a.id !== idAMostrar));
    }, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avisos.length > 0 ? avisos[0].id : null]);

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

  // Todavía no ha empezado (o no tiene ningún equipo inscrito todavía) —
  // mismo tratamiento honesto que ya usa salas/[id]/clasificacion/page.tsx
  // mientras no existe el motor de puntuación en directo.
  if (equipos.length === 0) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '48px 24px', alignItems: 'center', textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif" }}>Clasificación en directo</h1>
            <p style={{ fontSize: 14, color: S.MUTED_2, lineHeight: 1.6 }}>
              Esta porra todavía no ha empezado, o todavía no hay equipos inscritos. En cuanto empiece podrás ver aquí la clasificación de todos los participantes.
            </p>
            <Link href={`/porras/${porra.id}`} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '12px 24px', textDecoration: 'none', display: 'inline-flex' }}>
              Volver a la porra
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const equipoSeleccionado = equipos.find((e) => e.equipoId === equipoSeleccionadoId) ?? equipos[0];
  const jugadoresDelEquipoSeleccionado = equipoSeleccionado.jugadores.map((id) => jugadoresPorId.get(id)).filter((j): j is JugadorRow => !!j);
  const jugadorFoco = jugadorFocoId
    ? (jugadoresDelEquipoSeleccionado.find((j) => j.id === jugadorFocoId) ?? campoOrdenado.find((j) => j.id === jugadorFocoId) ?? null)
    : null;

  // Tabla de hoyo a hoyo del jugador con el foco puesto (03/10, formato
  // nuevo — ver components/TablaHoyoAHoyo.tsx) — extraído a su propia
  // función para poder usarse en dos sitios: debajo de todo en la pestaña
  // "Porra" (igual que antes) y, pedido nuevo de Iñi, justo debajo de los
  // equipos que lo tienen en la pestaña "Torneo" (antes también se veía
  // abajo del todo ahí, mezclado con lo de la pestaña Porra). Siempre pinta
  // los 18 hoyos de cada ronda conocida, llenos o vacíos — nunca solo los ya
  // jugados.
  function tablaResultadosJugador(jugador: JugadorRow) {
    if (hoyosFoco === 'cargando') {
      return <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Cargando el hoyo a hoyo...</p>;
    }
    if (!Array.isArray(hoyosFoco)) return null;
    const hoyos: HoyoRow[] = hoyosFoco;
    const rondaEnVivo = jugador.resultado_en_vivo_ronda;
    const rondasConocidas = Array.from(new Set([...hoyos.map((h) => h.ronda), ...(rondaEnVivo ? [rondaEnVivo] : [])])).sort((a, b) => a - b);
    const rondasAMostrar = rondasConocidas.length > 0 ? rondasConocidas : [1];

    // Campo de referencia para la fila "Par" — el de la ronda conocida más
    // reciente que ya tenga algún hoyo con campo_id (normalmente todas,
    // salvo que el torneo acabe de conectarse).
    let campoIdReferencia: string | null = null;
    for (let i = rondasAMostrar.length - 1; i >= 0 && !campoIdReferencia; i--) {
      campoIdReferencia = hoyos.find((h) => h.ronda === rondasAMostrar[i])?.campo_id ?? null;
    }

    const paresCompletos: (number | null)[] = Array.from({ length: 18 }, (_, i) => {
      const desdeBiblioteca = campoIdReferencia ? (paresPorCampoId[campoIdReferencia]?.[i] ?? null) : null;
      if (desdeBiblioteca !== null) return desdeBiblioteca;
      // Biblioteca todavía sin ese campo (torneo recién conectado) — se cae
      // de vuelta al par de cualquier hoyo con ese número que ya se haya
      // jugado (mismo criterio de siempre).
      return hoyos.find((h) => h.hoyo === i + 1)?.par ?? null;
    });

    const filas: FilaRondaTabla[] = rondasAMostrar.map((numero) => {
      const hoyosRonda = hoyos.filter((h) => h.ronda === numero);
      const hoyosPorNumero = new Map(hoyosRonda.map((h) => [h.hoyo, h]));
      const campoId = hoyosRonda[0]?.campo_id ?? null;
      const casillas: CasillaHoyo[] = Array.from({ length: 18 }, (_, i) => {
        const h = hoyosPorNumero.get(i + 1);
        return h ? { par: h.par, golpes: h.golpes, tipo_resultado: h.tipo_resultado } : null;
      });
      return { numero, nombreCampo: campoId ? (nombresCampo[campoId] ?? null) : null, casillas };
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <TablaHoyoAHoyo paresCompletos={paresCompletos} filas={filas} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(Object.keys(ETIQUETA_TIPO_RESULTADO) as TipoResultadoHoyo[]).map((t) => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: S.MUTED_3 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  flexShrink: 0,
                  borderRadius: t === 'eagle_o_mejor' || t === 'birdie' ? '50%' : t === 'par' ? '50%' : 3,
                  background: t === 'par' ? 'transparent' : COLOR_TIPO_RESULTADO[t].fondo,
                  border: t === 'par' ? `1px solid ${S.MUTED_3}` : 'none',
                  display: 'inline-block',
                }}
              />
              {ETIQUETA_TIPO_RESULTADO[t]}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 20px 40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>{porra.major}</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT }}>Clasificación en directo</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>{equipos.length} equipo{equipos.length === 1 ? '' : 's'} inscrito{equipos.length === 1 ? '' : 's'}</p>
          </div>

          <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
            <button type="button" onClick={() => setVista('porra')} style={vistaPillStyle(vista === 'porra')}>
              Porra
            </button>
            <button type="button" onClick={() => setVista('torneo')} style={vistaPillStyle(vista === 'torneo')}>
              Torneo
            </button>
            <button type="button" onClick={() => setVista('premios')} style={vistaPillStyle(vista === 'premios')}>
              {torneoFinalizado ? 'Clasificación final' : 'Premios'}
            </button>
            {/* Pestaña Información (nueva, 03/10, pedido de Iñi: "va a haber
                gente que entre por primera vez y quiero que sepan cómo
                funciona") — ver más abajo, vista === 'informacion'. */}
            <button type="button" onClick={() => setVista('informacion')} style={vistaPillStyle(vista === 'informacion')}>
              Información
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', position: 'relative' }}>
            {/* Interruptor para VER la clasificación con o sin el bono
                restado (02/10, pedido explícito de Iñi tras la corrección
                anterior — esto solo cambia lo que se pinta en esta
                pantalla; la liquidación real siempre lo aplica, ver
                comentario de `mostrarBono` más arriba). */}
            <button
              type="button"
              onClick={() => setMostrarBono((v) => !v)}
              aria-pressed={mostrarBono}
              style={{
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                color: mostrarBono ? '#04140B' : S.MUTED_2,
                background: mostrarBono ? '#F0B94D' : S.PANEL,
                border: `1px solid ${mostrarBono ? '#F0B94D' : '#1E2723'}`,
                borderRadius: 999,
                padding: '6px 10px',
                cursor: 'pointer',
              }}
            >
              Bono de podio (−10 / −5 / −3): {mostrarBono ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              aria-label="Más información sobre el bono de podio"
              onMouseEnter={() => setMostrarInfoBono(true)}
              onMouseLeave={() => setMostrarInfoBono(false)}
              onClick={() => setMostrarInfoBono((v) => !v)}
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: `1px solid ${S.MUTED_3}`,
                background: 'transparent',
                color: S.MUTED_3,
                fontSize: 10.5,
                fontWeight: 700,
                fontFamily: "'Manrope', sans-serif",
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              i
            </button>
            {/* Capa superpuesta (position: absolute, no empuja nada debajo)
                con la explicación resumida — pedido de Iñi, 02/10: "que de
                primeras no aparezca ningún mensaje informativo" y que el
                botón de más información no desplace la clasificación. */}
            {mostrarInfoBono && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 6,
                  zIndex: 20,
                  width: 260,
                  padding: '10px 12px',
                  background: '#101614',
                  border: '1px solid rgba(240,185,77,0.3)',
                  borderRadius: 10,
                  fontSize: 10.5,
                  color: S.MUTED_2,
                  lineHeight: 1.4,
                  boxShadow: '0 10px 24px rgba(0,0,0,0.4)',
                }}
              >
                Se resta al equipo que tenga a ese jugador: −10 al 1º, −5 al 2º y −3 al 3er clasificado real del torneo (no de la porra). En caso de empate, gana el grupo peor clasificado (Morado &gt; Azul &gt; Verde &gt; Amarillo); si es el mismo grupo, se reparte entre los empatados.
              </div>
            )}

            {/* Campanita de sonido (03/10, pedido de Iñi): justo a la
                derecha del bono de podio — verde con la campana sola
                cuando está activado, roja con la campana tachada cuando
                está desactivado. Controla el sonido de los avisos de
                resultado de más abajo; se recuerda por dispositivo (ver
                lib/sonidoAviso.ts). */}
            <button
              type="button"
              onClick={() => {
                const nuevoValor = !sonidoActivado;
                setSonidoActivado(nuevoValor);
                guardarPreferenciaSonido(nuevoValor);
              }}
              aria-pressed={sonidoActivado}
              aria-label={sonidoActivado ? 'Desactivar el sonido de los avisos' : 'Activar el sonido de los avisos'}
              title={sonidoActivado ? 'Sonido de avisos activado' : 'Sonido de avisos desactivado'}
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                cursor: 'pointer',
                border: `1px solid ${sonidoActivado ? 'rgba(61,220,132,0.4)' : 'rgba(255,92,92,0.4)'}`,
                background: sonidoActivado ? 'rgba(61,220,132,0.12)' : 'rgba(255,92,92,0.12)',
              }}
            >
              {sonidoActivado ? '🔔' : '🔕'}
            </button>
          </div>

          {/* Aviso de resultado no-par (03/10, pedido de Iñi): tira de 5
              segundos justo debajo del bono de podio, con sonido (si está
              activado), cada vez que cualquier jugador de esta porra hace
              un birdie, eagle, bogey o doble bogey — ver el efecto de
              arriba que rellena `avisos`. CAMBIO 03/10 (pedido de Iñi): look
              and feel negro y verde de toda la app, en vez del dorado que
              tenía antes — el punto de color de dentro sigue indicando el
              tipo de resultado (rojo birdie, negro bogey...), solo cambia el
              fondo/borde de la tira. */}
          {avisos.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 14px',
                borderRadius: 10,
                alignSelf: 'flex-start',
                background: 'rgba(61,220,132,0.1)',
                border: '1px solid rgba(61,220,132,0.4)',
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: COLOR_TIPO_RESULTADO[avisos[0].tipo].fondo }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: S.TEXT }}>
                {avisos[0].jugador} ha hecho {ETIQUETA_TIPO_RESULTADO[avisos[0].tipo].toLowerCase()}
              </span>
            </div>
          )}

          {vista === 'porra' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {/* Ancho subido de 126 a 180 (02/10, pedido de Iñi: "hay que
                  ganar un poco de espacio para el nombre completo de los
                  equipos... tenemos espacio [de sobra] en la parte de los
                  jugadores [el panel de la derecha]") — al ser `flex: 1` el
                  panel de la derecha, el espacio que gana esta columna se
                  lo quita automáticamente a ese panel, que tenía mucho de
                  más. */}
              <div style={{ flexShrink: 0, width: 180, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Equipos ({equipos.length})</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <input
                    value={busquedaEquipo}
                    onChange={(e) => setBusquedaEquipo(e.target.value)}
                    placeholder="Buscar equipo..."
                    style={{ ...S.input, flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 11 }}
                  />
                  {/* Filtro "solo favoritos" (02/10, pedido de Iñi) — al
                      lado del buscador. */}
                  <button
                    type="button"
                    onClick={() => setSoloFavoritos((v) => !v)}
                    title={soloFavoritos ? 'Ver todos los equipos' : 'Ver solo favoritos'}
                    style={{
                      flexShrink: 0,
                      width: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 8,
                      border: `1px solid ${soloFavoritos ? '#F0B94D' : '#1E2723'}`,
                      background: soloFavoritos ? 'rgba(240,185,77,0.15)' : S.PANEL,
                      color: soloFavoritos ? '#F0B94D' : S.MUTED_3,
                      cursor: 'pointer',
                      fontSize: 13,
                      lineHeight: 1,
                    }}
                  >
                    {soloFavoritos ? '★' : '☆'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 340, overflowY: 'auto' }}>
                  {equiposOrdenados
                    .map((eq, i) => ({ eq, rango: i + 1 }))
                    .filter(({ eq }) => !busquedaEquipo.trim() || normalizarNombre(eq.nombreEquipo ?? '').includes(normalizarNombre(busquedaEquipo)))
                    .filter(({ eq }) => !soloFavoritos || favoritos.has(eq.equipoId))
                    .map(({ eq, rango }) => {
                      const activo = eq.equipoId === equipoSeleccionado.equipoId;
                      const esFavorito = favoritos.has(eq.equipoId);
                      return (
                        <motion.a
                          layout
                          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                          key={eq.equipoId}
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setEquipoSeleccionadoId(eq.equipoId);
                            setJugadorFocoId(null);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: 8,
                            background: activo ? 'rgba(61,220,132,0.1)' : esFavorito ? 'rgba(240,185,77,0.1)' : S.PANEL,
                            border: `1px solid ${activo ? 'rgba(61,220,132,0.4)' : esFavorito ? 'rgba(240,185,77,0.35)' : '#1E2723'}`,
                            borderRadius: 9,
                            textDecoration: 'none',
                          }}
                        >
                          <span style={{ flexShrink: 0, width: 14, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{rango}</span>
                          <EstrellaFavorito activo={esFavorito} onToggle={() => alternarFavorito(eq.equipoId)} />
                          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {eq.nombreEquipo}
                          </span>
                          <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, color: S.MUTED_2 }}>
                            {formatGolfScore(totalEquipo(eq.jugadores, jugadoresPorId, bonosParaMostrar))}
                          </span>
                        </motion.a>
                      );
                    })}
                  {soloFavoritos && !equiposOrdenados.some((eq) => favoritos.has(eq.equipoId)) && (
                    <p style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4, padding: '4px 2px' }}>
                      Todavía no tienes ningún equipo marcado como favorito aquí — pulsa la estrella de un equipo para añadirlo.
                    </p>
                  )}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Cabecera del equipo, separada visualmente de la lista de
                    jugadores de abajo (corregido 01/10, aviso de Iñi: "se me
                    abre a la derecha... digamos que están de la misma forma
                    visualizados... me gustaría que... esté un poquito más
                    separada la cajita del nombre del equipo de los
                    jugadores con una línea en medio") — fondo e borde con un
                    tinte verde y una línea de acento más gruesa debajo, más
                    separación con el primer jugador. */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'rgba(61,220,132,0.08)',
                    border: '1px solid rgba(61,220,132,0.35)',
                    borderBottom: '2px solid #3DDC84',
                    borderRadius: 10,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 14.5, color: '#3DDC84', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {equipoSeleccionado.nombreEquipo}
                  </span>
                  <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: S.TEXT }}>
                    {formatGolfScore(totalEquipo(equipoSeleccionado.jugadores, jugadoresPorId, bonosParaMostrar))}
                  </span>
                </div>
                {jugadoresDelEquipoSeleccionado.map((j) => (
                  <motion.a
                    layout
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                    key={j.id}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setJugadorFocoId((prev) => (prev === j.id ? null : j.id));
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 10px',
                      background: jugadorFocoId === j.id ? 'rgba(61,220,132,0.1)' : S.PANEL,
                      border: `1px solid ${jugadorFocoId === j.id ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                      borderRadius: 9,
                      textDecoration: 'none',
                    }}
                  >
                    {/* Favorito de jugador (03/10, pedido de Iñi) — mismo
                        mecanismo que la estrellita de equipo. */}
                    <EstrellaFavorito activo={favoritosJugador.has(j.id)} onToggle={() => alternarFavoritoJug(j.id)} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                        <span
                          style={{
                            minWidth: 0,
                            flexShrink: 1,
                            fontFamily: "'Barlow Condensed', sans-serif",
                            fontWeight: 700,
                            fontSize: 12.5,
                            color: S.TEXT,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {j.nombre}
                        </span>
                        {/* Bono de podio del jugador (02/10): número
                            pequeñito justo al lado del nombre, en vez de su
                            propia línea entera — pedido de Iñi: "en algún
                            lado en pequeñito... al lado del nombre". */}
                        {(bonosParaMostrar.get(j.id) ?? 0) !== 0 && (
                          <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, color: '#F0B94D' }}>{bonosParaMostrar.get(j.id)}</span>
                        )}
                      </span>
                      {j.grupo_porra && <span style={{ fontSize: 9.5, fontWeight: 700, color: COLOR_GRUPO[j.grupo_porra] }}>{GRUPO_PORRA_LABELS[j.grupo_porra]}</span>}
                      {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                    </div>
                    <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>
                      {formatGolfScore((j.resultado_en_vivo_total ?? 0) + (bonosParaMostrar.get(j.id) ?? 0))}
                    </span>
                  </motion.a>
                ))}
              </div>
            </div>
          )}

          {vista === 'torneo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Campo completo ({campoOrdenado.length} jugadores)</span>
              <div style={{ display: 'flex', gap: 5 }}>
                <input
                  value={busquedaJugador}
                  onChange={(e) => setBusquedaJugador(e.target.value)}
                  placeholder="Buscar jugador..."
                  style={{ ...S.input, flex: 1, minWidth: 0, padding: '7px 10px', fontSize: 12 }}
                />
                {/* Filtro "solo favoritos" (03/10, pedido de Iñi) — mismo
                    patrón que el de equipos de la pestaña Porra. */}
                <button
                  type="button"
                  onClick={() => setSoloFavoritosJugador((v) => !v)}
                  title={soloFavoritosJugador ? 'Ver todos los jugadores' : 'Ver solo favoritos'}
                  style={{
                    flexShrink: 0,
                    width: 30,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    border: `1px solid ${soloFavoritosJugador ? '#F0B94D' : '#1E2723'}`,
                    background: soloFavoritosJugador ? 'rgba(240,185,77,0.15)' : S.PANEL,
                    color: soloFavoritosJugador ? '#F0B94D' : S.MUTED_3,
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1,
                  }}
                >
                  {soloFavoritosJugador ? '★' : '☆'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 380, overflowY: 'auto' }}>
                {campoOrdenado
                  .map((j, i) => ({ j, rango: i + 1 }))
                  .filter(({ j }) => !busquedaJugador.trim() || normalizarNombre(j.nombre).includes(normalizarNombre(busquedaJugador)))
                  .filter(({ j }) => !soloFavoritosJugador || favoritosJugador.has(j.id))
                  .map(({ j, rango }) => {
                    // Equipos de ESTA porra que tienen a este jugador (nuevo,
                    // 02/10, pedido de Iñi: "cuando pulses encima de un
                    // jugador... quiero que se despliegue justo debajo suyo
                    // cuáles son los equipos que tienen a ese jugador" —
                    // mismo espíritu que pulsar un equipo en la pestaña Porra
                    // para ver sus jugadores, pero al revés). Pulsar un
                    // equipo de la lista salta a la pestaña Porra con ese
                    // equipo ya seleccionado.
                    const equiposConEsteJugador = jugadorFocoId === j.id ? equiposOrdenados.filter((eq) => eq.jugadores.includes(j.id)) : [];
                    return (
                      <motion.div layout transition={{ type: 'spring', stiffness: 420, damping: 38 }} key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setJugadorFocoId((prev) => (prev === j.id ? null : j.id));
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '9px 10px',
                            background: jugadorFocoId === j.id ? 'rgba(61,220,132,0.1)' : S.PANEL,
                            border: `1px solid ${jugadorFocoId === j.id ? 'rgba(61,220,132,0.4)' : '#1E2723'}`,
                            borderRadius: 9,
                            textDecoration: 'none',
                          }}
                        >
                          <span style={{ flexShrink: 0, width: 20, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{rango}</span>
                          <EstrellaFavorito activo={favoritosJugador.has(j.id)} onToggle={() => alternarFavoritoJug(j.id)} />
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
                            {j.grupo_porra && <span style={{ fontSize: 9.5, fontWeight: 700, color: COLOR_GRUPO[j.grupo_porra] }}>{GRUPO_PORRA_LABELS[j.grupo_porra]}</span>}
                            {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3 }}>{estadoJugador(j)}</span>}
                          </div>
                          <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>{formatGolfScore(j.resultado_en_vivo_total ?? 0)}</span>
                        </a>
                        {jugadorFocoId === j.id && (
                          <div style={{ margin: '0 0 2px 20px', padding: '7px 9px', background: 'rgba(61,220,132,0.05)', border: '1px dashed rgba(61,220,132,0.3)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>
                              {equiposConEsteJugador.length === 0 ? 'Ningún equipo de esta porra lo tiene' : `Equipos de esta porra que lo tienen (${equiposConEsteJugador.length})`}
                            </span>
                            {equiposConEsteJugador.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                {equiposConEsteJugador.map((eq) => (
                                  <a
                                    key={eq.equipoId}
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setVista('porra');
                                      setEquipoSeleccionadoId(eq.equipoId);
                                    }}
                                    style={{ fontSize: 10.5, fontWeight: 700, color: '#3DDC84', background: 'rgba(61,220,132,0.12)', border: '1px solid rgba(61,220,132,0.3)', borderRadius: 999, padding: '4px 9px', textDecoration: 'none', whiteSpace: 'nowrap' }}
                                  >
                                    {eq.nombreEquipo}
                                  </a>
                                ))}
                              </div>
                            )}

                            {/* Resultados hoyo a hoyo (03/10, pedido de
                                Iñi): en la pestaña Torneo va JUSTO debajo de
                                los equipos que tienen a este jugador, no
                                abajo del todo de la página (eso se queda
                                solo para la pestaña Porra, ver más abajo). */}
                            <div style={{ paddingTop: 2, borderTop: `1px solid ${S.CARD_BORDER}` }}>
                              {estadoJugador(j) && <span style={{ fontSize: 9, color: S.MUTED_3, display: 'block', marginBottom: 5 }}>{estadoJugador(j)}</span>}
                              {tablaResultadosJugador(j)}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                {soloFavoritosJugador && !campoOrdenado.some((j) => favoritosJugador.has(j.id)) && (
                  <p style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4, padding: '4px 2px' }}>
                    Todavía no tienes ningún jugador marcado como favorito aquí — pulsa la estrella de un jugador para añadirlo.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Pestaña Premios / Clasificación final (02/10 y 03/10, pedido
              de Iñi: "tiene que haber una tercera pestaña que sea premios...
              con el look and feel... de tonos negros y verdes" y, más
              adelante, "cuando se finalice un torneo... en vez de premios
              aparezca clasificación final... que en los puestos premiados
              se calcule cuánto es el dinero que gana cada uno... que
              aparezca ahí directamente"). Mientras el torneo no se ha dado
              por terminado (torneoFinalizado, decidido por la ruta de
              sincronización — ver drafters-schema.sql), se ve solo el
              reparto por tramos, igual que siempre; en cuanto termina, se
              ve la clasificación real de cada equipo con su premio ya
              calculado (mismo cálculo exacto que la liquidación automática,
              lib/liquidacionGolfAutomatica.ts, con el bono de podio siempre
              aplicado — nunca el bonosParaMostrar simulable de más arriba). */}
          {vista === 'premios' &&
            (() => {
              const bote = parteParaPremios(porra.precio) * equipos.length;
              const tramosPremios = calcularTramosPorInscritos(equipos.length);

              if (torneoFinalizado) {
                const clasificacionFinal: ClasificacionEntrada[] = equiposOrdenados.map((eq) => ({
                  equipoId: eq.equipoId,
                  valor: totalEquipo(eq.jugadores, jugadoresPorId, mapaBonosPodio),
                }));
                const repartoFinal = repartirPremiosConEmpates(clasificacionFinal, tramosPremios, bote, 'asc').sort((a, b) => a.posicion - b.posicion);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 14px', background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 12 }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>Torneo terminado · Bote total</span>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: '#3DDC84' }}>{formatEuros(bote)}</span>
                    </div>
                    {repartoFinal.map((r) => {
                      const eq = equiposOrdenados.find((e) => e.equipoId === r.equipoId);
                      return (
                        <div key={r.equipoId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                          <span style={{ flexShrink: 0, width: 32, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: r.importe > 0 ? '#F0B94D' : S.MUTED_3 }}>{r.posicion}º</span>
                          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {eq?.nombreEquipo ?? 'Equipo'}
                          </span>
                          <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: S.MUTED_2 }}>
                            {eq ? formatGolfScore(totalEquipo(eq.jugadores, jugadoresPorId, mapaBonosPodio)) : ''}
                          </span>
                          <span style={{ flexShrink: 0, width: 70, textAlign: 'right', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: r.importe > 0 ? '#3DDC84' : S.MUTED_3 }}>
                            {formatEuros(r.importe)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '20px 14px', background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.35)', borderRadius: 12 }}>
                    <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84' }}>Bote total</span>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: '#3DDC84' }}>{formatEuros(bote)}</span>
                  </div>
                  {tramosPremios.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>Todavía no hay suficientes equipos inscritos para calcular el reparto.</p>}
                  {tramosPremios.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT }}>{posicionLabel(t.desde, t.hasta)}</span>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 14, color: '#3DDC84' }}>{formatEuros((bote * t.porcentajeCadaUno) / 100)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

          {/* Pestaña Información (nueva, 03/10, pedido de Iñi): explica las
              reglas para quien entra por primera vez — pensada de cara a la
              porra grande de la semana que viene. El bono de podio (con el
              ranking real en vivo) va al final a propósito, "para que no
              moleste" el resto de la explicación. */}
          {vista === 'informacion' &&
            (() => {
              const jugadoresPodio = jugadores
                .filter((j) => (mapaBonosPodio.get(j.id) ?? 0) !== 0)
                .map((j) => ({ jugador: j, bono: mapaBonosPodio.get(j.id) as number }))
                .sort((a, b) => a.bono - b.bono);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ background: S.PANEL, border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 17, color: S.TEXT, margin: 0 }}>Cómo funciona esta porra</h2>

                    <div>
                      <h3 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84', margin: '0 0 3px' }}>
                        Puntuación
                      </h3>
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
                        El resultado de cada equipo es la suma de los golpes respecto al par de sus 5 jugadores: un birdie resta 1, un eagle resta 2, un bogey suma 1, un doble bogey
                        o peor suma 2 — igual que en golf de toda la vida. Gana quien tenga el resultado más bajo.
                      </p>
                    </div>

                    <div>
                      <h3 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84', margin: '0 0 3px' }}>
                        Empates entre equipos
                      </h3>
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
                        Si dos o más equipos empatan en la clasificación final, <strong style={{ color: S.TEXT }}>no hay desempate</strong>: el premio de esas posiciones se reparte a
                        partes iguales entre los equipos empatados.
                      </p>
                    </div>

                    <div>
                      <h3 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84', margin: '0 0 3px' }}>
                        Pago de la inscripción
                      </h3>
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
                        De los equipos que no se haya recibido el pago, no contarán.
                      </p>
                    </div>

                    <div>
                      <h3 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84', margin: '0 0 3px' }}>
                        Cómo se paga el premio
                      </h3>
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
                        Si tu equipo queda en un puesto premiado, el importe se refleja como saldo en tu cuenta de Drafters — es dinero ficticio, dentro de la propia plataforma. El
                        pago real te lo hace Iñi aparte, en función de ese resultado.
                      </p>
                    </div>
                  </div>

                  {/* Bono de podio al final, con el ranking real en vivo. */}
                  <div style={{ background: S.PANEL, border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <h3 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#3DDC84', margin: 0 }}>
                      Bono de podio
                    </h3>
                    <p style={{ fontSize: 12.5, lineHeight: 1.55, color: S.MUTED_2, margin: 0 }}>
                      Además de su propio resultado, el equipo que tenga entre sus jugadores al <strong style={{ color: S.TEXT }}>1º, 2º o 3º clasificado real del torneo</strong> (no
                      de la porra) recibe una bonificación: <strong style={{ color: '#3DDC84' }}>−10</strong> al líder, <strong style={{ color: '#3DDC84' }}>−5</strong> al segundo y{' '}
                      <strong style={{ color: '#3DDC84' }}>−3</strong> al tercero — se sigue un ranking real del torneo, no de la porra. En caso de empate entre jugadores del
                      torneo, se queda con la mejor posición el de precio más bajo; si el precio también coincide, el bono se reparte entre los empatados.
                    </p>
                    {jugadoresPodio.length === 0 ? (
                      <p style={{ fontSize: 11.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay ningún jugador en el podio real del torneo.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {jugadoresPodio.map(({ jugador, bono }) => (
                          <div
                            key={jugador.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 10px',
                              background: 'rgba(61,220,132,0.06)',
                              border: '1px solid rgba(61,220,132,0.25)',
                              borderRadius: 8,
                            }}
                          >
                            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: S.TEXT }}>{jugador.nombre}</span>
                            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: '#3DDC84' }}>{bono}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

          {/* CAMBIO 03/10 (pedido de Iñi): este bloque de abajo del todo
              solo se usa en la pestaña Porra (y Premios, por si acaso) — en
              la pestaña Torneo, los resultados del jugador con foco se
              pintan justo debajo de "equipos que lo tienen" (ver más
              arriba, tablaResultadosJugador dentro de campoOrdenado.map),
              y en Información no hay ningún jugador seleccionable. */}
          {jugadorFoco && vista !== 'torneo' && vista !== 'informacion' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{jugadorFoco.nombre} · resultados</span>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setJugadorFocoId(null);
                  }}
                  style={{ color: S.MUTED_3, fontSize: 13, textDecoration: 'none' }}
                >
                  ✕
                </a>
              </div>
              {estadoJugador(jugadorFoco) && <span style={{ fontSize: 11, color: S.MUTED_3 }}>{estadoJugador(jugadorFoco)}</span>}

              {tablaResultadosJugador(jugadorFoco)}
            </div>
          )}

          <span style={{ fontSize: 10, color: S.FAINT }}>
            *Clasificación en directo: resultado respecto al par de cada jugador/equipo (no puntos), actualizado automáticamente cada minuto. Se ve "E" (par)
            mientras un jugador todavía no tiene ningún resultado registrado.
          </span>

          {/* Vídeo publicitario debajo de todo (mismo criterio que en
              salas/[id]/clasificacion/page.tsx — pedido de Iñi, 27/09: "en
              alguna parte que sea accesible pero que tampoco moleste,
              vamos a meter los ítems de publicidad"). */}
          <div style={{ width: '100%' }}>
            <AnuncioVideoInline ubicacion="clasificacion" />
          </div>
        </div>
      </div>
    </main>
  );
}

function vistaPillStyle(active: boolean) {
  return {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    padding: '7px 12px',
    borderRadius: 999,
    border: `1px solid ${active ? '#3DDC84' : S.BORDER}`,
    background: active ? 'rgba(61,220,132,0.12)' : 'transparent',
    color: active ? '#3DDC84' : S.MUTED,
    cursor: 'pointer',
  };
}
