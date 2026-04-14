# glicko1-quakeclub

Sistema de rating Glicko-1 en TypeScript con un set de ajustes encima,
pensado para que el ELO se sienta justo en comunidades chicas.

Es el mismo motor que uso en [quakeclub.com](https://quakeclub.com),
una plataforma comunitaria para la escena chilena de Quake Live.
Arrancó porque el rating que teníamos (el de QLStats) no alcanzaba
para lo que necesitábamos: queríamos algo propio para la comunidad
latinoamericana, que manejara varios modos (CA, CTF, Duel, TDM, FT,
AD, DOM, FFA) y que no castigara feo a los tops ni dejara sin
progreso a los underdogs.

## Por qué no alcanza con Glicko puro

Glicko-1 es matemáticamente correcto, pero en una población chica
aparecen problemas de percepción:

- Un top pierde muchísimo rating por caer contra un amigo peor (aunque
  estadísticamente tenga sentido).
- Un underdog apenas suma cuando le gana al favorito.
- Un jugador en racha de derrotas cae en espiral y deja de jugar.
- En juegos por equipos el rating individual puede subir aunque el
  equipo haya perdido, lo que rompe la intuición del jugador.
- Un 10-9 y un 10-0 en CA mueven exactamente lo mismo, cuando uno fue
  casi un empate y el otro una paliza.

Glicko puro (archivo `src/glicko1.ts`) queda intacto. Lo que agrega
esta librería es una capa de ajustes sobre el delta crudo.

## Flujo

1. Se calcula el delta crudo con Glicko-1 estándar (rating + RD).
2. Ese delta pasa por los modificadores habilitados.
3. Se devuelve el delta final y un array con el detalle de qué reglas
   se aplicaron y por qué (pensado para mostrarlo en la UI del
   post-partida).

Cada modificador es una función pura y se prende/apaga desde
`ADJUSTMENTS_CONFIG` en `src/rating-adjustments.ts`.

## Los modificadores

### Loss Forgiveness
Si pierdes contra alguien peor que tú, la pérdida se topa.

| Ventaja sobre el rival | Pérdida máxima |
|------------------------|----------------|
| +200                   | -18            |
| +300                   | -12            |
| +400                   | -8             |
| +500 o más             | -5             |

Solo aplica a derrotas del favorito. Evita que un top pierda 40
puntos por caer contra un amigo.

### Upset Bonus
Si le ganaste a alguien mejor, sumas extra.

| Desventaja vs el rival | Multiplicador |
|------------------------|---------------|
| -100                   | x1.15         |
| -200                   | x1.25         |
| -300                   | x1.35         |
| -400 o más             | x1.50         |

Solo aplica a victorias del underdog. Recompensa el logro.

### Anti-Farming
Si le ganaste a alguien mucho peor, sumas menos.

| Ventaja sobre el rival | Reducción |
|------------------------|-----------|
| +300                   | x0.80     |
| +400                   | x0.65     |
| +500 o más             | x0.50     |

Desincentiva a los tops que quieren farmear rating contra jugadores
nuevos.

### Margin of Victory
Una partida peleada mueve menos el rating que una paliza. El factor
va de 0.6 a 1.0 según qué tan cerca estuvo el marcador del "margen
máximo" calibrado para ese modo:

| Modo | Margen donde el factor llega a 1.0 |
|------|------------------------------------|
| CA   | 8                                  |
| Duel | 15                                 |
| CTF  | 5                                  |
| TDM  | 30                                 |
| FFA  | 20                                 |

No son límites canónicos del modo, son valores de calibración: por
encima de esa diferencia se considera paliza plena y el cambio se
aplica al 100%. Un 10-9 en CA aplica cerca de x0.6, un 10-2 aplica
x1.0. Están ajustados para Quake Live, si lo usas en otro juego
reemplazá el helper `calculateMarginOfVictory`.

### Streak Protection
Dos comportamientos según vayas perdiendo o ganando:

**Protección de racha perdedora** (amortigua la pérdida):

| Derrotas seguidas | Multiplicador |
|-------------------|---------------|
| 4                 | x0.90         |
| 6                 | x0.80         |
| 8                 | x0.70         |

**Bonus de racha ganadora** (premia la racha):

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

`performanceRank` se pasa entre 0.0 (peor del server) y 1.0 (mejor).

### Quit Penalty
Si abandonas la partida, el cambio se vuelve negativo siempre, se
multiplica por 2 y tiene un piso de -30 ELO.

En Duel se desactiva porque el abandono ya se modela como derrota
forzada desde la capa que llama al sistema.

**Nota**: esta librería solo penaliza el quit de esa partida en
particular. El tracking de abandonos reiterados (por ejemplo "5 quits
en 7 días = penalización adicional") vive fuera, en la capa que
consume el rating. En quakeclub.com eso lo maneja un plugin
server-side que detecta el patrón y después llama a la librería con
`hasQuit: true`.

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

// forest le gana 10-7 a hexen en CA
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

El array `adjustments` está pensado para mostrarse en la UI del
post-partida: el jugador ve exactamente por qué su ELO se movió lo
que se movió.

## Score de rendimiento

El módulo `performance` convierte stats crudas del juego (kills,
deaths, daño, capturas, etc.) en un número único comparable entre
modos. No es un rating, es un insumo que se usa después para calcular
el `performanceRank` que entra al `teamResultModifier`.

Las fórmulas por modo están en `src/performance.ts`. Ejemplo de CTF:

```
damageRatio * (score + damageDealt / 20) * timeFactor
```

`timeFactor` normaliza según cuánto del partido estuvo el jugador
realmente activo (rondas jugadas sobre totales, o tiempo vivo).

## Valores por defecto

Calibrados para una comunidad de cientos de jugadores activos. Si la
población es mucho más grande conviene reducir el RD inicial y el
tope de cambio por partida.

- Rating inicial: 900
- RD inicial: 350 (jugador nuevo, máxima incertidumbre)
- RD mínimo: 30 (jugador muy activo)
- Rating mínimo absoluto: 100
- Piso que aplican los ajustes: 300
- Tope de cambio por partida: 150

Todo está en `src/glicko1.ts` y `src/rating-adjustments.ts` para
calibrar.

## Heads up

Esto es Glicko-1, no Glicko-2. No tiene volatility. Para la mayoría
de los casos el 1 alcanza, pero si necesitas Glicko-2 esta librería
no sirve.

## Licencia

MIT. Úsalo como quieras.
