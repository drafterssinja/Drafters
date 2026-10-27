'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// Diagnóstico de Live Tennis API (13/10). Botones con las llamadas útiles y la
// respuesta cruda debajo, para copiarla y pasársela a Claude.
const ATAJOS: { etiqueta: string; ruta: string }[] = [
  { etiqueta: 'Consumo / plan', ruta: '/usage' },
  { etiqueta: 'Partidos en juego', ruta: '/matches?status=live' },
  { etiqueta: 'Partidos (lista)', ruta: '/matches' },
  { etiqueta: 'Torneos', ruta: '/tournaments' },
  { etiqueta: 'Próximos partidos', ruta: '/fixtures' },
];

type TorneoSemana = { liga: 'atp' | 'wta'; id: string; nombre: string; inicio: string | null; fin: string | null; jugadores: number; vivos: number; pre: number; en_juego: number; terminados: number; competicion: string | null };
type Creado = { competicion: string; liga: string; desde: string | null; finalizado_en: string | null };

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : '—');

// 27/10: dar de alta los torneos de la semana (ESPN, gratis).
function TorneosTenis() {
  const [torneos, setTorneos] = useState<TorneoSemana[] | null>(null);
  const [creados, setCreados] = useState<Creado[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function llamar(cuerpo: Record<string, string>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sin sesión');
    const res = await fetch('/api/admin/tenis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Error');
    return json;
  }
  async function cargar() {
    setOcupado('listar');
    try {
      const r = await llamar({ accion: 'listar' });
      setTorneos(r.torneos);
      setCreados(r.creados);
    } catch (e) {
      setMensaje((e as Error).message);
      setTorneos([]);
    }
    setOcupado(null);
  }
  useEffect(() => {
    void cargar();
  }, []);

  async function accion(clave: string, cuerpo: Record<string, string>, ok: (r: any) => string) {
    setOcupado(clave);
    setMensaje(null);
    try {
      const r = await llamar(cuerpo);
      setMensaje(ok(r));
      await cargar();
    } catch (e) {
      setMensaje(`❌ ${(e as Error).message}`);
    }
    setOcupado(null);
  }

  const boton = { ...S.secondaryLinkButton, width: 'auto', padding: '7px 11px', fontSize: 12 } as const;
  return (
    <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <span style={{ fontWeight: 800, color: S.TEXT }}>Torneos de los próximos 6 días y en juego (ESPN)</span>
      <span style={{ fontSize: 12, color: S.ACCENT, lineHeight: 1.5 }}>
        Automático: cada 15 minutos se crean solos los torneos ATP (de momento, sin WTA) que empiezan en los próximos 6 días (aunque todavía no haya cuadro: los jugadores y sus precios llegan solos en cuanto sale y se avisa a los de las salas), con el precio de cada jugador sacado de su cuota a ganar el torneo (la de las casas de apuestas si la hay; si no, calculada jugando el cuadro 20.000 veces con el ranking).
      </span>
      <button type="button" disabled={!!ocupado} onClick={() => accion('auto', { accion: 'auto' }, (r) => (r.resultados as { liga: string; torneo: string; estado: string; detalle: string }[]).map((x) => `${x.liga.toUpperCase()} · ${x.torneo}: ${x.detalle}`).join('  |  ') || 'Nada que crear.')} style={{ ...boton, alignSelf: 'flex-start' }}>
        {ocupado === 'auto' ? 'Buscando…' : 'Buscar y crear ahora'}
      </button>
      <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.5 }}>
        Al crear un torneo se cargan sus jugadores con precio (por ranking), se cierra 5 minutos antes del próximo partido y salen las salas de Drafters. El marcador, el saque, los breaks y los puntos se actualizan solos cada minuto. Cuando ESPN da la final por acabada, el torneo se cierra solo.
      </span>
      {mensaje && <span style={{ fontSize: 12.5, color: mensaje.startsWith('❌') ? '#FF8A8A' : S.ACCENT }}>{mensaje}</span>}
      {torneos === null ? (
        <span style={{ fontSize: 12, color: S.MUTED_3 }}>Cargando…</span>
      ) : torneos.length === 0 ? (
        <span style={{ fontSize: 12, color: S.MUTED_3 }}>ESPN no devuelve torneos ahora mismo.</span>
      ) : (
        torneos.map((t) => (
          <div key={`${t.liga}-${t.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}` }}>
            <span style={{ fontWeight: 700, color: S.TEXT, fontSize: 13.5 }}>
              {t.liga.toUpperCase()} · {t.nombre}
            </span>
            <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
              {fecha(t.inicio)} → {fecha(t.fin)} · {t.jugadores} jugadores ({t.vivos} siguen vivos) · {t.pre} por jugar · {t.en_juego} en juego · {t.terminados} terminados
            </span>
            {t.competicion ? (
              <span style={{ fontSize: 12, color: S.ACCENT, fontWeight: 700 }}>✓ Creado: {t.competicion}</span>
            ) : (
              <button type="button" disabled={!!ocupado || (t.jugadores > 0 && t.pre === 0)} onClick={() => accion(`crear-${t.id}`, { accion: 'crear', liga: t.liga, id: t.id }, (r) => `✓ ${r.competicion}: ${r.jugadores} jugadores, cierra ${fecha(r.cierre)}.`)} style={{ ...boton, alignSelf: 'flex-start', opacity: t.jugadores > 0 && t.pre === 0 ? 0.5 : 1 }}>
                {ocupado === `crear-${t.id}` ? 'Creando…' : t.jugadores > 0 && t.pre === 0 ? 'No quedan partidos por empezar' : t.jugadores === 0 ? 'Crear ya (sin cuadro todavía)' : 'Crear torneo en Drafters'}
              </button>
            )}
          </div>
        ))
      )}
      {creados.length > 0 && (
        <>
          <span style={{ fontWeight: 800, color: S.TEXT, fontSize: 13, marginTop: 4 }}>Torneos creados</span>
          {creados.map((c) => (
            <div key={c.competicion} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12, color: S.MUTED_2 }}>
              <span style={{ flex: '1 1 180px', color: S.TEXT }}>
                {c.competicion} · {c.finalizado_en ? `terminado ${fecha(c.finalizado_en)}` : `cierre ${fecha(c.desde)}`}
              </span>
              {!c.finalizado_en && (
                <button type="button" disabled={!!ocupado} onClick={() => accion(`sync-${c.competicion}`, { accion: 'sincronizar', competicion: c.competicion }, (r) => `✓ Actualizado: ${r.partidos} partidos, ${r.jugadores} jugadores.`)} style={boton}>
                  {ocupado === `sync-${c.competicion}` ? '…' : 'Actualizar ahora'}
                </button>
              )}
              <button type="button" disabled={!!ocupado} onClick={() => accion(`fin-${c.competicion}`, { accion: c.finalizado_en ? 'reabrir' : 'finalizar', competicion: c.competicion }, () => (c.finalizado_en ? '✓ Reabierto.' : '✓ Dado por terminado.'))} style={boton}>
                {c.finalizado_en ? 'Reabrir' : 'Dar por terminado'}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function AdminTenisPage() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [ruta, setRuta] = useState('/usage');
  const [salida, setSalida] = useState<string>('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data } = await supabase.from('perfiles').select('rol').eq('id', session.user.id).single();
      if (!data || data.rol !== 'admin') return router.push('/cuenta');
      setAutorizado(true);
    })();
  }, [router]);

  async function probar(r: string, extra: Record<string, string> = {}) {
    if (!extra.fuente) setRuta(r);
    setCargando(true);
    setSalida('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/probar-tenis', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta: r, ...extra }),
      });
      setSalida(JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      setSalida(String(e));
    }
    setCargando(false);
  }

  if (!autorizado) return null;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver />
        <div style={{ ...S.accountSection, gap: 12 }}>
          <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>← Panel de administración</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Tenis</h1>
          <TorneosTenis />
          <span style={{ fontWeight: 800, color: S.TEXT, marginTop: 6 }}>Probar fuentes</span>
          {/* 26/10 (Iñi): ESPN, gratis. El análisis busca un partido en juego (o acabado) y mira qué trae: quién saca, juegos por set, aces, dobles faltas, breaks. */}
          <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span style={{ fontWeight: 800, color: S.TEXT }}>ESPN (gratis)</span>
            <span style={{ fontSize: 12, color: S.MUTED_2 }}>Pulsa &quot;Analizar ATP&quot; mejor cuando haya partidos en juego y pásale la respuesta a Claude.</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button type="button" onClick={() => probar('', { fuente: 'espn-auto', liga: 'atp' })} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                Analizar ATP
              </button>
              <button type="button" onClick={() => probar('', { fuente: 'ranking', liga: 'atp' })} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                Ranking ATP
              </button>
              <button type="button" onClick={() => probar('', { fuente: 'oddsapi' })} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                The Odds API (créditos)
              </button>
              <button type="button" onClick={() => probar('', { fuente: 'sofascore' })} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                Probar Sofascore (aces)
              </button>
              <button type="button" onClick={() => probar('', { fuente: 'cuotas-futbol', liga: 'esp.1' })} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                Cuotas LaLiga (ESPN)
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
                  probar(`/atp/scoreboard?dates=${f(new Date())}-${f(new Date(Date.now() + 10 * 86400000))}`, { fuente: 'espn' });
                }}
                style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}
              >
                Próximos ATP (crudo)
              </button>
              <button type="button" onClick={() => probar('/atp/scoreboard', { fuente: 'espn' })} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                Marcador ATP (crudo)
              </button>
            </div>
          </div>
          <span style={{ fontWeight: 800, color: S.TEXT }}>Live Tennis API</span>
          <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0 }}>
            Pulsa un botón y copia la respuesta. Para ver un partido concreto, escribe su ruta (p. ej. /matches/ID/score, /matches/ID/events, /matches/ID/statistics).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ATAJOS.map((a) => (
              <button key={a.ruta} type="button" onClick={() => probar(a.ruta)} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                {a.etiqueta}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={ruta} onChange={(e) => setRuta(e.target.value)} style={{ ...S.input, flex: 1 }} />
            <button type="button" onClick={() => probar(ruta)} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 14px' }}>
              {cargando ? '…' : 'Probar'}
            </button>
          </div>
          <textarea readOnly value={salida} style={{ ...S.input, minHeight: 380, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
      </div>
    </main>
  );
}
