/**
 * Testar spellogiken utan webbläsare: vägval, hinder, ljud och hela rundor.
 * Kör med: node test/simulate.mjs
 */
import { GameMap } from '../js/map.js';
import { Game } from '../js/game.js';
import { WAVES } from '../js/config.js';

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? 'OK  ' : 'FEL '} ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) failures++;
}

function follow(game, type, start, maxSteps = 500) {
  const f = game.fields[type];
  const path = [start];
  let i = start;
  for (let s = 0; s < maxSteps; s++) {
    const n = f.next[i];
    if (n < 0 || n === i) break;
    path.push(n);
    i = n;
  }
  return path;
}

// 1. Alla startrutor når lägret.
{
  const map = new GameMap();
  const game = new Game(map);
  const unreachable = map.spawnCells.filter((s) => game.fields.walker.next[s] < 0);
  check('Alla startrutor har en väg till lägret', unreachable.length === 0, `${map.spawnCells.length} startrutor`);
  const p = follow(game, 'walker', map.spawnCells[10]);
  check('Vägen slutar i lägret', map.isCamp(p[p.length - 1]), `${p.length} steg`);
}

// 2. En vägg av värn: vandrare går runt där det finns en lucka, kolossen går igenom.
{
  const map = new GameMap();
  const game = new Game(map);
  game.budget = 100000;
  // Vägg i kolumn 33 från rad 6 till rad 21, med lucka bara längst ner (rad 22 och nedåt).
  for (let r = 6; r <= 21; r++) {
    const i = map.index(33, r);
    if (map.canBuild(i)) game.apply('barricade', i);
  }
  game.recomputeFields();
  const start = map.index(31, 13);
  const walkerPath = follow(game, 'walker', start);
  const colossusPath = follow(game, 'colossus', start);
  const hitsWall = (path) => path.some((i) => map.blocker(i));
  check('Vandraren går runt värnen', !hitsWall(walkerPath), `${walkerPath.length} steg`);
  check('Kolossen går rakt mot värnen', hitsWall(colossusPath), `${colossusPath.length} steg`);
}

// 3. Helt stängd: alla zombier anfaller ändå, ingen ruta blir utan väg.
{
  const map = new GameMap();
  const game = new Game(map);
  game.budget = 100000;
  for (let r = 0; r < map.rows; r++) {
    const i = map.index(33, r);
    if (map.canBuild(i)) game.apply('barricade', i);
  }
  game.recomputeFields();
  const unreachable = map.spawnCells.filter((s) => game.fields.walker.next[s] < 0);
  check('Helt avspärrat läger: vägen går genom ett värn', unreachable.length === 0);
}

// 4. Dike: vandrare väljer omväg runt ett kort dike.
{
  const map = new GameMap();
  const game = new Game(map);
  game.budget = 100000;
  for (let r = 11; r <= 15; r++) game.apply('ditch', map.index(33, r));
  game.recomputeFields();
  const path = follow(game, 'walker', map.index(31, 13));
  const throughDitch = path.some((i) => map.occupant[i]?.key === 'ditch');
  check('Vandraren går runt ett kort dike', !throughDitch);
}

// 5. Ljud: en gevärsskytt lockar zombier, ett armborst gör det knappt.
{
  for (const tool of ['rifle', 'crossbow']) {
    const map = new GameMap();
    const game = new Game(map);
    game.budget = 100000;
    const d = game.place(tool, map.index(20, 14));
    game.startRound();
    game.spawnQueue = [];
    for (let k = 0; k < 6; k++) game.spawn('walker');
    // Placera zombierna fyra rutor från skytten, inom gevärets men utanför armborstets ljudradie.
    game.zombies.forEach((z, k) => {
      z.x = 16.5;
      z.z = 12 + k * 0.5;
    });
    d.def = { ...d.def, range: 6 };
    d.cooldown = 0;
    game.updateDefender(d, 0.01);
    const lured = game.zombies.filter((z) => z.lure === d).length;
    if (tool === 'rifle') check('Gevärsskottet lockar zombier', lured > 0, `${lured} lockade`);
    else check('Armborstet lockar inga zombier på fyra rutors avstånd', lured === 0, `${lured} lockade`);
  }
}

// 6. Hela spelet med ett enkelt försvar, flera körningar.
{
  const results = [];
  for (let run = 0; run < 8; run++) {
    const map = new GameMap();
    const game = new Game(map);
    const plans = [
      [['rifle', 33, 12], ['rifle', 33, 14], ['barricade', 32, 13]],
      [['crossbow', 32, 11], ['crossbow', 32, 15], ['stakes', 31, 13], ['stakes', 31, 12], ['stakes', 31, 14]],
      [['rifle', 34, 10], ['rifle', 34, 16], ['ditch', 28, 22]],
      [['barricade', 31, 11], ['barricade', 31, 15], ['crossbow', 30, 13], ['stakes', 30, 12]],
      [['rifle', 33, 9], ['rifle', 33, 17], ['crossbow', 34, 13]],
    ];
    let errors = 0;
    while (game.phase === 'planning') {
      const plan = plans[game.round] ?? [];
      for (const [tool, c, r] of plan) game.apply(tool, map.index(c, r));
      for (const s of [...game.structures, ...game.defenders]) {
        if (game.repairCost(s) > 0 && game.budget >= game.repairCost(s)) game.apply('repair', s.cell);
      }
      game.startRound();
      let t = 0;
      try {
        while (game.phase === 'round' && t < 600) {
          game.update(0.05);
          t += 0.05;
        }
      } catch (e) {
        errors++;
        console.error(e);
        break;
      }
      if (t >= 600) {
        errors++;
        console.log('Rundan tog över 600 sekunder', game.zombies.length, 'kvar');
        break;
      }
    }
    results.push({ phase: game.phase, round: game.round, store: game.store, killed: game.stats.killed, errors });
  }
  console.table(results);
  check('Inga körfel i hela spel', results.every((r) => r.errors === 0));
  check('Spelet når ett slut (vinst eller förlust)', results.every((r) => r.phase === 'won' || r.phase === 'lost'));
  console.log(`Antal vågor: ${WAVES.length}`);
}

console.log(failures === 0 ? '\nAlla test gick igenom.' : `\n${failures} test misslyckades.`);
process.exit(failures === 0 ? 0 : 1);
