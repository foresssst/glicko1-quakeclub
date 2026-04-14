/**
 * Score de rendimiento por jugador.
 *
 * Los K/D crudos son un proxy muy ruidoso de qué tan bien le fue
 * a alguien. Este módulo normaliza las estadísticas según el tipo
 * de juego y devuelve un único número comparable entre formatos.
 *
 * Ese número NO es un rating, es un insumo para el sistema de
 * rating (por ejemplo, para calcular el `performanceRank`).
 */

export interface PlayerPerformanceStats {
  gameType: string;
  kills: number;
  deaths: number;
  score: number;
  damageDealt: number;
  damageTaken: number;
  win: boolean;
  aliveTime: number;
  matchDuration: number;
  quit?: boolean;
  timeRed?: number;
  timeBlue?: number;
  roundsRed?: number;
  roundsBlue?: number;
  totalRounds?: number;
  assists?: number;
  captures?: number;
}

export function calculatePerformance(stats: PlayerPerformanceStats): number {
  const gt = stats.gameType.toLowerCase();

  // Normalizamos por cuánto del partido estuvo en juego.
  // Priorizamos la cuenta de rondas (CA / FT / AD), si no hay
  // usamos el tiempo por equipo, y en último caso el tiempo vivo.
  // Tope de 5x para que un cameo corto no se infle.
  let timeFactor = 1.0;

  if (stats.totalRounds && (stats.roundsRed !== undefined || stats.roundsBlue !== undefined)) {
    const rondasJugadas = (stats.roundsRed || 0) + (stats.roundsBlue || 0);
    if (rondasJugadas > 0) {
      timeFactor = Math.min(5.0, stats.totalRounds / rondasJugadas);
    }
  } else if (stats.timeRed !== undefined && stats.timeBlue !== undefined) {
    const tiempoJugado = stats.timeRed + stats.timeBlue;
    if (tiempoJugado > 0 && stats.matchDuration > 0) {
      timeFactor = Math.min(5.0, stats.matchDuration / tiempoJugado);
    }
  } else {
    timeFactor =
      stats.matchDuration > 0 && stats.aliveTime > 0
        ? Math.min(5.0, stats.matchDuration / stats.aliveTime)
        : 1.0;
  }

  const p = {
    k: stats.kills,
    d: stats.deaths || 1,
    score: stats.score,
    dg: stats.damageDealt,
    dt: stats.damageTaken || 1,
    win: stats.win,
  };

  if (gt === 'ctf') {
    // En CTF el score del juego ya incluye capturas, returns y defensas,
    // así que lo usamos directo y lo ponderamos por ratio de daño.
    // Si no hizo nada de daño lo tratamos como AFK.
    let damageRatio = 1.0;
    if (p.dg === 0 && p.dt === 0) damageRatio = 0.5;
    else if (p.dt === 0) damageRatio = Math.min(2, p.dg / 100);
    else damageRatio = Math.min(2, Math.max(0.5, p.dg / p.dt));

    return damageRatio * (p.score + p.dg / 20) * timeFactor;
  }

  if (gt === 'tdm') {
    return ((p.k - p.d) * 5 + ((p.dg - p.dt) / 100) * 4 + (p.dg / 100) * 3) * timeFactor;
  }

  if (gt === 'ca') {
    // Usamos el daño crudo en vez del score interno del juego,
    // que mezcla daño + kills + assists de forma inconsistente.
    return (p.dg / 100 + 0.5 * (p.k - p.d)) * timeFactor * (p.win ? 1.1 : 1.0);
  }

  if (gt === 'duel') {
    if (stats.quit) return -1;
    return p.win ? 1 : 0;
  }

  if (gt === 'ft') {
    const assists = stats.assists || 0;
    return (p.dg / 100 + 0.5 * (p.k - p.d) + 2 * assists) * timeFactor;
  }

  if (gt === 'ad') {
    const captures = stats.captures || 0;
    return (p.dg / 100 + p.k + captures) * timeFactor;
  }

  if (gt === 'dom') {
    return ((p.k - p.d) * 5 + ((p.dg - p.dt) / 100) * 4 + (p.dg / 100) * 3) * timeFactor;
  }

  // FFA y variantes libres.
  return (p.dg / 100 + (p.k - p.d) * 3) * timeFactor;
}

/**
 * Dado el rendimiento de todos los jugadores, decide el resultado
 * para un jugador en particular (1 / 0.5 / 0), que después se usa
 * como input de Glicko.
 *
 * - Juegos por equipos: suma de rendimiento por equipo.
 * - Duel: head-to-head directo.
 * - FFA: interpola según la posición final.
 */
export function determineMatchOutcome(
  playerSteamId: string,
  playerPerformance: number,
  allPerformances: Array<{ steamId: string; performance: number; team?: number }>,
  playerTeam?: number,
  gameType?: string,
): number {
  const gt = gameType?.toLowerCase() || '';

  if (playerTeam !== undefined && playerTeam > 0) {
    const miEquipo = allPerformances.filter((p) => p.team === playerTeam);
    const otrosEquipos = allPerformances.filter(
      (p) => p.team && p.team !== playerTeam && p.team > 0,
    );
    if (otrosEquipos.length === 0) return 0.5;

    const miScore = miEquipo.reduce((s, p) => s + p.performance, 0);
    const otroScore =
      otrosEquipos.reduce((s, p) => s + p.performance, 0) /
      (new Set(otrosEquipos.map((p) => p.team)).size || 1);

    if (miScore > otroScore) return 1.0;
    if (miScore < otroScore) return 0.0;
    return 0.5;
  }

  if (gt === 'duel' && allPerformances.length === 2) {
    const oponente = allPerformances.find((p) => p.steamId !== playerSteamId);
    if (!oponente) return 0.5;
    if (playerPerformance > oponente.performance) return 1.0;
    if (playerPerformance < oponente.performance) return 0.0;
    return 0.5;
  }

  const ordenado = [...allPerformances].sort((a, b) => b.performance - a.performance);
  const posicion = ordenado.findIndex((p) => p.steamId === playerSteamId);
  const total = ordenado.length;

  if (total === 1) return 0.5;
  if (posicion === 0) return 1.0;
  if (posicion === total - 1) return 0.0;
  return (total - posicion - 1) / (total - 1);
}
