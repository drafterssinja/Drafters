'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';

type Sala = { id: string; codigo: string; nombre: string; deporte: string; tipo: string; estado: string; buy_in: number };
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

const DEPORTES = ['futbol', 'golf', 'tenis'] as const;
const TIPOS_SALA = ['duelo', 'trio', 'doble_o_nada', 'triple_o_nada'] as const;
const TIPO_SALA_LABELS: Record<string, string> = {
  duelo: 'Duelo',
  trio: 'Trío',
  doble_o_nada: 'Doble o Nada',
  triple_o_nada: 'Triple o Nada',
};

// Mismos umbrales de buy-in que usa el resto de la app (pantalla de Salas del
// prototipo): bajo ≤25€, medio 25-100€, alto >100€.
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
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [jugadores, setJugadores] = useState<Jugador[]>([]);
  const [totalUsuarios, setTotalUsuarios] = useState<number | null>(null);
  const [inscripciones, setInscripciones] = useState<InscripcionFila[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoFila[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filtros del resumen financiero/actividad — mismas cuatro dimensiones que
  // en la maqueta visual del panel de superadmin (deporte, tipo de sala,
  // buy-in, periodo).
  const [filtroDeporte, setFiltroDeporte] = useState<string>('todos');
  const [filtroTipoSala, setFiltroTipoSala] = useState<string>('todos');
  const [filtroBuyIn, setFiltroBuyIn] = useState<string>('todos');
  const [filtroFecha, setFiltroFecha] = useState<string>('todo');

  // Formulario "crear sala"
  const [nombreSala, setNombreSala] = useState('');
  const [deporteSala, setDeporteSala] = useState<(typeof DEPORTES)[number]>('futbol');
  const [competicionSala, setCompeticionSala] = useState('');
  const [tipoSala, setTipoSala] = useState<(typeof TIPOS_SALA)[number]>('duelo');
  const [aforoSala, setAforoSala] = useState(2);
  const [buyInSala, setBuyInSala] = useState(10);
  const [creandoSala, setCreandoSala] = useState(false);

  // Formulario "crear jugador"
  const [nombreJugador, setNombreJugador] = useState('');
  const [deporteJugador, setDeporteJugador] = useState<(typeof DEPORTES)[number]>('futbol');
  const [competicionJugador, setCompeticionJugador] = useState('');
  const [precioJugador, setPrecioJugador] = useState(10000);
  const [creandoJugador, setCreandoJugador] = useState(false);

  async function cargarTodo() {
    const [{ data: salasData }, { data: jugadoresData }, { count }, { data: inscripcionesData, error: inscripcionesError }, { data: movimientosData, error: movimientosError }] =
      await Promise.all([
        supabase.from('salas').select('id, codigo, nombre, deporte, tipo, estado, buy_in').order('created_at', { ascending: false }),
        supabase.from('jugadores').select('id, nombre, deporte, competicion, precio, lesionado').order('created_at', { ascending: false }),
        supabase.from('perfiles').select('id', { count: 'exact', head: true }),
        // Cada inscripción arrastra el modo y, si es de una sala (no de una
        // porra), el deporte/tipo/buy-in de esa sala — para poder filtrar el
        // dinero jugado exactamente igual que en la maqueta visual.
        supabase.from('inscripciones').select('importe, fecha, equipos!inner(modo, salas(deporte, tipo, buy_in))'),
        supabase.from('movimientos').select('tipo, importe, creado_en'),
      ]);

    setSalas((salasData as Sala[]) ?? []);
    setJugadores((jugadoresData as Jugador[]) ?? []);
    setTotalUsuarios(count ?? 0);
    if (inscripcionesError) setError(inscripcionesError.message);
    else setInscripciones((inscripcionesData as unknown as InscripcionFila[]) ?? []);
    if (movimientosError) setError(movimientosError.message);
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

      const perfil = perfilData as Perfil | null;
      if (!perfil || perfil.rol !== 'admin') {
        router.push('/cuenta');
        return;
      }

      setAutorizado(true);
      await cargarTodo();
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
      aforo: aforoSala,
      buy_in: buyInSala,
    });

    setCreandoSala(false);

    if (insertError) {
      setError(insertError.message);
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
      setError(insertError.message);
      return;
    }

    setNombreJugador('');
    setCompeticionJugador('');
    await cargarTodo();
  }

  async function toggleLesionado(jugador: Jugador) {
    await supabase.from('jugadores').update({ lesionado: !jugador.lesionado }).eq('id', jugador.id);
    await cargarTodo();
  }

  async function cerrarSala(sala: Sala) {
    // Al marcarla 'finalizada', el trigger trg_salas_mantener_disponibles se
    // encarga solo de crear mesas nuevas del mismo tipo si hiciera falta.
    await supabase.from('salas').update({ estado: 'finalizada' }).eq('id', sala.id);
    await cargarTodo();
  }

  if (autorizado === null) {
    return (
      <main>
        <p className="subtitle">Comprobando acceso...</p>
      </main>
    );
  }

  const mesasPorDeporte = DEPORTES.map((d) => ({
    deporte: d,
    total: salas.filter((s) => s.deporte === d && s.estado !== 'finalizada').length,
  }));

  const maxDias = FECHA_OPCIONES.find((f) => f.key === filtroFecha)?.dias ?? null;
  const dentroDelPeriodo = (fechaIso: string) => {
    if (maxDias === null) return true;
    const dias = (Date.now() - new Date(fechaIso).getTime()) / (1000 * 60 * 60 * 24);
    return dias <= maxDias;
  };

  // Solo las inscripciones de SALAS (no porras) tienen deporte/tipo/buy-in
  // propios, así que son las que se pueden filtrar por esas tres dimensiones
  // — igual que en la maqueta visual.
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
  const rakeGanado = dineroJugado * 0.1; // 10% real sobre el dinero jugado ya filtrado, no un dato aparte.
  const dineroDepositado = movimientosFiltrados.filter((m) => m.tipo === 'deposito').reduce((acc, m) => acc + Number(m.importe), 0);
  const dineroRetirado = movimientosFiltrados.filter((m) => m.tipo === 'retiro').reduce((acc, m) => acc + Number(m.importe), 0);

  return (
    <main style={{ maxWidth: 560 }}>
      <h1>Panel de administración</h1>
      <p className="subtitle">Solo visible para el superadministrador.</p>
      {error && <p className="error-msg">{error}</p>}

      <div className="stat-grid">
        {mesasPorDeporte.map((m) => (
          <div className="stat-card" key={m.deporte}>
            <div className="value">{m.total}</div>
            <div className="label">Mesas en juego · {m.deporte}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: '8px 0 0' }}>Filtros del resumen financiero</h2>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="field">
          <label>Deporte</label>
          <select value={filtroDeporte} onChange={(e) => setFiltroDeporte(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#131917', color: '#f5f7f5', border: '1px solid #1e2723' }}>
            <option value="todos">Todos</option>
            {DEPORTES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo de sala</label>
          <select value={filtroTipoSala} onChange={(e) => setFiltroTipoSala(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#131917', color: '#f5f7f5', border: '1px solid #1e2723' }}>
            <option value="todos">Todas</option>
            {TIPOS_SALA.map((t) => <option key={t} value={t}>{TIPO_SALA_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Buy-in</label>
          <select value={filtroBuyIn} onChange={(e) => setFiltroBuyIn(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#131917', color: '#f5f7f5', border: '1px solid #1e2723' }}>
            <option value="todos">Cualquiera</option>
            <option value="bajo">Hasta 25 €</option>
            <option value="medio">25–100 €</option>
            <option value="alto">+100 €</option>
          </select>
        </div>
        <div className="field">
          <label>Periodo</label>
          <select value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#131917', color: '#f5f7f5', border: '1px solid #1e2723' }}>
            {FECHA_OPCIONES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="value">{dineroDepositado.toFixed(2)} €</div>
          <div className="label">Dinero depositado</div>
        </div>
        <div className="stat-card">
          <div className="value">{dineroRetirado.toFixed(2)} €</div>
          <div className="label">Dinero retirado</div>
        </div>
        <div className="stat-card">
          <div className="value">{partidasJugadas}</div>
          <div className="label">Partidas jugadas</div>
        </div>
        <div className="stat-card">
          <div className="value">{dineroJugado.toFixed(2)} €</div>
          <div className="label">Dinero jugado</div>
        </div>
        <div className="stat-card">
          <div className="value">{rakeGanado.toFixed(2)} €</div>
          <div className="label">Rake ganado (10%)</div>
        </div>
        <div className="stat-card">
          <div className="value">{totalUsuarios ?? '—'}</div>
          <div className="label">Usuarios registrados</div>
        </div>
      </div>

      <h2 style={{ fontSize: 16 }}>Crear mesa</h2>
      <form onSubmit={crearSala} className="card">
        <div className="field">
          <label htmlFor="nombreSala">Nombre</label>
          <input id="nombreSala" required value={nombreSala} onChange={(e) => setNombreSala(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="deporteSala">Deporte</label>
          <select id="deporteSala" value={deporteSala} onChange={(e) => setDeporteSala(e.target.value as typeof deporteSala)} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#131917', color: '#f5f7f5', border: '1px solid #1e2723' }}>
            {DEPORTES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="competicionSala">Competición</label>
          <input id="competicionSala" required value={competicionSala} onChange={(e) => setCompeticionSala(e.target.value)} placeholder="La Liga, PGA Tour..." />
        </div>
        <div className="field">
          <label htmlFor="tipoSala">Tipo</label>
          <select id="tipoSala" value={tipoSala} onChange={(e) => setTipoSala(e.target.value as typeof tipoSala)} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#131917', color: '#f5f7f5', border: '1px solid #1e2723' }}>
            {TIPOS_SALA.map((t) => <option key={t} value={t}>{TIPO_SALA_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="aforoSala">Aforo</label>
          <input id="aforoSala" type="number" min={2} required value={aforoSala} onChange={(e) => setAforoSala(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="buyInSala">Buy-in (€ simulados)</label>
          <input id="buyInSala" type="number" min={0} required value={buyInSala} onChange={(e) => setBuyInSala(Number(e.target.value))} />
        </div>
        <button type="submit" disabled={creandoSala}>{creandoSala ? 'Creando...' : 'Crear mesa'}</button>
      </form>
      <p className="subtitle" style={{ marginTop: -4 }}>
        Recuerda crear al menos 2 mesas de cada tipo/deporte/competición — cuando una se cierre desde
        el botón &quot;Cerrar&quot; de abajo, el sistema repone automáticamente hasta llegar a ese mínimo.
      </p>

      <table>
        <thead>
          <tr><th>Código</th><th>Nombre</th><th>Deporte</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody>
          {salas.map((s) => (
            <tr key={s.id}>
              <td>{s.codigo}</td><td>{s.nombre}</td><td>{s.deporte}</td><td>{s.estado}</td>
              <td>
                {s.estado !== 'finalizada' && (
                  <button className="secondary" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} onClick={() => cerrarSala(s)}>
                    Cerrar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 16 }}>Jugadores</h2>
      <form onSubmit={crearJugador} className="card">
        <div className="field">
          <label htmlFor="nombreJugador">Nombre</label>
          <input id="nombreJugador" required value={nombreJugador} onChange={(e) => setNombreJugador(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="deporteJugador">Deporte</label>
          <select id="deporteJugador" value={deporteJugador} onChange={(e) => setDeporteJugador(e.target.value as typeof deporteJugador)} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#131917', color: '#f5f7f5', border: '1px solid #1e2723' }}>
            {DEPORTES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="competicionJugador">Competición / jornada</label>
          <input id="competicionJugador" required value={competicionJugador} onChange={(e) => setCompeticionJugador(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="precioJugador">Precio virtual (€)</label>
          <input id="precioJugador" type="number" min={0} required value={precioJugador} onChange={(e) => setPrecioJugador(Number(e.target.value))} />
        </div>
        <button type="submit" disabled={creandoJugador}>{creandoJugador ? 'Creando...' : 'Añadir jugador'}</button>
      </form>

      <table>
        <thead>
          <tr><th>Nombre</th><th>Deporte</th><th>Precio</th><th>Lesionado</th></tr>
        </thead>
        <tbody>
          {jugadores.map((j) => (
            <tr key={j.id}>
              <td>{j.nombre}</td>
              <td>{j.deporte}</td>
              <td>{j.precio} €</td>
              <td>
                <button className="secondary" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} onClick={() => toggleLesionado(j)}>
                  {j.lesionado ? 'Sí — quitar' : 'No — marcar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
