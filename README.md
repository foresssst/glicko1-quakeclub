# glicko1-quakeclub

Este es el sistema de rating Glicko-1 reescrito en TypeScript con un set propios de ajustes encima, pensado para que el rating final sea siempre lo mas justo posible para todos.
En escencia, es el mismo motor que se usa en [quakeclub.com](https://quakeclub.com), una plataforma comunitaria para la escena chilena y latinoamericana de Quake Live.

## Flujo de trabajo

1. Se calcula el delta crudo con Glicko-1 estándar (rating + RD).
2. Ese delta pasa por los modificadores habilitados.
3. Se devuelve el delta final y un array con el detalle de qué reglas
   se aplicaron y por qué.

Cada modificador es una función pura y se prende/apaga desde
`ADJUSTMENTS_CONFIG` en `src/rating-adjustments.ts`.

## MODIFICADORES

### Loss Forgiveness
Si pierdes contra alguien peor que tú, la pérdida se topa.

| Ventaja sobre el rival | Pérdida máxima |
|------------------------|----------------|
| +200                   | -18            |
| +300                   | -12            |
| +400                   | -8             |
| +500 o más             | -5             |

Esto esta pensado solamente para derrotas del MVP

### Upset Bonus
Si le ganaste a alguien mejor, sumas ELO extra.

| Desventaja vs el rival | Multiplicador |
|------------------------|---------------|
| -100                   | x1.15         |
| -200                   | x1.25         |
| -300                   | x1.35         |
| -400 o más             | x1.50         |

Pensado para recompensar el logro.

### Anti Farmeo
Si le ganaste a alguien mucho peor, sumas menos.

| Ventaja sobre el rival | Reducción |
|------------------------|-----------|
| +300                   | x0.80     |
| +400                   | x0.65     |
| +500 o más             | x0.50     |

Desincentiva a los mejores que quieren farmear rating contra jugadores
nuevos.

### Margin of Victory
Una partida peleada mueve menos el rating que una paliza. El factor
va de 0.6 a 1.0 según qué tan cerca estuvo el marcador del "margen
máximo" calibrado para ese gametype:

| Modo | Margen donde el factor llega a 1.0 |
|------|------------------------------------|
| CA   | 8                                  |
| Duel | 15                                 |
| CTF  | 5                                  |
| TDM  | 30                                 |
| FFA  | 20                                 |

Esto no son límites canónicos de los gametypes, son valores de calibración: por encima de esa diferencia se considera paliza plena y el cambio se
aplica al 100%. Un 10-9 en CA por ejemplo, aplica cerca de x0.6, un 10-2 aplica
x1.0. Están ajustados para Quake Live, si lo adaptas en un en otro juego
similar tendras que reemplazar el helper `calculateMarginOfVictory`.

### Streak Protection
Dos comportamientos según vayas perdiendo o ganando:

**Protección de racha perdedora** (amortigua la mala racha):

| Derrotas seguidas | Multiplicador |
|-------------------|---------------|
| 4                 | x0.90         |
| 6                 | x0.80         |
| 8                 | x0.70         |

**Bonus de racha ganadora** (premia la buena racha):

| Victorias seguidas | Multiplicador |
|--------------------|---------------|
| 4                  | x1.10         |
| 6                  | x1.15         |

Un mal día no mata tu rating, y una buena racha se siente premiada.

### Team Result Modifier
En juegos por equipos el resultado del equipo *siempre* tiene que
importar. La regla:

- Si tu equipo **ganó** y rindes bien, cobras un bonus de hasta x1.5.
- Si tu equipo **ganó** pero rendiste muy bajo, el bonus se reduce o
  desaparece. Si tu delta crudo era negativo, se fuerza un mínimo de
  +1 ELO (regla `Winner Guarantee`).
- Si tu equipo **perdió**, pierdes ELO aunque individualmente te haya
  ido bien... **salvo** que hayas rendido en el top (sobre 78% por
  defecto), en cuyo caso tu ELO queda protegido.

`performanceRank` se pasa entre 0.0 (el peor de un match) y 1.0 (el mejor).

### Quit Penalty
Si abandonas la partida, el cambio se vuelve negativo siempre, se
multiplica por 2 y tiene un piso de -30 ELO.

En el caso de duel este se desactiva porque el abandono ya se modela como derrota forzada desde la capa que llama al sistema.

**Nota**: esta librería solo penaliza el quit de esa partida en
particular.

### Floor Protection
El rating no puede bajar de un piso absoluto (300 por defecto). Al
llegar al piso los ajustes dejan de descontar.

## Uso

```bash
git clone https://github.com/foresssst/glicko1-quakeclub.git
cd glicko1-quakeclub
npm install
npx tsx examples/basic-usage.ts
```

Ejemplo mínimo:

```ts
import {
  createGlicko1Player,
  updateGlicko1Rating,
  getRatingPeriod,
  applyRatingAdjustments,
  calculateMarginOfVictory,
} from 'glicko1-quakeclub';

const forest = createGlicko1Player(1500, 200);
const hexen  = createGlicko1Player(1400, 180);

// forest le gana 10-7 a hexen en un CA
const period = getRatingPeriod();
const actualizado = updateGlicko1Rating(
  forest,
  [{ opponent: { rating: hexen.rating, rd: hexen.rd }, outcome: 1 }],
  period,
);

const deltaCrudo = actualizado.rating - forest.rating;
const mov = calculateMarginOfVictory(10, 7, 'ca');

const ajustado = applyRatingAdjustments(deltaCrudo, {
  playerRating: forest.rating,
  opponentRating: hexen.rating,
  playerGames: forest.games,
  opponentGames: hexen.games,
  isWin: true,
  teamWon: true,
  gameType: 'ca',
  performanceRank: 0.75,
  marginOfVictory: mov?.margin,
  maxScore: mov?.maxMargin,
  consecutiveWins: 2,
});

console.log(ajustado.adjustedChange);   // delta final
console.log(ajustado.adjustments);      // qué reglas se activaron
```

El array `adjustments` está pensado para mostrarse en una UI del
post-partida: el jugador en el sitio web ve exactamente por qué su ELO se movió lo / que se movió.

## Score de rendimiento

El módulo `performance` convierte stats crudas del juego (kills,
deaths, daño, capturas, etc.) en un número único comparable entre
modos. No es un rating, es un insumo que se utilizara después para calcular
el `performanceRank` que entra al `teamResultModifier`.

Las fórmulas por modo están en `src/performance.ts`. Ejemplo para un CTF:

```
damageRatio * (score + damageDealt / 20) * timeFactor
```

`timeFactor` normaliza según cuánto del partido estuvo el jugador
realmente activo (rondas jugadas sobre totales, o tiempo vivo).

## Valores por defecto

Estos estan calibrados para una comunidad de cientos de jugadores activos. Si la población es mucho más grande conviene reducir el RD inicial y el tope de cambio por partida.

- Rating inicial: 900
- RD inicial: 350 (jugador nuevo, máxima incertidumbre)
- RD mínimo: 30 (jugador muy activo)
- Rating mínimo absoluto: 100
- Piso que aplican los ajustes: 300
- Tope de cambio por partida: 150

Todo está en `src/glicko1.ts` y `src/rating-adjustments.ts`.
