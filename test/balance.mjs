/**
 * Balanstest: kör några olika försvarsupplägg många gånger och mäter
 * förlorade försvarare och skada på förrådet per runda.
 *
 * Mål: ett rimligt försvar förlorar 1 till 3 försvarare per runda från runda 3,
 * och ett försvar som bara står tätt intill lägret tar skada på förrådet.
 *
 * Kör med: node test/balance.mjs
 */
import { GameMap } from '../js/map.js';
import { Game } from '../js/game.js';
import { WAVES } from '../js/config.js';

/** Varje plan anger vad som ska finnas från och med en viss runda (index). */
export const PLANS = {
  // Patricks testupplägg: gevär och armborst bakom diken och pålar nära lägret,
  // sedan värn och ett gevär till, sedan fler armborst på sidorna bakom pålar.
  patrick: [
    [0, 'rifle', 33, 13], [0, 'crossbow', 33, 11], [0, 'ditch', 32, 11], [0, 'ditch', 32, 12],
    [0, 'ditch', 32, 13], [0, 'stakes', 31, 11], [0, 'stakes', 31, 12], [0, 'stakes', 31, 13],
    [1, 'barricade', 32, 14], [1, 'barricade', 32, 10], [1, 'rifle', 34, 15],
    [2, 'crossbow', 31, 8], [2, 'stakes', 30, 8], [2, 'crossbow', 31, 18], [2, 'stakes', 30, 18],
    [3, 'crossbow', 32, 6], [3, 'stakes', 31, 6], [3, 'crossbow', 32, 21], [3, 'stakes', 31, 21],
    [4, 'rifle', 34, 9], [4, 'stakes', 30, 9], [4, 'stakes', 30, 17],
  ],
  // Försvar framskjutet mot mitten av kartan.
  forward: [
    [0, 'rifle', 24, 13], [0, 'barricade', 23, 12], [0, 'barricade', 23, 14], [0, 'stakes', 22, 13],
    [1, 'crossbow', 27, 16], [1, 'crossbow', 27, 11], [1, 'stakes', 26, 13],
    [2, 'rifle', 30, 13], [2, 'barricade', 29, 12], [2, 'barricade', 29, 14],
    [3, 'crossbow', 31, 10], [3, 'crossbow', 31, 16], [3, 'stakes', 28, 13],
    [4, 'rifle', 33, 13], [4, 'crossbow', 33, 9], [4, 'crossbow', 33, 17],
  ],
  // Bara armborst i en tät ring kring lägret.
  campRing: [
    [0, 'crossbow', 34, 12], [0, 'crossbow', 34, 14], [0, 'crossbow', 36, 11], [0, 'crossbow', 36, 15],
    [1, 'crossbow', 38, 13], [1, 'crossbow', 34, 13], [1, 'crossbow', 35, 11],
    [2, 'crossbow', 35, 15], [2, 'crossbow', 37, 11], [2, 'crossbow', 37, 15],
    [3, 'crossbow', 34, 11], [3, 'crossbow', 34, 15], [3, 'crossbow', 38, 12],
    [4, 'crossbow', 38, 14], [4, 'crossbow', 33, 13],
  ],
};

function runPlan(plan) {
  const map = new GameMap();
  const game = new Game(map);
  const rounds = [];
  let lost = 0;
  game.on('removed', (e) => {
    if (e.kind === 'defender' && game.phase === 'round') lost++;
  });
  while (game.phase === 'planning') {
    for (const [from, tool, c, r] of plan) {
      if (from <= game.round) game.apply(tool, map.index(c, r));
    }
    for (const s of [...game.structures, ...game.defenders]) {
      const cost = game.repairCost(s);
      if (cost > 0 && game.budget >= cost) game.apply('repair', s.cell);
    }
    lost = 0;
    const storeBefore = game.store;
    game.startRound();
    let t = 0;
    while (game.phase === 'round' && t < 900) {
      game.update(0.05);
      t += 0.05;
    }
    rounds.push({ lost, storeLoss: storeBefore - game.store, defenders: game.defenders.length });
  }
  return { won: game.phase === 'won', rounds, budget: game.budget };
}

const RUNS = Number(process.env.RUNS ?? 30);
for (const [name, plan] of Object.entries(PLANS)) {
  const perRound = WAVES.map(() => ({ lost: 0, storeLoss: 0, n: 0 }));
  let wins = 0;
  let budget = 0;
  for (let k = 0; k < RUNS; k++) {
    const res = runPlan(plan);
    if (res.won) wins++;
    budget += res.budget;
    res.rounds.forEach((r, i) => {
      perRound[i].lost += r.lost;
      perRound[i].storeLoss += r.storeLoss;
      perRound[i].n++;
    });
  }
  console.log(`\n${name}: vinst ${wins}/${RUNS}, sparade poäng i snitt ${Math.round(budget / RUNS)}`);
  console.table(
    perRound.map((r, i) => ({
      runda: i + 1,
      'spelade av': r.n,
      'förlorade försvarare': r.n ? (r.lost / r.n).toFixed(1) : '-',
      'skada på förråd': r.n ? (r.storeLoss / r.n).toFixed(1) : '-',
    })),
  );
}
