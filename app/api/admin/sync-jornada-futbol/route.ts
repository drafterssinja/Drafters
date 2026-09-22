import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { precioFutbolPorPosicion } from '@/lib/pricing';
import { generarSalasParaTorneo } from '@/lib/tiposDeSala';

// Ruta de servidor: usa la clave "service role" (nunca llega al navegador) y
// la clave de football-data.org para automatizar la apertura de una jornada
// real de fútbol de un botón — pedido por Iñi. Solo el administrador puede
// ejecutarla (se comprueba el rol antes de hacer nada).
//
// Qué hace, por cada competición del plan gratuito (La Liga, Premier League,
// Champions League):
//   1. Busca los próximos partidos programados y se queda con los de la
//      jornada más próxima.
//   2. Trae las plantillas reales de los equipos que juegan esa jornada y
//      guarda/actualiza esos jugadores en `jugadores`, con un precio
//      automático por posición (ver lib/pricing.ts — el plan gratuito de la
//      API no da estadísticas para un precio más fino).
//   3. Fija la fecha límite de inscripción al inicio del primer partido de
//      la jornada.
//   4. Si esa jornada no tenía salas todavía, crea 2 de cada variante de
//      sala (Doble o Nada, Triple o Nada, Oro y Plata, Tridente) más 1
//      Maratón (ver lib/tiposDeSala.ts).
export const maxDuration = 60;

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;

const COMPETICIONES = [
  { codigo: 'PD', nombre: 'La Liga' },
  { codigo: 'PL', nombre: 'Premier League' },
  { codigo: 'CL', nombre: 'Champions League' },
];

const POSICION_MAP: Record<string, string> = {
  Goalkeeper: 'portero',
  Defence: 'defensa',
  Defender: 'defensa',
  Midfield: 'centrocampista',
  Midfielder: 'centrocampista',
  Offence: 'delantero',
  Attack: 'delantero',
  Attacker: 'delantero',
  Forward: 'delantero',
};

type ResultadoCompeticion = {
  competicion: string;
  jornada: number | null;
  jugadoresSincronizados: number;
  salasCreadas: number;
  fechaLimite: string | null;
  aviso?: string;
};

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// football-data.org limita a 10 peticiones/minuto en el plan gratuito. Esta
// ruta hace como mucho 2 peticiones por competición (6 en total) — una
// pequeña pausa entre cada una es de sobra para no pasarse del límite.
let ultimaLlamada = 0;
async function llamarFootballData(path: string) {
  const ahora = Date.now();
  const esperaRestante = Math.max(0, ultimaLlamada + 1500 - ahora);
  if (esperaRestante > 0) await esperar(esperaRestante);
  ultimaLlamada = Date.now();

  const res = await fetch(`https://api.football-data.org/v4${path}`, {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY as string },
  });
  if (!res.ok) {
    throw new Error(`football-data.org respondió ${res.status} en ${path}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  if (!FOOTBALL_DATA_API_KEY) {
    return NextResponse.json(
      { error: 'Falta FOOTBALL_DATA_API_KEY en las variables de entorno del servidor (Vercel → Settings → Environment Variables).' },
      { status: 500 }
    );
  }

  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  }

  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', userData.user.id).single();
  if (!perfil || perfil.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede hacer esto.' }, { status: 403 });
  }

  const resultados: ResultadoCompeticion[] = [];

  for (const competicion of COMPETICIONES) {
    try {
      const partidosResp = await llamarFootballData(`/competitions/${competicion.codigo}/matches?status=SCHEDULED`);
      const partidos: any[] = partidosResp.matches ?? [];

      if (partidos.length === 0) {
        resultados.push({
          competicion: competicion.nombre,
          jornada: null,
          jugadoresSincronizados: 0,
          salasCreadas: 0,
          fechaLimite: null,
          aviso: 'No hay partidos programados todavía en football-data.org para esta competición.',
        });
        continue;
      }

      const jornada = partidos[0].matchday as number;
      const partidosDeLaJornada = partidos.filter((p) => p.matchday === jornada);

      const equipoIds = new Set<number>();
      partidosDeLaJornada.forEach((p) => {
        if (p.homeTeam?.id) equipoIds.add(p.homeTeam.id);
        if (p.awayTeam?.id) equipoIds.add(p.awayTeam.id);
      });

      const fechaLimite = partidosDeLaJornada.map((p) => p.utcDate as string).sort()[0] ?? null;

      const equiposResp = await llamarFootballData(`/competitions/${competicion.codigo}/teams`);
      const equipos: any[] = (equiposResp.teams ?? []).filter((eq: any) => equipoIds.has(eq.id));

      const competicionLabel = `${competicion.nombre} - Jornada ${jornada}`;

      const jugadores = equipos.flatMap((equipo: any) =>
        (equipo.squad ?? [])
          .filter((p: any) => p.position)
          .map((p: any) => {
            const posicion = POSICION_MAP[p.position] ?? null;
            return {
              nombre: p.name,
              deporte: 'futbol',
              competicion: competicionLabel,
              equipo_real: equipo.name,
              posicion,
              precio: precioFutbolPorPosicion(posicion),
              fuente_externa: 'football-data.org',
              fuente_externa_id: String(p.id),
            };
          })
      );

      let jugadoresSincronizados = 0;
      if (jugadores.length > 0) {
        const { error: upsertError, count } = await admin
          .from('jugadores')
          .upsert(jugadores, { onConflict: 'fuente_externa,fuente_externa_id', count: 'exact' });
        if (upsertError) throw new Error(upsertError.message);
        jugadoresSincronizados = count ?? jugadores.length;
      }

      // No duplicar salas si esta jornada ya se había abierto antes (p.ej.
      // si el admin pulsa el botón dos veces).
      const { count: salasExistentes } = await admin
        .from('salas')
        .select('id', { count: 'exact', head: true })
        .eq('competicion', competicionLabel);

      let salasCreadas = 0;
      if (!salasExistentes) {
        const nuevasSalas = generarSalasParaTorneo({
          competicionLabel,
          deporte: 'futbol',
          fechaLimiteIso: fechaLimite,
        });
        const { error: salasError } = await admin.from('salas').insert(nuevasSalas);
        if (salasError) throw new Error(salasError.message);
        salasCreadas = nuevasSalas.length;
      }

      resultados.push({
        competicion: competicion.nombre,
        jornada,
        jugadoresSincronizados,
        salasCreadas,
        fechaLimite,
      });
    } catch (err) {
      resultados.push({
        competicion: competicion.nombre,
        jornada: null,
        jugadoresSincronizados: 0,
        salasCreadas: 0,
        fechaLimite: null,
        aviso: `Error: ${(err as Error).message}`,
      });
    }
  }

  return NextResponse.json({ resultados });
}
