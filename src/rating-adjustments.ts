// Ajustes extra sobre el cambio de rating crudo de Glicko-1.
//
// Glicko puro es matemáticamente correcto pero en una comunidad
// chica puede sentirse injusto: un top pierde un montón por caer
// contra un amigo, un underdog no siente progreso cuando gana contra
// un favorito, las rachas de derrotas terminan hundiendo ratings.
//
// Este módulo expone un set de reglas que modifican el delta final.
// Cada una es pura, configurable y se puede activar/desactivar desde
// ADJUSTMENTS_CONFIG. Se ejecutan en orden y devuelven el cambio
// ajustado junto con el detalle de qué reglas se aplicaron y por qué.

export interface RatingContext {
  playerRating: number;
  opponentRating: number;
  playerGames: number;
  opponentGames: number;
  isWin: boolean;
  marginOfVictory?: number;
  maxScore?: number;
  consecutiveLosses?: number;
  consecutiveWins?: number;
  teamWon?: boolean;
  gameType?: string;
  performanceRank?: number; // 0.0 = peor del server, 1.0 = mejor del server
  hasQuit?: boolean;
}

export interface RatingAdjustment {
  originalChange: number;
  adjustedChange: number;
  adjustments: Array<{
    type: string;
    factor: number;
    reason: string;
  }>;
}

export const ADJUSTMENTS_CONFIG = {
  lossForgiveness: {
    enabled: true,
    thresholds: [
      { ratingDiff: 200, maxLoss: 18 },
      { ratingDiff: 300, maxLoss: 12 },
      { ratingDiff: 400, maxLoss: 8 },
      { ratingDiff: 500, maxLoss: 5 },
    ],
  },

  upsetBonus: {
    enabled: true,
    thresholds: [
      { ratingDiff: 100, bonus: 1.15 },
      { ratingDiff: 200, bonus: 1.25 },
      { ratingDiff: 300, bonus: 1.35 },
      { ratingDiff: 400, bonus: 1.5 },
    ],
  },

  antiFarming: {
    enabled: true,
    thresholds: [
      { ratingDiff: 300, reduction: 0.8 },
      { ratingDiff: 400, reduction: 0.65 },
      { ratingDiff: 500, reduction: 0.5 },
    ],
  },

  // Partidos más peleados mueven menos el rating.
  marginOfVictory: {
    enabled: true,
    minFactor: 0.6,
  },

  // Desactivado por defecto: Glicko ya maneja la incertidumbre de
  // los jugadores nuevos a través del RD. Tenerlo prendido causaba
  // inflación de ratings en mis pruebas.
  experienceScaling: {
    enabled: false,
    tiers: [
      { games: 10, factor: 1.0 },
      { games: 25, factor: 1.0 },
      { games: 50, factor: 1.0 },
      { games: 100, factor: 1.0 },
      { games: 200, factor: 1.0 },
      { games: 400, factor: 1.0 },
    ],
  },

  streakProtection: {
    enabled: true,
    lossReduction: [
      { streak: 4, factor: 0.9 },
      { streak: 6, factor: 0.8 },
      { streak: 8, factor: 0.7 },
    ],
    winBonus: [
      { streak: 4, factor: 1.1 },
      { streak: 6, factor: 1.15 },
    ],
  },

  // En juegos por equipos el resultado del equipo siempre tiene que
  // pesar: si ganaste, ganás ELO; si perdiste, perdés. El cuánto
  // depende del rendimiento individual.
  teamResultModifier: {
    enabled: true,
    winnerMinElo: 1,
    winnerMaxFactor: 1.5,
    loserMinElo: -1,
    loserMaxFactor: 1.5,
    // El "MVP de la derrota" (top ~22%) queda protegido con 0 ELO.
    exceptionalPerformanceThreshold: 0.78,
    exceptionalPerformanceBonus: 5,
    applicableGameTypes: ['ca', 'ctf', 'tdm', 'ft', 'ad', 'dom'],
  },

  quitPenalty: {
    enabled: true,
    penaltyFactor: 2.0,
    minPenalty: 30,
  },
};

// Piso absoluto de rating: nunca baja de aquí.
const PISO_RATING = 300;

export function applyLossForgiveness(
  ratingChange: number,
  ratingDiff: number,
  isWin: boolean,
): { change: number; applied: boolean; maxLoss?: number } {
  if (!ADJUSTMENTS_CONFIG.lossForgiveness.enabled) {
    return { change: ratingChange, applied: false };
  }
  // Solo aplica a derrotas del favorito.
  if (isWin || ratingDiff <= 0 || ratingChange >= 0) {
    return { change: ratingChange, applied: false };
  }

  const thresholds = ADJUSTMENTS_CONFIG.lossForgiveness.thresholds;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (ratingDiff >= thresholds[i].ratingDiff) {
      const maxLoss = -thresholds[i].maxLoss;
      if (ratingChange < maxLoss) {
        return { change: maxLoss, applied: true, maxLoss: thresholds[i].maxLoss };
      }
      break;
    }
  }
  return { change: ratingChange, applied: false };
}

export function applyUpsetBonus(
  ratingChange: number,
  ratingDiff: number,
  isWin: boolean,
): { change: number; applied: boolean; bonus?: number } {
  if (!ADJUSTMENTS_CONFIG.upsetBonus.enabled) {
    return { change: ratingChange, applied: false };
  }
  // Solo aplica a victorias del underdog.
  if (!isWin || ratingDiff >= 0 || ratingChange <= 0) {
    return { change: ratingChange, applied: false };
  }

  const diff = Math.abs(ratingDiff);
  const thresholds = ADJUSTMENTS_CONFIG.upsetBonus.thresholds;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (diff >= thresholds[i].ratingDiff) {
      return {
        change: ratingChange * thresholds[i].bonus,
        applied: true,
        bonus: thresholds[i].bonus,
      };
    }
  }
  return { change: ratingChange, applied: false };
}

export function applyAntiFarming(
  ratingChange: number,
  ratingDiff: number,
  isWin: boolean,
): { change: number; applied: boolean; reduction?: number } {
  if (!ADJUSTMENTS_CONFIG.antiFarming.enabled) {
    return { change: ratingChange, applied: false };
  }
  // Solo aplica a victorias del favorito.
  if (!isWin || ratingDiff <= 0 || ratingChange <= 0) {
    return { change: ratingChange, applied: false };
  }

  const thresholds = ADJUSTMENTS_CONFIG.antiFarming.thresholds;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (ratingDiff >= thresholds[i].ratingDiff) {
      return {
        change: ratingChange * thresholds[i].reduction,
        applied: true,
        reduction: thresholds[i].reduction,
      };
    }
  }
  return { change: ratingChange, applied: false };
}

export function applyMarginOfVictory(
  ratingChange: number,
  margin: number | undefined,
  maxMargin: number | undefined,
): { change: number; applied: boolean; factor?: number } {
  if (!ADJUSTMENTS_CONFIG.marginOfVictory.enabled) {
    return { change: ratingChange, applied: false };
  }
  if (margin === undefined || maxMargin === undefined || maxMargin <= 0) {
    return { change: ratingChange, applied: false };
  }

  const { minFactor } = ADJUSTMENTS_CONFIG.marginOfVictory;
  const normalizado = Math.min(margin, maxMargin) / maxMargin;
  const factor = minFactor + (1 - minFactor) * normalizado;
  return { change: ratingChange * factor, applied: true, factor };
}

export function applyExperienceScaling(
  ratingChange: number,
  playerGames: number,
): { change: number; applied: boolean; factor?: number } {
  if (!ADJUSTMENTS_CONFIG.experienceScaling.enabled) {
    return { change: ratingChange, applied: false };
  }

  const tiers = ADJUSTMENTS_CONFIG.experienceScaling.tiers;
  for (const tier of tiers) {
    if (playerGames < tier.games) {
      return { change: ratingChange * tier.factor, applied: true, factor: tier.factor };
    }
  }
  const ultimo = tiers[tiers.length - 1];
  return { change: ratingChange * ultimo.factor, applied: true, factor: ultimo.factor };
}

export function applyStreakProtection(
  ratingChange: number,
  consecutiveLosses: number | undefined,
  consecutiveWins: number | undefined,
  isWin: boolean,
): { change: number; applied: boolean; factor?: number } {
  if (!ADJUSTMENTS_CONFIG.streakProtection.enabled) {
    return { change: ratingChange, applied: false };
  }

  // Protección contra tilt: amortigua pérdidas en racha negativa.
  if (!isWin && consecutiveLosses && consecutiveLosses > 0) {
    const reducciones = ADJUSTMENTS_CONFIG.streakProtection.lossReduction;
    for (let i = reducciones.length - 1; i >= 0; i--) {
      if (consecutiveLosses >= reducciones[i].streak) {
        return {
          change: ratingChange * reducciones[i].factor,
          applied: true,
          factor: reducciones[i].factor,
        };
      }
    }
  }

  // Bonus por racha ganadora.
  if (isWin && consecutiveWins && consecutiveWins > 0) {
    const bonus = ADJUSTMENTS_CONFIG.streakProtection.winBonus;
    for (let i = bonus.length - 1; i >= 0; i--) {
      if (consecutiveWins >= bonus[i].streak) {
        return {
          change: ratingChange * bonus[i].factor,
          applied: true,
          factor: bonus[i].factor,
        };
      }
    }
  }

  return { change: ratingChange, applied: false };
}

// En juegos por equipos el resultado final siempre tiene que importar:
// si tu equipo ganó, ganas ELO (mínimo +1); si perdió, pierdes ELO.
// El tamaño del cambio se escala según qué tan bien te fue a ti.
//
// Caso especial: si tu equipo perdió pero rendiste en el top
// (sobre `exceptionalPerformanceThreshold`), tu ELO queda protegido.
export function applyTeamResultModifier(
  ratingChange: number,
  teamWon: boolean | undefined,
  gameType: string | undefined,
  performanceRank: number | undefined,
): { change: number; applied: boolean; reason?: string } {
  const cfg = ADJUSTMENTS_CONFIG.teamResultModifier;
  if (!cfg.enabled) return { change: ratingChange, applied: false };
  if (!gameType || !cfg.applicableGameTypes.includes(gameType.toLowerCase())) {
    return { change: ratingChange, applied: false };
  }
  if (teamWon === undefined) return { change: ratingChange, applied: false };

  const rank = performanceRank ?? 0.5;

  if (teamWon) {
    if (ratingChange <= 0) {
      const gananciaMin = rank < 0.1 ? 0 : cfg.winnerMinElo;
      const base = Math.abs(ratingChange) * 0.5;
      const escalada = Math.max(gananciaMin, base * (0.5 + rank * 0.5));

      if (escalada === 0) {
        return {
          change: 0,
          applied: true,
          reason: `Tu equipo ganó pero tu rendimiento fue muy bajo (${(rank * 100).toFixed(0)}%), no sumaste ELO`,
        };
      }
      return {
        change: Math.ceil(escalada),
        applied: true,
        reason: `Tu equipo ganó y tu rendimiento fue de ${(rank * 100).toFixed(0)}%, sumaste +${Math.ceil(escalada)}`,
      };
    }

    const factor = 0.7 + rank * (cfg.winnerMaxFactor - 0.7);
    const nuevo = ratingChange * factor;
    if (Math.abs(nuevo - ratingChange) < 1) return { change: ratingChange, applied: false };

    return {
      change: Math.round(nuevo),
      applied: true,
      reason: `Tu equipo ganó y tu rendimiento fue de ${(rank * 100).toFixed(0)}%, te quedó un x${factor.toFixed(2)}`,
    };
  }

  // Tu equipo perdió.
  if (rank >= cfg.exceptionalPerformanceThreshold) {
    return {
      change: 0,
      applied: true,
      reason: `Tu equipo perdió pero fuiste el mejor jugador (${(rank * 100).toFixed(0)}%), tu ELO quedó protegido`,
    };
  }

  if (ratingChange >= 0) {
    const base = Math.abs(ratingChange) * 0.5;
    const perdida = Math.max(Math.abs(cfg.loserMinElo), base * (0.5 + (1 - rank) * 0.5));
    return {
      change: -Math.ceil(perdida),
      applied: true,
      reason: `Tu equipo perdió, te bajó -${Math.ceil(perdida)} ELO (rendimiento: ${(rank * 100).toFixed(0)}%)`,
    };
  }

  const factor = 0.7 + (1 - rank) * (cfg.loserMaxFactor - 0.7);
  const nuevo = ratingChange * factor;
  if (Math.abs(nuevo - ratingChange) < 1) return { change: ratingChange, applied: false };

  return {
    change: Math.round(nuevo),
    applied: true,
    reason: `Tu equipo perdió, tu rendimiento fue de ${(rank * 100).toFixed(0)}% (x${factor.toFixed(2)})`,
  };
}

/**
 * Castigo por abandonar la partida.
 * En duel lo dejamos pasar porque el abandono ya se modela como
 * derrota forzada desde la capa que llama a este sistema.
 */
export function applyQuitPenalty(
  ratingChange: number,
  hasQuit: boolean | undefined,
  gameType: string | undefined,
): { change: number; applied: boolean; factor?: number } {
  if (gameType?.toLowerCase() === 'duel') {
    return { change: ratingChange, applied: false };
  }
  if (!ADJUSTMENTS_CONFIG.quitPenalty.enabled || !hasQuit) {
    return { change: ratingChange, applied: false };
  }

  const cfg = ADJUSTMENTS_CONFIG.quitPenalty;

  // Forzamos que el cambio sea negativo siempre.
  let base = ratingChange > 0 ? -ratingChange : ratingChange;
  if (base === 0) base = -10;

  let nuevo = base * cfg.penaltyFactor;
  if (Math.abs(nuevo) < cfg.minPenalty) nuevo = -cfg.minPenalty;

  return { change: Math.round(nuevo), applied: true, factor: cfg.penaltyFactor };
}

/**
 * Aplica todos los ajustes en orden y devuelve el delta final
 * junto con el desglose de qué reglas se activaron.
 */
export function applyRatingAdjustments(
  originalChange: number,
  context: RatingContext,
): RatingAdjustment {
  const adjustments: RatingAdjustment['adjustments'] = [];
  let cambio = originalChange;
  const ratingDiff = context.playerRating - context.opponentRating;

  if (!context.isWin) {
    const lf = applyLossForgiveness(cambio, ratingDiff, context.isWin);
    if (lf.applied) {
      adjustments.push({
        type: 'Loss Forgiveness',
        factor: lf.change / (cambio || 1),
        reason: `Tenías ${Math.round(ratingDiff)} puntos más que tu rival, la pérdida se limitó a -${lf.maxLoss}`,
      });
      cambio = lf.change;
    }
  }

  if (context.isWin) {
    const ub = applyUpsetBonus(cambio, ratingDiff, context.isWin);
    if (ub.applied) {
      adjustments.push({
        type: 'Upset Bonus',
        factor: ub.bonus!,
        reason: `Tu rival tenía ${Math.round(Math.abs(ratingDiff))} puntos más, sumaste +${Math.round((ub.bonus! - 1) * 100)}% extra`,
      });
      cambio = ub.change;
    }

    const af = applyAntiFarming(cambio, ratingDiff, context.isWin);
    if (af.applied) {
      adjustments.push({
        type: 'Anti-Farming',
        factor: af.reduction!,
        reason: `Tu rival era mucho más débil, se redujo un ${Math.round((1 - af.reduction!) * 100)}% lo que ganaste`,
      });
      cambio = af.change;
    }
  }

  if (context.marginOfVictory !== undefined && context.maxScore !== undefined) {
    const mov = applyMarginOfVictory(cambio, context.marginOfVictory, context.maxScore);
    if (mov.applied) {
      adjustments.push({
        type: 'Margin of Victory',
        factor: mov.factor!,
        reason: `El marcador fue ${context.marginOfVictory} de ${context.maxScore}, se aplicó el ${Math.round(mov.factor! * 100)}% del cambio`,
      });
      cambio = mov.change;
    }
  }

  const es = applyExperienceScaling(cambio, context.playerGames);
  if (es.applied && es.factor !== 1.0) {
    adjustments.push({
      type: 'Experience Scaling',
      factor: es.factor!,
      reason: `Llevas ${context.playerGames} partidas, tu ELO se mueve un ${Math.round(es.factor! * 100)}% de lo normal`,
    });
    cambio = es.change;
  }

  const sp = applyStreakProtection(
    cambio,
    context.consecutiveLosses,
    context.consecutiveWins,
    context.isWin,
  );
  if (sp.applied) {
    const racha = context.isWin ? context.consecutiveWins : context.consecutiveLosses;
    adjustments.push({
      type: context.isWin ? 'Win Streak Bonus' : 'Loss Streak Protection',
      factor: sp.factor!,
      reason: context.isWin
        ? `Llevas ${racha} victorias seguidas, ELO extra`
        : `Llevas ${racha} derrotas seguidas, la pérdida fue suavizada`,
    });
    cambio = sp.change;
  }

  const trm = applyTeamResultModifier(
    cambio,
    context.teamWon,
    context.gameType,
    context.performanceRank,
  );
  if (trm.applied) {
    adjustments.push({
      type: 'Team Result',
      factor: trm.change / (cambio || 1),
      reason: trm.reason || 'Ajuste por resultado del equipo',
    });
    cambio = trm.change;
  }

  const qp = applyQuitPenalty(cambio, context.hasQuit, context.gameType);
  if (qp.applied) {
    adjustments.push({
      type: 'Quit Penalty',
      factor: qp.factor!,
      reason: `Abandonaste la partida, la penalización fue de x${qp.factor}`,
    });
    cambio = qp.change;
  }

  // Si tu equipo ganó, siempre te sumás al menos 1 punto.
  if (context.teamWon === true && cambio <= 0) {
    adjustments.push({
      type: 'Winner Guarantee',
      factor: 1,
      reason: `Tu equipo ganó: forzando mínimo +1 (era ${cambio})`,
    });
    cambio = 1;
  }

  // Piso absoluto.
  const proyectado = context.playerRating + cambio;
  if (proyectado < PISO_RATING) {
    const perdidaMax = context.playerRating - PISO_RATING;
    if (perdidaMax > 0) {
      cambio = -perdidaMax;
      adjustments.push({
        type: 'Floor Protection',
        factor: 1,
        reason: `El ELO no puede bajar de ${PISO_RATING} (pérdida limitada a -${perdidaMax})`,
      });
    } else {
      cambio = 0;
      adjustments.push({
        type: 'Floor Protection',
        factor: 0,
        reason: `Ya estás en el piso (${PISO_RATING}), sin cambio`,
      });
    }
  }

  return {
    originalChange,
    adjustedChange: Math.round(cambio),
    adjustments,
  };
}

// Margen máximo razonable según el modo de juego.
// Si agregas modos propios, extiende este switch.
export function calculateMarginOfVictory(
  score1: number,
  score2: number,
  gameType: string,
): { margin: number; maxMargin: number } | null {
  const gt = gameType.toLowerCase();
  const margin = Math.abs(score1 - score2);

  switch (gt) {
    case 'ca':
      return { margin, maxMargin: 8 };
    case 'duel':
      return { margin, maxMargin: 15 };
    case 'ctf':
      return { margin, maxMargin: 5 };
    case 'tdm':
      return { margin, maxMargin: 30 };
    case 'ffa':
      return { margin, maxMargin: 20 };
    default:
      return null;
  }
}
