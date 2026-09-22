#!/usr/bin/env node
// ============================================================================
// Sincroniza jugadores REALES de fútbol (La Liga, Premier League y Champions
// League) desde el plan GRATUITO de football-data.org hacia la tabla
// `jugadores` de Supabase.
//
// QUÉ HACE: por cada competición, pide el listado de equipos con su plantilla
// (nombre y posición de cada jugador) y los guarda/actualiza en `jugadores`
// con deporte='futbol'. Vuelve a ejecutarse tantas veces como haga falta sin
// duplicar (usa el id de football-data.org como clave de sincronización).
//
// QUÉ NO HACE (limitación conocida del plan gratuito): football-data.org NO
// incluye en el plan gratuito los goles/asistencias/tarjetas de cada partido
// (eso es un añadido de pago, "Deep Data", ~29 €/mes). Así que esto solo trae
// los NOMBRES y EQUIPOS reales de los jugadores — quién marca puntos en cada
// jornada lo sigue introduciendo el admin a mano desde el panel, como ahora,
// hasta que se decida pagar ese añadido.
//
// CÓMO USARLO:
//   1. Consigue una clave gratuita en https://www.football-data.org/client/register
//   2. Copia .env.example a .env y rellena FOOTBALL_DATA_API_KEY,
//      NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (esta última
//      SOLO en tu máquina o en un secreto de servidor — nunca en el
//      navegador, nunca se la des a nadie, ni a mí).
//   3. node scripts/sync-football-data.mjs
//
// Se puede automatizar más adelante (p.ej. una vez al día) con un cron job o
// un GitHub Action — de momento se ejecuta a mano cuando haga falta refrescar
// las plantillas.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!FOOTBALL_DATA_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Faltan variables de entorno. Necesitas FOOTBALL_DATA_API_KEY, NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ver cabecera de este archivo).'
  );
  process.exit(1);
}

// Competiciones cubiertas por el plan gratuito que pidió Iñi.
// (La Segunda División de España NO está en el plan gratuito de
// football-data.org — solo en planes de pago desde 49 €/mes.)
const COMPETICIONES = [
  { codigo: 'PD', nombre: 'La Liga' },
  { codigo: 'PL', nombre: 'Premier League' },
  { codigo: 'CL', nombre: 'Champions League' },
];

// football-data.org usa 'Goalkeeper' / 'Defence' / 'Midfield' / 'Offence' (a
// veces 'Attack'); los pasamos a las etiquetas que ya usa el resto de la app.
const POSICION_MAP = {
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

// El plan gratuito no da valor de mercado, así que se asigna un precio de
// ejemplo por posición — es un punto de partida razonable para el draft, no
// un valor de mercado real; Iñi puede ajustarlo a mano desde el panel admin
// en cualquier momento.
const PRECIO_POR_POSICION = {
  portero: 4000,
  defensa: 5000,
  centrocampista: 6500,
  delantero: 8000,
};

async function fetchEquiposDeCompeticion(codigo) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${codigo}/teams`, {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`football-data.org respondió ${res.status} para ${codigo}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.teams ?? [];
}

function mapEquipoAJugadores(equipo, competicionNombre) {
  const squad = equipo.squad ?? [];
  return squad
    .filter((p) => p.position) // nos quedamos solo con jugadores de campo/portero con posición conocida
    .map((p) => {
      const posicion = POSICION_MAP[p.position] ?? null;
      return {
        nombre: p.name,
        deporte: 'futbol',
        competicion: competicionNombre,
        equipo_real: equipo.name,
        posicion,
        precio: posicion ? PRECIO_POR_POSICION[posicion] : 5000,
        fuente_externa: 'football-data.org',
        fuente_externa_id: String(p.id),
      };
    });
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let totalSincronizados = 0;
  for (const competicion of COMPETICIONES) {
    console.log(`\n→ ${competicion.nombre} (${competicion.codigo})...`);
    const equipos = await fetchEquiposDeCompeticion(competicion.codigo);
    console.log(`  ${equipos.length} equipos encontrados.`);

    const jugadores = equipos.flatMap((equipo) => mapEquipoAJugadores(equipo, competicion.nombre));
    if (jugadores.length === 0) continue;

    const { error, count } = await supabase
      .from('jugadores')
      .upsert(jugadores, { onConflict: 'fuente_externa,fuente_externa_id', count: 'exact' });

    if (error) {
      console.error(`  ✗ Error guardando jugadores de ${competicion.nombre}:`, error.message);
      continue;
    }
    console.log(`  ✓ ${jugadores.length} jugadores sincronizados.`);
    totalSincronizados += jugadores.length;

    // football-data.org limita a 10 peticiones/minuto en el plan gratuito —
    // una pausa entre competiciones evita que la siguiente llamada falle por
    // exceso de ritmo (429 Too Many Requests).
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }

  console.log(`\nHecho. ${totalSincronizados} jugadores sincronizados en total.`);
}

main().catch((err) => {
  console.error('Fallo la sincronización:', err);
  process.exit(1);
});
