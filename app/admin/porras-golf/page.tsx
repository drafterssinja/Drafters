'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { parseListaJugadores, JugadorParseado } from '@/lib/parsePlayerList';
import { precioPorRanking } from '@/lib/pricing';
import { parsearListadoCuotas } from '@/lib/parsearCuotas';
import { calcularPreciosPorCuota, cuotaValida } from '@/lib/precioPorCuota';
import { calcularGrupoPorra, UMBRAL_MINIMO_ESPANOLES, PUESTO_NO_ENCONTRADO } from '@/lib/porraGrupos';
import { normalizarNombre } from '@/lib/nombreMatch';
import { PorraFormato, PORRA_FORMATO_LABELS, PORRA_FORMATO_COLOR, PORRA_FORMATO_DESCRIPCION_LARGA } from '@/lib/porraFormato';

// ============================================================================
// PORRAS DE GOLF — menú de administración dedicado (nuevo, 28/09)
// ============================================================================
// Pedido de Iñi, 28/09: "ahora la parte de la creación de las mesas de golf
// va a ser independiente de las mesas drafters de golf y va a haber un menú
// solamente de porras de golf... donde la carga de jugadores va a ser
// exactamente igual que la que estábamos haciendo para las mesas drafters,
// pero nos va a dar dos posibilidades: crearla en el formato que actualmente
// estamos haciendo de porras clásicas o en el formato de sueldo de 100.000
// con un valor de cada uno de los jugadores... y luego darme la posibilidad
// de listar las porras que están creadas y poder entrar a la porra".
//
// Antes, crear un torneo de golf desde "Nuevo torneo o jornada"
// (app/admin/page.tsx) podía, de paso, crear también la porra clásica de
// ese mismo torneo (checkbox "Crear la porra") — eso ya no ocurre: esa
// pantalla solo crea jugadores + mesas de Drafters. La porra (de cualquiera
// de los dos formatos) se crea siempre, únicamente, desde aquí.
//
// Reutiliza el mismo motor de parseo/precio que ya usaba el import de golf
// de las Mesas Drafters (parsearListadoCuotas + precioPorCuota, con
// precioPorRanking como respaldo si no hay cuotas) — el precio de cada
// jugador hace falta en los DOS formatos: en "presupuesto" decide cuánto
// cuesta ficharlo; en "clásica" se guarda igual en jugadores.precio (no lo
// usa la porra clásica, pero es la misma ficha maestra que comparten las
// Mesas Drafters de ese mismo torneo, si las hay).
//
// Aviso: jugadores es una ficha maestra compartida por deporte+competicion
// (no por porra) — si ya existen jugadores de este mismo nombre de torneo
// (creados aquí o desde "Nuevo torneo o jornada"), confirmar aquí los
// SUSTITUYE enteros, igual que en el importador de mesas. Normalmente no
// pasa nada (incluso conviene, si se repega el mismo listado para
// corregirlo), pero si ya había una porra distinta o unas mesas usando ese
// mismo nombre de torneo, su grupo de color / español se recalcula con lo
// que se pegue aquí.

type PreviewJugador = JugadorParseado & { esEspanol: boolean; cuota: number | null };

type PorraGolfAdmin = {
  id: string;
  major: string;
  competicion: string | null;
  estado: string;
  precio: number;
  fecha_limite_inscripcion: string | null;
  formato: PorraFormato;
  // 05/10: false = borrador creado solo desde Data Golf (oculto y sin correos
  // hasta que el admin lo publique) — ver drafters-schema.sql.
  publicada: boolean;
};

type JugadorRevision = { id: string; nombre: string; precio: number; es_espanol: boolean };

export default function AdminPorrasGolfPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [porras, setPorras] = useState<PorraGolfAdmin[]>([]);

  // Formulario de creación.
  const [formato, setFormato] = useState<PorraFormato>('clasica');
  const [torneoNombre, setTorneoNombre] = useState('');
  const [torneoFechaLimite, setTorneoFechaLimite] = useState('');
  const [precioEntrada, setPrecioEntrada] = useState('20');
  const [torneoTexto, setTorneoTexto] = useState('');
  const [previewJugadores, setPreviewJugadores] = useState<PreviewJugador[]>([]);
  const [avisosCuotas, setAvisosCuotas] = useState<string[]>([]);
  const [mapaRankingActual, setMapaRankingActual] = useState<Map<string, number>>(new Map());
  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  // Editar fecha / eliminar, sobre el listado de abajo.
  const [editandoFechaId, setEditandoFechaId] = useState<string | null>(null);
  const [fechaEditada, setFechaEditada] = useState('');
  const [guardandoFecha, setGuardandoFecha] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  // Revisión y publicación de borradores creados automáticamente (05/10).
  const [revisandoId, setRevisandoId] = useState<string | null>(null);
  const [jugadoresRevision, setJugadoresRevision] = useState<JugadorRevision[]>([]);
  const [cargandoRevision, setCargandoRevision] = useState(false);
  const [guardandoRevision, setGuardandoRevision] = useState(false);
  const [publicandoId, setPublicandoId] = useState<string | null>(null);

  async function cargarPorras() {
    const { data } = await supabase
      .from('porras')
      .select('id, major, competicion, estado, precio, fecha_limite_inscripcion, formato, publicada')
      .order('created_at', { ascending: false });
    setPorras((data as PorraGolfAdmin[]) ?? []);
  }

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

      const { data: perfilData } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();

      if (!activo) return;

      const p = perfilData as Perfil | null;
      if (!p || p.rol !== 'admin') {
        router.push('/cuenta');
        return;
      }

      setPerfil(p);
      setAutorizado(true);
      await cargarPorras();
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const usandoCuotas = useMemo(() => previewJugadores.some((j) => j.cuota !== null), [previewJugadores]);
  const preciosPreviewCuota = useMemo(
    () => calcularPreciosPorCuota(previewJugadores.map((j) => ({ nombre: j.nombre, cuota: j.cuota }))),
    [previewJugadores]
  );
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

  async function previsualizar() {
    setResultado(null);
    const { jugadores: conCuota, avisos } = parsearListadoCuotas(torneoTexto);
    if (conCuota.length > 0) {
      setPreviewJugadores(conCuota.map((j, i) => ({ nombre: j.nombre, rank: i + 1, esEspanol: false, cuota: j.cuota })));
      setAvisosCuotas(avisos);
    } else {
      setPreviewJugadores(parseListaJugadores(torneoTexto).map((j) => ({ ...j, esEspanol: false, cuota: null })));
      setAvisosCuotas([]);
    }

    const { data } = await supabase.from('rankings_mundiales').select('nombre, puesto').eq('deporte', 'golf');
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

  async function confirmarCreacion() {
    const nombreTorneo = torneoNombre.trim();
    const precioNum = Number(precioEntrada);
    if (!nombreTorneo || previewJugadores.length === 0 || !Number.isFinite(precioNum) || precioNum < 0) return;

    setCreando(true);
    setError(null);
    setResultado(null);

    const total = previewJugadores.length;

    const { data: rankingData } = await supabase.from('rankings_mundiales').select('nombre, puesto').eq('deporte', 'golf');
    const mapaRanking = new Map<string, number>();
    ((rankingData as { nombre: string; puesto: number }[] | null) ?? []).forEach((r) => mapaRanking.set(normalizarNombre(r.nombre), r.puesto));

    let noEncontrados = 0;
    const conPuestoGlobal = previewJugadores.map((j, i) => {
      const puestoGlobal = mapaRanking.get(normalizarNombre(j.nombre));
      if (puestoGlobal === undefined) noEncontrados += 1;
      return { ...j, i, puestoGlobal: puestoGlobal ?? null };
    });

    const precioPorIndice = new Map<number, number>();
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
      const ordenPorRankingMundial = [...conPuestoGlobal].sort((a, b) => (a.puestoGlobal ?? PUESTO_NO_ENCONTRADO) - (b.puestoGlobal ?? PUESTO_NO_ENCONTRADO) || a.i - b.i);
      ordenPorRankingMundial.forEach((j, idx) => {
        precioPorIndice.set(j.i, precioPorRanking(idx + 1, total));
        puestoParaGrupo.set(j.i, idx + 1);
      });
    }

    // El grupo de color y el marcado de "español" solo hacen falta en el
    // formato clásico — en "presupuesto" no hay listas por color, así que
    // se guardan a null/false (mismo criterio que ya usan hoy los
    // jugadores de fútbol, que tampoco tienen grupo de porra).
    const numEspanoles = formato === 'clasica' ? previewJugadores.filter((j) => j.esEspanol).length : 0;
    const filas = conPuestoGlobal.map((j) => ({
      nombre: j.nombre,
      deporte: 'golf' as const,
      competicion: nombreTorneo,
      precio: precioPorIndice.get(j.i)!,
      grupo_porra: formato === 'clasica' ? calcularGrupoPorra(puestoParaGrupo.get(j.i) ?? PUESTO_NO_ENCONTRADO, j.esEspanol, numEspanoles) : null,
      es_espanol: formato === 'clasica' ? j.esEspanol : false,
    }));

    const { error: borrarError } = await supabase.from('jugadores').delete().eq('deporte', 'golf').eq('competicion', nombreTorneo);
    if (borrarError) {
      setCreando(false);
      setError('No se ha podido preparar la creación (borrado de jugadores previos). Inténtalo de nuevo.');
      return;
    }

    const { error: insertError } = await supabase.from('jugadores').insert(filas);
    if (insertError) {
      setCreando(false);
      setError('No se han podido guardar los jugadores. Revisa el listado e inténtalo de nuevo.');
      return;
    }

    const fechaLimiteIso = torneoFechaLimite ? new Date(torneoFechaLimite).toISOString() : null;

    let porraCreada = false;
    const { count: porraExistente } = await supabase.from('porras').select('id', { count: 'exact', head: true }).eq('competicion', nombreTorneo);
    if (!porraExistente) {
      const { error: porraError } = await supabase.from('porras').insert({
        major: nombreTorneo,
        competicion: nombreTorneo,
        fecha_limite_inscripcion: fechaLimiteIso,
        estado: 'disponible',
        precio: precioNum,
        formato,
      });
      if (!porraError) porraCreada = true;
    }

    const sinCuotaValida = usandoCuotas ? previewJugadores.filter((j) => !cuotaValida(j.cuota)).length : 0;

    setCreando(false);
    setResultado(
      `${porraCreada ? `Porra "${nombreTorneo}" creada (${PORRA_FORMATO_LABELS[formato]}).` : `Ya existía una porra para "${nombreTorneo}" — no se ha duplicado, pero se han actualizado sus ${filas.length} jugadores.`}` +
        (noEncontrados > 0
          ? ` ⚠️ ${noEncontrados} jugador${noEncontrados === 1 ? '' : 'es'} no ${noEncontrados === 1 ? 'se ha encontrado' : 'se han encontrado'} en el ranking mundial de golf.`
          : '') +
        (sinCuotaValida > 0 ? ` ⚠️ ${sinCuotaValida} jugador${sinCuotaValida === 1 ? '' : 'es'} sin cuota válida — precio mínimo aplicado.` : '')
    );
    setPreviewJugadores([]);
    setAvisosCuotas([]);
    setTorneoTexto('');
    setTorneoNombre('');
    setTorneoFechaLimite('');
    setPrecioEntrada('20');
    setFormato('clasica');
    await cargarPorras();
  }

  async function abrirRevision(p: PorraGolfAdmin) {
    if (revisandoId === p.id) {
      setRevisandoId(null);
      return;
    }
    setRevisandoId(p.id);
    setJugadoresRevision([]);
    setCargandoRevision(true);
    const { data } = await supabase
      .from('jugadores')
      .select('id, nombre, precio, es_espanol')
      .eq('deporte', 'golf')
      .eq('competicion', p.competicion ?? '')
      .order('precio', { ascending: false });
    setJugadoresRevision((data as JugadorRevision[]) ?? []);
    setCargandoRevision(false);
  }

  function toggleEspanolRevision(id: string) {
    setJugadoresRevision((prev) => prev.map((j) => (j.id === id ? { ...j, es_espanol: !j.es_espanol } : j)));
  }

  // Guarda los españoles marcados y recalcula el grupo de color de todos
  // (mismo cálculo que al crear a mano: puesto = orden por precio, que sale
  // de la cuota; con 3 o más españoles se crea la lista aparte).
  async function guardarRevision(p: PorraGolfAdmin) {
    setGuardandoRevision(true);
    setError(null);
    const numEspanoles = p.formato === 'clasica' ? jugadoresRevision.filter((j) => j.es_espanol).length : 0;
    const resultados = await Promise.all(
      jugadoresRevision.map((j, idx) =>
        supabase
          .from('jugadores')
          .update({
            es_espanol: p.formato === 'clasica' ? j.es_espanol : false,
            grupo_porra: p.formato === 'clasica' ? calcularGrupoPorra(idx + 1, j.es_espanol, numEspanoles) : null,
          })
          .eq('id', j.id)
      )
    );
    setGuardandoRevision(false);
    if (resultados.some((r) => r.error)) {
      setError('No se han podido guardar todos los cambios. Inténtalo de nuevo.');
      return;
    }
    setResultado(`Españoles guardados (${numEspanoles}) y grupos recalculados para "${p.major}".`);
  }

  async function publicarBorrador(p: PorraGolfAdmin) {
    if (!window.confirm(`¿Publicar "${p.major}"? Pasará a ser visible para todos los usuarios y se enviarán los avisos por correo.`)) return;
    setPublicandoId(p.id);
    setError(null);
    // Primero las mesas y después la porra: el aviso por correo se dispara al
    // publicar la porra, y para entonces las mesas ya deben estar visibles.
    const { error: salasError } = await supabase.from('salas').update({ publicada: true }).eq('deporte', 'golf').eq('competicion', p.competicion ?? '');
    if (salasError) {
      setPublicandoId(null);
      setError('No se han podido publicar las mesas. Inténtalo de nuevo.');
      return;
    }
    const { error: porraError } = await supabase.from('porras').update({ publicada: true }).eq('id', p.id);
    setPublicandoId(null);
    if (porraError) {
      setError('No se ha podido publicar la porra. Inténtalo de nuevo.');
      return;
    }
    setRevisandoId(null);
    setResultado(`"${p.major}" publicada (porra y mesas).`);
    await cargarPorras();
  }

  function empezarEdicionFecha(p: PorraGolfAdmin) {
    setEditandoFechaId(p.id);
    setFechaEditada(p.fecha_limite_inscripcion ? p.fecha_limite_inscripcion.slice(0, 16) : '');
  }

  async function guardarFecha(porraId: string) {
    setGuardandoFecha(true);
    const nuevaFechaIso = fechaEditada ? new Date(fechaEditada).toISOString() : null;
    await supabase.from('porras').update({ fecha_limite_inscripcion: nuevaFechaIso }).eq('id', porraId);
    setGuardandoFecha(false);
    setEditandoFechaId(null);
    await cargarPorras();
  }

  async function eliminarPorra(p: PorraGolfAdmin) {
    if (!window.confirm(`¿Eliminar la porra "${p.major}"? Se reembolsará a los equipos inscritos y se les avisará. Esta acción no se puede deshacer.`)) return;
    setEliminandoId(p.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('eliminar_porra', { p_porra_id: p.id });
    setEliminandoId(null);
    if (rpcError) {
      setError('No se ha podido eliminar la porra. Inténtalo de nuevo.');
      return;
    }
    await cargarPorras();
  }

  if (autorizado === null || !perfil) {
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

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={`${perfil.saldo_simulado.toFixed(2)} €`} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>
              ← Panel de administración
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Porras de golf</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Menú propio, independiente de las mesas de Drafters: carga el listado del torneo, elige el formato y crea la porra.
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
            <span style={S.sectionLabel}>Formato de la porra</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['clasica', 'presupuesto'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFormato(f)} style={S.pill(formato === f)}>
                  {PORRA_FORMATO_LABELS[f]}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>{PORRA_FORMATO_DESCRIPCION_LARGA[formato]}</p>

            <div style={S.field}>
              <span style={S.label}>Nombre del torneo</span>
              <input value={torneoNombre} onChange={(e) => setTorneoNombre(e.target.value)} placeholder="PGA Tour · The Open, DP World Tour..." style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Fecha y hora límite de inscripción</span>
              <input type="datetime-local" value={torneoFechaLimite} onChange={(e) => setTorneoFechaLimite(e.target.value)} style={S.input} />
            </div>
            <div style={S.field}>
              <span style={S.label}>Precio de entrada por equipo</span>
              <input type="number" min={0} step="0.01" value={precioEntrada} onChange={(e) => setPrecioEntrada(e.target.value)} style={S.input} />
            </div>

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
            <button type="button" onClick={previsualizar} disabled={!torneoTexto.trim()} style={{ ...S.secondaryLinkButton, opacity: torneoTexto.trim() ? 1 : 0.5 }}>
              Previsualizar listado
            </button>

            {previewJugadores.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                  {previewJugadores.length} jugadores detectados{usandoCuotas ? ' · precio calculado por cuota' : ' · precio calculado por ranking (sin cuotas en el listado)'} — revisa y corrige antes de confirmar.
                  {formato === 'clasica' && ` Marca "ES" en los jugadores españoles — con ${UMBRAL_MINIMO_ESPANOLES} o más marcados se les crea una lista aparte.`}
                </span>
                {avisosCuotas.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: '#F0B94D' }}>
                    {avisosCuotas.map((a, i) => (
                      <li key={i}>{a} — no está en la lista de abajo; corrige el texto pegado y vuelve a previsualizar si falta.</li>
                    ))}
                  </ul>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                  {previewJugadores.map((j, i) => {
                    const precioCalc = preciosPreviewCuota[i];
                    const puestoGrupo = usandoCuotas ? puestosPreviewPorCuota[i] : puestosPreviewPorRankingMundial[i];
                    const tituloPuesto = formato === 'clasica' ? 'Decide el grupo de la porra' : 'Puesto en este torneo';
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span title={tituloPuesto} style={{ width: 40, flexShrink: 0, fontSize: 10.5, fontWeight: 700, textAlign: 'right', color: puestoGrupo !== null ? S.ACCENT : S.ERROR }}>
                          {puestoGrupo !== null ? `#${puestoGrupo}` : '¿?'}
                        </span>
                        <input value={j.nombre} onChange={(e) => editarNombreVistaPrevia(i, e.target.value)} style={{ ...S.input, padding: '8px 10px', fontSize: 13 }} />
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
                        <span title={precioCalc.sinCuota ? 'Sin cuota válida — precio mínimo' : 'Precio del jugador'} style={{ width: 60, flexShrink: 0, fontSize: 11, fontWeight: 800, textAlign: 'right', color: precioCalc.sinCuota ? S.ERROR : '#F0B94D' }}>
                          {precioCalc.precio} €
                        </span>
                        {formato === 'clasica' && (
                          <label title="Jugador español" style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11, color: S.MUTED_2, cursor: 'pointer' }}>
                            <input type="checkbox" checked={j.esEspanol} onChange={() => toggleEspanolVistaPrevia(i)} style={{ width: 15, height: 15, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }} />
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
                  onClick={confirmarCreacion}
                  disabled={creando || !torneoNombre.trim()}
                  style={{ ...S.primaryButton, marginTop: 0, opacity: creando || !torneoNombre.trim() ? 0.7 : 1 }}
                >
                  {creando ? 'Creando...' : `Crear porra (${PORRA_FORMATO_LABELS[formato]}) · ${previewJugadores.length} jugadores`}
                </button>
              </div>
            )}
            {resultado && <p style={S.infoText}>{resultado}</p>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>Porras de golf creadas</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porras.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no hay ninguna porra creada.</p>}
              {porras.map((p) => {
                const editando = editandoFechaId === p.id;
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: PORRA_FORMATO_COLOR[p.formato] }}>
                          {PORRA_FORMATO_LABELS[p.formato]}
                        </span>
                        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.major || p.competicion || '(sin nombre de torneo)'}
                        </span>
                        <span style={{ fontSize: 11, color: S.FAINT }}>{p.estado} · {p.precio.toFixed(2)} €</span>
                        {!p.publicada && (
                          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10, color: '#F0B94D' }}>
                            BORRADOR — oculta para los usuarios y sin correos hasta que la publiques
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {!p.publicada && (
                          <>
                            <button
                              type="button"
                              onClick={() => abrirRevision(p)}
                              style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#F0B94D', background: 'transparent', border: '1px solid #F0B94D', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
                            >
                              {revisandoId === p.id ? 'Cerrar' : 'Revisar'}
                            </button>
                            <button
                              type="button"
                              disabled={publicandoId === p.id}
                              onClick={() => publicarBorrador(p)}
                              style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#04140B', background: '#3DDC84', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: publicandoId === p.id ? 0.7 : 1 }}
                            >
                              {publicandoId === p.id ? 'Publicando...' : 'Publicar'}
                            </button>
                          </>
                        )}
                        <Link
                          href={`/porras/${p.id}`}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ACCENT, background: 'transparent', border: `1px solid rgba(61,220,132,0.4)`, borderRadius: 8, padding: '6px 10px', textDecoration: 'none' }}
                        >
                          Abrir
                        </Link>
                        <button
                          type="button"
                          onClick={() => (editando ? setEditandoFechaId(null) : empezarEdicionFecha(p))}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#C9D2CC', background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
                        >
                          {editando ? 'Cancelar' : 'Editar fecha'}
                        </button>
                        <button
                          type="button"
                          disabled={eliminandoId === p.id}
                          onClick={() => eliminarPorra(p)}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: S.ERROR, background: 'transparent', border: `1px solid ${S.ERROR}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: eliminandoId === p.id ? 0.6 : 1 }}
                        >
                          {eliminandoId === p.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </div>
                    {revisandoId === p.id && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 10 }}>
                        <p style={{ fontSize: 12, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
                          {p.formato === 'clasica'
                            ? `Marca "ES" en los jugadores españoles (con ${UMBRAL_MINIMO_ESPANOLES} o más se les crea una lista aparte) y pulsa Guardar. Después, Publicar.`
                            : 'Esta porra es de presupuesto: no usa listas por color, no hace falta marcar españoles.'}
                        </p>
                        {cargandoRevision && <p style={{ fontSize: 12, color: S.MUTED_3, margin: 0 }}>Cargando jugadores...</p>}
                        {p.formato === 'clasica' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                            {jugadoresRevision.map((j, idx) => (
                              <div key={j.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: S.TEXT }}>
                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <span style={{ color: S.MUTED_3 }}>{idx + 1}.</span> {j.nombre}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleEspanolRevision(j.id)}
                                  style={{ ...S.pill(j.es_espanol), padding: '3px 10px', fontSize: 11, flexShrink: 0 }}
                                >
                                  ES
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {p.formato === 'clasica' && jugadoresRevision.length > 0 && (
                          <button
                            type="button"
                            disabled={guardandoRevision}
                            onClick={() => guardarRevision(p)}
                            style={{ alignSelf: 'flex-start', fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#04140B', background: '#3DDC84', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', opacity: guardandoRevision ? 0.7 : 1 }}
                          >
                            {guardandoRevision ? 'Guardando...' : 'Guardar españoles'}
                          </button>
                        )}
                      </div>
                    )}
                    {editando && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 10 }}>
                        <input type="datetime-local" value={fechaEditada} onChange={(e) => setFechaEditada(e.target.value)} style={{ ...S.input, padding: '8px 10px', fontSize: 12.5 }} />
                        <button
                          type="button"
                          disabled={guardandoFecha}
                          onClick={() => guardarFecha(p.id)}
                          style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#04140B', background: '#3DDC84', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', opacity: guardandoFecha ? 0.7 : 1, whiteSpace: 'nowrap' }}
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
