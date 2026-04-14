export {
  createGlicko1Player,
  updateGlicko1Rating,
  applyRdDecay,
  winProbability,
  getRatingPeriod,
  estimateRatingChange,
  Glicko1Constants,
} from './glicko1';

export type { Glicko1Rating, Glicko1Opponent, Glicko1Match } from './glicko1';

export {
  ADJUSTMENTS_CONFIG,
  applyLossForgiveness,
  applyUpsetBonus,
  applyAntiFarming,
  applyMarginOfVictory,
  applyExperienceScaling,
  applyStreakProtection,
  applyTeamResultModifier,
  applyQuitPenalty,
  applyRatingAdjustments,
  calculateMarginOfVictory,
} from './rating-adjustments';

export type { RatingContext, RatingAdjustment } from './rating-adjustments';

export {
  calculatePerformance,
  determineMatchOutcome,
} from './performance';

export type { PlayerPerformanceStats } from './performance';
