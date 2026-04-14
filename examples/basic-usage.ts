// Ejemplo básico. Dos jugadores juegan una partida y actualizamos
// el rating de los dos.
// Ejecutar con: npx tsx examples/basic-usage.ts

import {
  createGlicko1Player,
  updateGlicko1Rating,
  estimateRatingChange,
  getRatingPeriod,
  applyRatingAdjustments,
  calculateMarginOfVictory,
} from '../src';

const forest = createGlicko1Player(1500, 200);
const hexen = createGlicko1Player(1400, 180);

const period = getRatingPeriod();

console.log('Antes del partido:');
console.log(`  forest: ${forest.rating.toFixed(0)} (RD ${forest.rd.toFixed(0)})`);
console.log(`  hexen:  ${hexen.rating.toFixed(0)} (RD ${hexen.rd.toFixed(0)})`);

const estimado = estimateRatingChange(forest.rating, forest.rd, hexen.rating, hexen.rd, 1);
console.log(`\nSi forest gana, suma aprox ${estimado.toFixed(1)} puntos.`);

// forest gana 10-7 en CA (round limit 10)
const forestGano = true;
const score = { forest: 10, hexen: 7 };

const forestNuevo = updateGlicko1Rating(
  forest,
  [{ opponent: { rating: hexen.rating, rd: hexen.rd }, outcome: forestGano ? 1 : 0 }],
  period,
);
const hexenNuevo = updateGlicko1Rating(
  hexen,
  [{ opponent: { rating: forest.rating, rd: forest.rd }, outcome: forestGano ? 0 : 1 }],
  period,
);

const deltaCrudo = forestNuevo.rating - forest.rating;

const mov = calculateMarginOfVictory(score.forest, score.hexen, 'ca');
const ajustado = applyRatingAdjustments(deltaCrudo, {
  playerRating: forest.rating,
  opponentRating: hexen.rating,
  playerGames: forest.games,
  opponentGames: hexen.games,
  isWin: forestGano,
  gameType: 'ca',
  teamWon: forestGano,
  performanceRank: 0.75,
  marginOfVictory: mov?.margin,
  maxScore: mov?.maxMargin,
  consecutiveWins: 2,
});

console.log('\nDespués (Glicko crudo):');
console.log(
  `  forest: ${forestNuevo.rating.toFixed(0)} (${deltaCrudo >= 0 ? '+' : ''}${deltaCrudo.toFixed(1)})`,
);
console.log(`  hexen:  ${hexenNuevo.rating.toFixed(0)}`);

console.log('\nDespués de los ajustes:');
console.log(`  Delta crudo:    ${ajustado.originalChange.toFixed(1)}`);
console.log(`  Delta ajustado: ${ajustado.adjustedChange}`);
console.log('  Reglas aplicadas:');
for (const a of ajustado.adjustments) {
  console.log(`    • ${a.type}: ${a.reason}`);
}
