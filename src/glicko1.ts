// Glicko-1 tal cual el paper de Glickman del 99.
// La gracia sobre ELO clásico es el RD: además del rating guardamos
// cuánta incertidumbre tenemos sobre ese rating. Un jugador nuevo
// arranca con RD alto y su rating se mueve mucho; uno activo tiene
// RD bajo y cuesta más moverle la aguja.

const q = Math.log(10) / 400;

// Defaults para una comunidad chica. Si tienes miles de jugadores
// activos conviene reducir el RD inicial, si no los nuevos se mueven demasiado.
const RATING_INICIAL = 900;
const RD_INICIAL = 350;
const RD_MINIMO = 30;
const RATING_MINIMO = 100;
const MAX_CAMBIO_POR_PARTIDA = 150;

// C define el decay del RD. Con estos números, un jugador sin jugar
// 720 días vuelve a RD 350 (máxima incertidumbre).
const C = Math.sqrt((RD_INICIAL ** 2 - RD_MINIMO ** 2) / 720);

export interface Glicko1Rating {
  rating: number;
  rd: number;
  period: number;
  games: number;
}

export interface Glicko1Opponent {
  rating: number;
  rd: number;
}

export interface Glicko1Match {
  opponent: Glicko1Opponent;
  outcome: number; // 1 = victoria, 0.5 = empate, 0 = derrota
}

export function createGlicko1Player(
  rating?: number,
  rd?: number,
  period?: number,
): Glicko1Rating {
  return {
    rating: rating ?? RATING_INICIAL,
    rd: rd ?? RD_INICIAL,
    period: period ?? 0,
    games: 0,
  };
}

// Función g del paper. Castiga el peso del partido si no sabemos
// bien cuánto vale el oponente (RD alto -> g tiende a cero).
function g(rd: number): number {
  return 1 / Math.sqrt(1 + 3 * Math.pow((q * rd) / Math.PI, 2));
}

// Probabilidad de que el jugador le gane al oponente.
function resultadoEsperado(
  ratingJugador: number,
  ratingOponente: number,
  rdOponente: number,
): number {
  return 1 / (1 + Math.pow(10, (-g(rdOponente) * (ratingJugador - ratingOponente)) / 400));
}

function varianzaSobreOponentes(
  ratingJugador: number,
  oponentes: Array<{ rating: number; rd: number }>,
): number {
  if (oponentes.length === 0) return Infinity;

  let suma = 0;
  for (const op of oponentes) {
    const gVal = g(op.rd);
    const e = resultadoEsperado(ratingJugador, op.rating, op.rd);
    suma += gVal * gVal * e * (1 - e);
  }

  if (suma <= 0 || !isFinite(suma)) return Infinity;
  return 1 / (q * q * suma);
}

// Sube el RD cuando el jugador no juega por un rato.
// `periodosInactivo` está en días (o la unidad que se use para C).
export function applyRdDecay(rd: number, periodosInactivo: number): number {
  if (periodosInactivo <= 0) return rd;
  const nuevoRd = Math.sqrt(rd * rd + C * C * periodosInactivo);
  return Math.min(nuevoRd, RD_INICIAL);
}

function acotarRatingYRd(rating: number, rd: number): { rating: number; rd: number } {
  return {
    rating: Math.max(RATING_MINIMO, rating),
    rd: Math.min(RD_INICIAL, Math.max(RD_MINIMO, rd)),
  };
}

// Actualiza el rating después de una tanda de partidos.
// Todos los matches tienen que ser del mismo período de rating.
export function updateGlicko1Rating(
  player: Glicko1Rating,
  matches: Glicko1Match[],
  currentPeriod: number,
): Glicko1Rating {
  // Si no jugó este período, solo aplicamos decay del RD.
  if (matches.length === 0) {
    const inactivo = Math.max(0, currentPeriod - player.period);
    return {
      ...player,
      rd: applyRdDecay(player.rd, inactivo),
      period: currentPeriod,
    };
  }

  let rd = player.rd;
  if (player.period > 0 && currentPeriod > player.period) {
    rd = applyRdDecay(rd, currentPeriod - player.period);
  }

  const rating = player.rating;
  const oponentes = matches.map((m) => m.opponent);

  const d2 = varianzaSobreOponentes(rating, oponentes);

  let suma = 0;
  for (const m of matches) {
    const gVal = g(m.opponent.rd);
    const e = resultadoEsperado(rating, m.opponent.rating, m.opponent.rd);
    suma += gVal * (m.outcome - e);
  }

  const b = 1 / (1 / (rd * rd) + 1 / d2);

  // Tope al cambio por partida para evitar saltos gigantes.
  let diff = q * b * suma;
  if (diff < 0) diff = Math.max(-MAX_CAMBIO_POR_PARTIDA, diff);
  else diff = Math.min(MAX_CAMBIO_POR_PARTIDA, diff);

  const acotado = acotarRatingYRd(rating + diff, Math.sqrt(b));

  return {
    rating: acotado.rating,
    rd: acotado.rd,
    period: currentPeriod,
    games: player.games + matches.length,
  };
}

// Chance de que el jugador le gane al oponente.
// Útil para mostrar odds o armar matchmaking.
export function winProbability(
  ratingJugador: number,
  _rdJugador: number,
  ratingOponente: number,
  rdOponente: number,
): number {
  return resultadoEsperado(ratingJugador, ratingOponente, rdOponente);
}

// Período de rating = días enteros desde epoch. Se puede pasar un
// Date propio para tests, por defecto toma el momento actual.
export function getRatingPeriod(date: Date = new Date()): number {
  return Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
}

// Cuánto cambiaría el rating en un partido hipotético.
// Sirve para mostrar "+12 si ganas" antes del match.
export function estimateRatingChange(
  ratingJugador: number,
  rdJugador: number,
  ratingOponente: number,
  rdOponente: number,
  outcome: number,
): number {
  const gVal = g(rdOponente);
  const e = resultadoEsperado(ratingJugador, ratingOponente, rdOponente);
  const d2 = 1 / (q * q * gVal * gVal * e * (1 - e));
  const b = 1 / (1 / (rdJugador * rdJugador) + 1 / d2);
  return q * b * gVal * (outcome - e);
}

export const Glicko1Constants = {
  q,
  RD_MINIMO,
  RATING_MINIMO,
  RATING_INICIAL,
  RD_INICIAL,
  MAX_CAMBIO_POR_PARTIDA,
  C,
};
