// ============================================================================
// TIPOS DE SALA — configuración para la creación automática (2 por tipo)
// ============================================================================
// ⚠️ PROVISIONAL: Iñi va a pasar el listado definitivo de tipos de sala con
// sus nombres y condiciones exactas. Hasta entonces se usan los 4 tipos que
// ya existen en el esquema (duelo/trio/doble_o_nada/triple_o_nada) con un
// aforo y un buy-in de ejemplo — en cuanto llegue el listado real, este es
// el único sitio que hay que tocar para que se propague a toda la app (la
// automatización de fútbol y el importador de golf/tenis leen de aquí).
// ============================================================================

export type TipoSalaConfig = {
  tipo: 'duelo' | 'trio' | 'doble_o_nada' | 'triple_o_nada';
  label: string;
  aforo: number;
  buyIn: number;
};

export const TIPOS_DE_SALA: TipoSalaConfig[] = [
  { tipo: 'duelo', label: 'Duelo', aforo: 2, buyIn: 10 },
  { tipo: 'trio', label: 'Trío', aforo: 3, buyIn: 15 },
  { tipo: 'doble_o_nada', label: 'Doble o Nada', aforo: 4, buyIn: 25 },
  { tipo: 'triple_o_nada', label: 'Triple o Nada', aforo: 6, buyIn: 50 },
];

// Cuántas salas de cada tipo se crean automáticamente al abrir un
// torneo/jornada nuevo (mismo mínimo que ya mantiene el disparador de
// reposición automática en la base de datos).
export const SALAS_POR_TIPO_AL_CREAR = 2;
