'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { DEPORTES_V2, DEPORTE_NOMBRE, PelotaDeporte, type DeporteV2 } from '@/components/v2/IconosV2';

// ============================================================================
// ADMIN · LIGAS, TEMPORADAS Y DIVISIONES (Drafters V2, 15/10)
// ============================================================================
// Pedido de Iñi: los administradores crean las ligas de cada deporte, les ponen
// nombre, y cada liga va llevando sus temporadas numeradas (Temporada 1, 2...)
// con fecha de inicio y de fin. Cada temporada tiene sus divisiones (como
// mucho tres: Primera / oro, Segunda / plata, Tercera / bronce, con sus grupos).
// Dos temporadas del mismo deporte no se pueden pisar (lo comprueba la BD).
// La clasificación de la liga en V2 cuenta las mesas dentro de las fechas de
// la temporada en curso.

type Liga = { id: string; deporte: DeporteV2; nombre: string; created_at: string };
type Temporada = { id: string; liga_id: string; numero: number; inicio: string; fin: string };
type Division = { id: string; temporada_id: string; nivel: number; nombre: string; grupos: number };

const NOMBRE_NIVEL: Record<number, string> = { 1: 'Primera', 2: 'Segunda', 3: 'Tercera' };
const COLOR_NIVEL: Record<number, string> = { 1: '#D4A537', 2: '#BCC3CB', 3: '#B9763E' };

function aFecha(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function desdeFecha(fecha: string, finDelDia: boolean): string {
  return new Date(`${fecha}T${finDelDia ? '23:59:59' : '00:00:00'}`).toISOString();
}
function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
function estadoTemporada(t: Temporada): { texto: string; color: string } {
  const ahora = Date.now();
  if (new Date(t.fin).getTime() < ahora) return { texto: 'Terminada', color: S.MUTED_3 };
  if (new Date(t.inicio).getTime() <= ahora) return { texto: 'En curso', color: S.ACCENT };
  return { texto: 'Próxima', color: '#F0B94D' };
}

const caja: React.CSSProperties = { background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 };
const botonPeq = (color: string = S.ACCENT): React.CSSProperties => ({ background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' });

export default function AdminLigasPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [deporte, setDeporte] = useState<DeporteV2>('futbol');
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [temporadas, setTemporadas] = useState<Temporada[]>([]);
  const [divisiones, setDivisiones] = useState<Division[]>([]);
  const [nombreLiga, setNombreLiga] = useState('');
  const [nuevaTemp, setNuevaTemp] = useState<Record<string, { inicio: string; fin: string }>>({});
  const [editando, setEditando] = useState<Record<string, { inicio: string; fin: string }>>({});
  const [renombrando, setRenombrando] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();
      const p = data as Perfil | null;
      if (!p || p.rol !== 'admin') return router.push('/cuenta');
      setPerfil(p);
    })();
  }, [router]);

  const cargar = useCallback(async () => {
    const [{ data: l }, { data: t }, { data: d }] = await Promise.all([
      supabase.from('ligas').select('*').order('created_at'),
      supabase.from('liga_temporadas').select('*').order('numero'),
      supabase.from('liga_divisiones').select('*').order('nivel'),
    ]);
    setLigas((l as Liga[]) ?? []);
    setTemporadas((t as Temporada[]) ?? []);
    setDivisiones((d as Division[]) ?? []);
  }, []);

  useEffect(() => {
    if (perfil) void cargar();
  }, [perfil, cargar]);

  async function hacer(accion: () => PromiseLike<{ error: { message: string } | null }>, mensaje: string) {
    setError(null);
    setOk(null);
    const { error: e } = await accion();
    if (e) {
      setError(e.message.replace(/^ERROR:\s*/i, ''));
      return false;
    }
    setOk(mensaje);
    await cargar();
    return true;
  }

  async function crearLiga() {
    const nombre = nombreLiga.trim();
    if (!nombre) return setError('Ponle un nombre a la liga.');
    if (await hacer(() => supabase.from('ligas').insert({ deporte, nombre }), `Liga "${nombre}" creada.`)) setNombreLiga('');
  }

  async function crearTemporada(liga: Liga) {
    const f = nuevaTemp[liga.id];
    if (!f?.inicio || !f?.fin) return setError('Pon la fecha de inicio y la de fin.');
    if (f.fin < f.inicio) return setError('La fecha de fin tiene que ser posterior a la de inicio.');
    const numero = Math.max(0, ...temporadas.filter((t) => t.liga_id === liga.id).map((t) => t.numero)) + 1;
    const hecho = await hacer(
      () => supabase.from('liga_temporadas').insert({ liga_id: liga.id, numero, inicio: desdeFecha(f.inicio, false), fin: desdeFecha(f.fin, true) }).select('id').single(),
      `Temporada ${numero} creada.`
    );
    if (hecho) setNuevaTemp((x) => ({ ...x, [liga.id]: { inicio: '', fin: '' } }));
  }

  async function guardarFechas(t: Temporada) {
    const f = editando[t.id];
    if (!f) return;
    if (f.fin < f.inicio) return setError('La fecha de fin tiene que ser posterior a la de inicio.');
    if (await hacer(() => supabase.from('liga_temporadas').update({ inicio: desdeFecha(f.inicio, false), fin: desdeFecha(f.fin, true) }).eq('id', t.id), `Fechas de la temporada ${t.numero} guardadas.`))
      setEditando((x) => {
        const y = { ...x };
        delete y[t.id];
        return y;
      });
  }

  async function borrarTemporada(t: Temporada) {
    if (!window.confirm(`¿Borrar la Temporada ${t.numero} y sus divisiones?`)) return;
    await hacer(() => supabase.from('liga_temporadas').delete().eq('id', t.id), `Temporada ${t.numero} borrada.`);
  }

  async function borrarLiga(l: Liga) {
    if (!window.confirm(`¿Borrar la liga "${l.nombre}" con todas sus temporadas?`)) return;
    await hacer(() => supabase.from('ligas').delete().eq('id', l.id), 'Liga borrada.');
  }

  async function renombrarLiga(l: Liga) {
    const nombre = (renombrando[l.id] ?? '').trim();
    if (!nombre) return;
    if (await hacer(() => supabase.from('ligas').update({ nombre }).eq('id', l.id), 'Nombre guardado.'))
      setRenombrando((x) => {
        const y = { ...x };
        delete y[l.id];
        return y;
      });
  }

  async function anadirDivision(t: Temporada) {
    const existentes = divisiones.filter((d) => d.temporada_id === t.id);
    const nivel = existentes.length + 1;
    if (nivel > 3) return setError('Como mucho tres divisiones (nunca Cuarta).');
    await hacer(() => supabase.from('liga_divisiones').insert({ temporada_id: t.id, nivel, nombre: NOMBRE_NIVEL[nivel], grupos: nivel === 1 ? 1 : 2 ** (nivel - 1) }), `${NOMBRE_NIVEL[nivel]} añadida.`);
  }

  async function cambiarDivision(d: Division, cambios: Partial<Division>) {
    await hacer(() => supabase.from('liga_divisiones').update(cambios).eq('id', d.id), 'División guardada.');
  }

  async function quitarDivision(d: Division) {
    const ultima = Math.max(...divisiones.filter((x) => x.temporada_id === d.temporada_id).map((x) => x.nivel));
    if (d.nivel !== ultima) return setError('Quita primero la división más baja.');
    await hacer(() => supabase.from('liga_divisiones').delete().eq('id', d.id), 'División quitada.');
  }

  if (!perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <p style={{ padding: 20, color: S.MUTED }}>Comprobando acceso...</p>
        </div>
      </main>
    );
  }

  const ligasDeporte = ligas.filter((l) => l.deporte === deporte);

  return (
    <main className="v2" style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={`${perfil.saldo_simulado.toFixed(2)} €`} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} volverA="/admin" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 20px 64px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Ligas y temporadas</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Drafters V2: crea la liga de cada deporte, sus temporadas (con inicio y fin) y sus divisiones.</p>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {DEPORTES_V2.map((d) => (
              <button key={d} type="button" onClick={() => setDeporte(d)} style={{ ...S.pill(deporte === d), display: 'flex', alignItems: 'center', gap: 6 }}>
                <PelotaDeporte deporte={d} size={16} /> {DEPORTE_NOMBRE[d]}
              </button>
            ))}
          </div>

          {error && <p style={S.errorText}>{error}</p>}
          {ok && <p style={S.infoText}>{ok}</p>}

          {ligasDeporte.map((liga) => {
            const temps = temporadas.filter((t) => t.liga_id === liga.id).sort((a, b) => b.numero - a.numero);
            const nt = nuevaTemp[liga.id] ?? { inicio: '', fin: '' };
            return (
              <div key={liga.id} style={caja}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PelotaDeporte deporte={deporte} size={22} />
                  {renombrando[liga.id] !== undefined ? (
                    <>
                      <input value={renombrando[liga.id]} onChange={(e) => setRenombrando((x) => ({ ...x, [liga.id]: e.target.value }))} style={{ ...S.input, flex: 1, padding: '8px 10px' }} />
                      <button type="button" onClick={() => renombrarLiga(liga)} style={botonPeq()}>
                        Guardar
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>{liga.nombre}</span>
                      <button type="button" onClick={() => setRenombrando((x) => ({ ...x, [liga.id]: liga.nombre }))} style={botonPeq(S.MUTED)}>
                        Renombrar
                      </button>
                      <button type="button" onClick={() => borrarLiga(liga)} style={botonPeq('#FF5C5C')}>
                        Borrar
                      </button>
                    </>
                  )}
                </div>

                {temps.length === 0 && <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Todavía no tiene temporadas.</span>}
                {temps.map((t) => {
                  const est = estadoTemporada(t);
                  const ed = editando[t.id];
                  const divs = divisiones.filter((d) => d.temporada_id === t.id).sort((a, b) => a.nivel - b.nivel);
                  return (
                    <div key={t.id} style={{ border: `1px solid ${S.BORDER}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT }}>Temporada {t.numero}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: est.color, border: `1px solid ${est.color}`, borderRadius: 999, padding: '2px 8px' }}>{est.texto}</span>
                        <span style={{ flex: 1 }} />
                        {!ed && (
                          <button type="button" onClick={() => setEditando((x) => ({ ...x, [t.id]: { inicio: aFecha(t.inicio), fin: aFecha(t.fin) } }))} style={botonPeq(S.MUTED)}>
                            Cambiar fechas
                          </button>
                        )}
                        <button type="button" onClick={() => borrarTemporada(t)} style={botonPeq('#FF5C5C')}>
                          Borrar
                        </button>
                      </div>
                      {ed ? (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: S.MUTED_2 }}>
                            Empieza
                            <input type="date" value={ed.inicio} onChange={(e) => setEditando((x) => ({ ...x, [t.id]: { ...ed, inicio: e.target.value } }))} style={{ ...S.input, padding: '8px 10px' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: S.MUTED_2 }}>
                            Termina
                            <input type="date" value={ed.fin} onChange={(e) => setEditando((x) => ({ ...x, [t.id]: { ...ed, fin: e.target.value } }))} style={{ ...S.input, padding: '8px 10px' }} />
                          </label>
                          <button type="button" onClick={() => guardarFechas(t)} style={botonPeq()}>
                            Guardar
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 13, color: S.MUTED }}>
                          Del {fechaLarga(t.inicio)} al {fechaLarga(t.fin)}
                        </span>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: S.MUTED_3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Divisiones</span>
                        {divs.length === 0 && <span style={{ fontSize: 12, color: S.MUTED_3 }}>Sin divisiones (hasta 150 jugadores, todos en una liga única).</span>}
                        {divs.map((d) => (
                          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: COLOR_NIVEL[d.nivel] ?? S.MUTED }} />
                            <input defaultValue={d.nombre} onBlur={(e) => e.target.value.trim() && e.target.value !== d.nombre && cambiarDivision(d, { nombre: e.target.value.trim() })} style={{ ...S.input, width: 130, padding: '6px 8px' }} />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.MUTED_2 }}>
                              Grupos
                              <input type="number" min={1} defaultValue={d.grupos} onBlur={(e) => Number(e.target.value) >= 1 && Number(e.target.value) !== d.grupos && cambiarDivision(d, { grupos: Number(e.target.value) })} style={{ ...S.input, width: 64, padding: '6px 8px' }} />
                            </label>
                            <button type="button" onClick={() => quitarDivision(d)} style={botonPeq('#FF5C5C')}>
                              Quitar
                            </button>
                          </div>
                        ))}
                        {divs.length < 3 && (
                          <button type="button" onClick={() => anadirDivision(t)} style={{ ...botonPeq(), alignSelf: 'flex-start' }}>
                            + Añadir {NOMBRE_NIVEL[divs.length + 1]}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${S.CARD_BORDER}`, paddingTop: 12 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: S.TEXT }}>Nueva temporada (Temporada {Math.max(0, ...temporadas.filter((t) => t.liga_id === liga.id).map((t) => t.numero)) + 1})</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: S.MUTED_2 }}>
                      Empieza
                      <input type="date" value={nt.inicio} onChange={(e) => setNuevaTemp((x) => ({ ...x, [liga.id]: { ...nt, inicio: e.target.value } }))} style={{ ...S.input, padding: '8px 10px' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: S.MUTED_2 }}>
                      Termina
                      <input type="date" value={nt.fin} onChange={(e) => setNuevaTemp((x) => ({ ...x, [liga.id]: { ...nt, fin: e.target.value } }))} style={{ ...S.input, padding: '8px 10px' }} />
                    </label>
                    <button type="button" onClick={() => crearTemporada(liga)} style={{ ...botonPeq(), background: S.ACCENT, color: '#04140B' }}>
                      Crear temporada
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div style={caja}>
            <span style={{ fontSize: 13, fontWeight: 700, color: S.TEXT }}>Nueva liga de {DEPORTE_NOMBRE[deporte].toLowerCase()}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={nombreLiga} onChange={(e) => setNombreLiga(e.target.value)} placeholder={`Ej. Liga Drafters de ${DEPORTE_NOMBRE[deporte]}`} style={{ ...S.input, flex: 1 }} />
              <button type="button" onClick={crearLiga} style={{ ...botonPeq(), background: S.ACCENT, color: '#04140B' }}>
                Crear liga
              </button>
            </div>
          </div>

          <Link href="/admin" style={{ fontSize: 12.5, color: S.MUTED_2 }}>
            ← Panel de administración
          </Link>
        </div>
      </div>
    </main>
  );
}
