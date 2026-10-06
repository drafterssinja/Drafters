import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { normalizarNombre, nombreTorneoCoincide } from '@/lib/nombreMatch';
import { obtenerCampoDataGolf, campoDesdeRespuesta, type DataGolfTour } from '@/lib/dataGolf';

// Comprobación ANTES de que empiece el torneo (06/10, pedido de Iñi: "poder
// ir enlazando jugadores"). Compara el CAMPO que Data Golf publica
// (field-updates, con los mismos nombres que luego usará el en vivo) con los
// jugadores que hay cargados en la porra/mesas de cada competición vigente de
// Data Golf, aplicando también los alias ya guardados. Devuelve los nombres
// de Data Golf que no se emparejan con nadie (para enlazarlos a mano desde
// /admin/resultados-golf, mismo formulario de alias de siempre) y los
// jugadores de la porra que Data Golf no tiene en el campo. NO escribe nada.
export const maxDuration = 60;

async function esAdmin(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData.user) return false;
  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', userData.user.id).single();
  return !!perfil && perfil.rol === 'admin';
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!(await esAdmin(req, admin))) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

  const { data: torneosData, error: torneosError } = await admin
    .from('torneos_golf_live')
    .select('competicion, tour_datagolf')
    .eq('fuente_datos', 'datagolf')
    .eq('activo', true)
    .is('finalizado_en', null);
  if (torneosError) return NextResponse.json({ error: torneosError.message }, { status: 500 });

  const { data: aliasData } = await admin
    .from('alias_nombres_jugador')
    .select('nombre_normalizado_origen, nombre_normalizado_destino')
    .eq('deporte', 'golf');
  const alias = new Map(
    ((aliasData as { nombre_normalizado_origen: string; nombre_normalizado_destino: string }[]) ?? []).map((a) => [a.nombre_normalizado_origen, a.nombre_normalizado_destino])
  );

  const resultados: unknown[] = [];
  for (const t of (torneosData as { competicion: string; tour_datagolf: DataGolfTour | null }[]) ?? []) {
    const base = {
      competicion: t.competicion,
      fuenteDatos: 'datagolf' as const,
      ok: true,
      jugadoresEnCampo: 0,
      jugadoresEmparejados: 0,
      nombresSinEmparejar: [] as string[],
      hoyosActualizados: 0,
      enPorraNoEnCampo: [] as string[],
      totalCampoDG: 0,
    };
    try {
      if (!t.tour_datagolf) throw new Error('Sin tour de Data Golf.');
      const campo = campoDesdeRespuesta(await obtenerCampoDataGolf(t.tour_datagolf));
      if (!nombreTorneoCoincide(t.competicion, campo.eventName)) {
        resultados.push({
          ...base,
          aviso: `El campo que publica ahora Data Golf es el de "${campo.eventName ?? 'sin nombre'}", no el de "${t.competicion}" — no se puede comprobar todavía.`,
        });
        continue;
      }

      const { data: jugData, error: jugError } = await admin
        .from('jugadores')
        .select('nombre')
        .eq('deporte', 'golf')
        .eq('competicion', t.competicion);
      if (jugError) throw new Error(jugError.message);
      const nombresPorra = ((jugData as { nombre: string }[]) ?? []).map((j) => j.nombre);
      const normPorra = new Set(nombresPorra.map(normalizarNombre));

      // Solo profesionales: los aficionados no van en la porra a propósito.
      const campoPros = campo.jugadores.filter((j) => !j.esAficionado);
      const usadosPorra = new Set<string>();
      let emparejados = 0;
      for (const j of campoPros) {
        const n = normalizarNombre(j.nombre);
        const destino = normPorra.has(n) ? n : alias.get(n) && normPorra.has(alias.get(n) as string) ? (alias.get(n) as string) : null;
        if (destino) {
          emparejados++;
          usadosPorra.add(destino);
        } else {
          base.nombresSinEmparejar.push(j.nombre);
        }
      }
      base.totalCampoDG = campoPros.length;
      base.jugadoresEnCampo = nombresPorra.length;
      base.jugadoresEmparejados = emparejados;
      base.enPorraNoEnCampo = nombresPorra.filter((n) => !usadosPorra.has(normalizarNombre(n)));
      resultados.push(base);
    } catch (err) {
      resultados.push({ ...base, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({ resultados });
}
