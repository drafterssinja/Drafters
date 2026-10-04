'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros, closesAtLabel } from '@/lib/salaShared';
import { PorraFormato, PORRA_FORMATO_LABELS, PORRA_FORMATO_COLOR } from '@/lib/porraFormato';

// ============================================================================
// PORRAS CLÁSICAS DE GOLF — pantalla índice (isPorras de Main.dc.html,
// líneas 1393-1414)
// ============================================================================
// Nueva landing (27/09, undécima vuelta): antes esta lista vivía como una
// pestaña dentro de /mesas ("Grandes torneos" → "Porras clásicas"); ahora,
// al dividir /inicio en dos recuadros ("Mesas Drafters" / "Porras clásicas
// de golf"), pasa a ser su propia pantalla de nivel superior, con el mismo
// listado y estilo que ya tenía esa pestaña.

type PorraFila = {
  id: string;
  major: string;
  estado: string;
  precio: number;
  competicion: string | null;
  fecha_limite_inscripcion: string | null;
  formato: PorraFormato;
};

export default function PorrasIndexPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [porras, setPorras] = useState<PorraFila[]>([]);
  const [inscritosPorPorra, setInscritosPorPorra] = useState<Map<string, number>>(new Map());
  const [cargando, setCargando] = useState(true);
  // Finalizadas (04/10, corrección de Iñi): no se ven de primeras al entrar
  // — se quedan plegadas detrás de un desplegable, que empieza cerrado.
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);

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

      const [{ data: perfilData }, { data: porraData }, { data: inscritosPorraData }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
        supabase
          .from('porras')
          .select('id,major,estado,precio,competicion,fecha_limite_inscripcion,formato')
          // CAMBIO 04/10 (pedido de Iñi): antes las porras "finalizada" se
          // ocultaban aquí sin más — ahora se quedan visibles, al final del
          // listado (ver el filtro/orden más abajo), con un botón
          // "Clasificación final" en vez de "Clasificación en directo".
          //
          // La porra de fútbol (formato 'futbol_jornada') todavía no está
          // visible para usuarios normales — se oculta aquí a propósito
          // mientras se termina de probar. Todo el desarrollo sigue
          // intacto, solo no aparece en este listado. (29/09)
          .neq('formato', 'futbol_jornada')
          .order('fecha_limite_inscripcion', { ascending: true }),
        // inscritos_por_porra() es una función de base de datos (RPC): las
        // filas de equipos/inscripciones de otros usuarios no son visibles
        // por RLS, pero el número de inscritos es un dato agregado y
        // público. Ver drafters-schema.sql.
        supabase.rpc('inscritos_por_porra'),
      ]);

      if (!activo) return;

      if (perfilData) setPerfil(perfilData as Perfil);
      setPorras((porraData as PorraFila[]) ?? []);

      const mapaPorra = new Map<string, number>();
      ((inscritosPorraData as { porra_id: string; inscritos: number }[]) ?? []).forEach((fila) => mapaPorra.set(fila.porra_id, Number(fila.inscritos)));
      setInscritosPorPorra(mapaPorra);

      setCargando(false);
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [router]);

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

  // Activas primero (orden de la propia consulta, por fecha límite
  // ascendente) y finalizadas al final, de la más reciente a la más
  // antigua — si no se reordenaran aparte, una finalizada (con fecha límite
  // ya muy en el pasado) se colaría al PRINCIPIO del todo por el `order`
  // ascendente de la consulta.
  const porrasActivas = porras.filter((p) => p.estado !== 'finalizada');
  const porrasFinalizadas = porras
    .filter((p) => p.estado === 'finalizada')
    .sort((a, b) => new Date(b.fecha_limite_inscripcion ?? 0).getTime() - new Date(a.fecha_limite_inscripcion ?? 0).getTime());

  // Tarjeta de una porra (extraída a función para poder usarse tanto en la
  // lista de activas como en la de finalizadas, con el mismo diseño —
  // cambia solo el botón: "Clasificación en directo" mientras la porra
  // sigue en juego, "Clasificación final" en cuanto queda finalizada —
  // pedido de Iñi, 04/10).
  function tarjetaPorra(p: PorraFila) {
    const signedUp = inscritosPorPorra.get(p.id) ?? 0;
    const cierra = closesAtLabel(p.fecha_limite_inscripcion);
    // Empezada (03/10, pedido de Iñi: "en las mesas y en las porras
    // que ya están empezadas... tiene que haber un botón para ir
    // directamente a la clasificación") — mismo criterio que
    // porraEmpezada en app/porras/[id]/page.tsx: la fecha límite ya
    // ha pasado (el estado no cambia solo hasta liquidarla).
    const empezada = !!p.fecha_limite_inscripcion && new Date(p.fecha_limite_inscripcion).getTime() <= Date.now();
    const estadoColor = p.estado === 'disponible' ? '#3DDC84' : p.estado === 'proximamente' ? '#F0B94D' : S.MUTED_3;
    const estadoLabel = p.estado === 'disponible' ? 'Disponible' : p.estado === 'proximamente' ? 'Próximamente' : 'Finalizada';
    // Una porra "finalizada" (estado de BD) ya ha pasado por la
    // liquidación — el torneo seguro que terminó, así que el botón pasa a
    // "Clasificación final" sin más vueltas (no depende de empezada/cierra,
    // que de todas formas ya serían irrelevantes a estas alturas).
    const esFinalizada = p.estado === 'finalizada';
    const mostrarBotonClasificacion = esFinalizada || (!cierra && empezada);
    const textoBotonClasificacion = esFinalizada ? 'Clasificación final' : 'Clasificación en directo';
    return (
      <div
        key={p.id}
        onClick={() => router.push(`/porras/${p.id}`)}
        style={{ background: S.PANEL, border: '1px solid #1E2723', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: S.TEXT }}>{p.major}</span>
          {cierra && (
            <span style={{ flexShrink: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, color: '#FF9F6E', background: 'rgba(255,159,110,0.12)', padding: '4px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
              Cierra el {cierra}
            </span>
          )}
        </div>
        {/* FIX 04/10 (aviso de Iñi, con captura: el botón se salía
            de la pantalla en títulos largos — "Alfred Dunhill
            Links Championship") — antes este botón competía por
            sitio con el título en la misma fila (misma fila con
            `justify-content: space-between` y el botón con
            `white-space: nowrap` + `flex-shrink: 0`, así que no
            podía encogerse y se salía del recuadro). Se mueve a su
            propia fila, igual que ya funcionaba bien en
            app/salas/page.tsx — así nunca compite por ancho con el
            título, sea cual sea su longitud. */}
        {mostrarBotonClasificacion && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/porras/${p.id}/clasificacion`);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              flexShrink: 0,
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 700,
              fontSize: 9.5,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: PORRA_FORMATO_COLOR[p.formato],
              background: `${PORRA_FORMATO_COLOR[p.formato]}1F`,
              border: `1px solid ${PORRA_FORMATO_COLOR[p.formato]}55`,
              borderRadius: 999,
              padding: '3px 8px',
            }}
          >
            {PORRA_FORMATO_LABELS[p.formato]}
          </span>
          <span style={{ fontSize: 12, color: estadoColor, fontWeight: 700 }}>{estadoLabel}</span>
          <span style={{ fontSize: 12, color: S.MUTED_2 }}>{signedUp} equipo{signedUp === 1 ? '' : 's'}</span>
          <span style={{ marginLeft: 'auto', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: '#F0B94D' }}>{formatEuros(p.precio)}</span>
        </div>
      </div>
    );
  }

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={formatEuros(perfil.saldo_simulado)} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '32px 20px 56px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: S.TEXT }}>Porras clásicas de golf</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2 }}>Sin límite de participantes. Elige tu equipo por grupos y compite.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {porras.length === 0 && <p style={{ fontSize: 13, color: S.MUTED_2 }}>No hay ninguna porra clásica disponible ahora mismo.</p>}
            {porrasActivas.map((p) => tarjetaPorra(p))}
            {/* CAMBIO 04/10 (corrección de Iñi): al entrar, las finalizadas
                NO se ven — se quedan detrás de un desplegable que empieza
                cerrado; hay que pulsarlo a propósito para verlas, con el
                botón "Clasificación final" en vez de "Clasificación en
                directo" — ver tarjetaPorra() más arriba. */}
            {porrasFinalizadas.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setMostrarFinalizadas((v) => !v)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    alignSelf: 'flex-start',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: S.MUTED_3,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 10, transform: mostrarFinalizadas ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
                  Finalizadas ({porrasFinalizadas.length})
                </button>
                {mostrarFinalizadas && porrasFinalizadas.map((p) => tarjetaPorra(p))}
              </div>
            )}
          </div>

          <span style={{ fontSize: 11, color: S.FAINT }}>*Sin límite de participantes. Equipos ilimitados por participante.</span>
        </div>
      </div>
    </main>
  );
}
