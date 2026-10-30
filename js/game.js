import { STRUCTURES, DEFENDERS, ZOMBIES, WAVES, ECONOMY, RULES, TERRAIN, DIFFICULTY } from './config.js';
import { computeFlowField } from './flowfield.js';

let nextId = 1;

/**
 * Spellogiken. Klassen känner inte till grafiken; den skickar händelser
 * (added, removed, shot, fields, state, message, end) som vyn och
 * gränssnittet lyssnar på. Det gör att logiken kan testas utan webbläsare.
 */
export class Game {
  constructor(map, difficulty = 'normal') {
    this.map = map;
    this.difficulty = difficulty;
    this.diff = DIFFICULTY[difficulty];
    this.zombies = [];
    this.defenders = [];
    this.structures = [];
    this.phase = 'planning'; // planning | round | won | lost
    this.round = 0;
    this.budget = ECONOMY.startBudget;
    this.store = ECONOMY.storeMax;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.spawnCount = 0;
    this.fields = {};
    this.lureFields = new Map();
    this.fieldsDirty = true;
    this.placedThisPhase = new Set();
    this.stats = { killed: 0, breached: 0 };
    this.listeners = {};
    this.recomputeFields();
  }

  // ---------- Händelser ----------

  on(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners[type] ?? []) fn(data);
  }

  // ---------- Vägval ----------

  /**
   * Kostnadsfunktion för en zombietyp. Ett blockerande föremål kostar lika
   * mycket som den sträcka zombien hade hunnit gå medan den slår sönder det,
   * multiplicerat med hur ovillig typen är att anfalla (låg aggressivitet ger
   * hög ovilja). Därför går vandrare runt värn medan kolosser går rakt igenom.
   */
  enterCost(zdef) {
    const reluctance = 1 + (1 - zdef.aggression) * 3;
    return (i) => {
      const b = this.map.blocker(i);
      if (b) return 1 + (b.hp / zdef.strength) * zdef.speed * reluctance;
      return this.map.moveCost(i);
    };
  }

  recomputeFields() {
    for (const [key, zdef] of Object.entries(ZOMBIES)) {
      this.fields[key] = computeFlowField(this.map, this.map.campCells, this.enterCost(zdef));
    }
    this.lureFields.clear();
    this.fieldsDirty = false;
    this.emit('fields');
  }

  /** Flödesfält mot en försvarare, för zombier som lockats av ljud. */
  lureField(type, defender) {
    const k = `${type}:${defender.id}`;
    let f = this.lureFields.get(k);
    if (!f) {
      f = computeFlowField(this.map, [defender.cell], this.enterCost(ZOMBIES[type]));
      this.lureFields.set(k, f);
    }
    return f;
  }

  // ---------- Planering ----------

  defFor(tool) {
    return STRUCTURES[tool] ?? DEFENDERS[tool] ?? null;
  }

  refundFor(e) {
    return this.placedThisPhase.has(e) ? e.def.cost : Math.floor(e.def.cost * ECONOMY.refundShare);
  }

  repairCost(e) {
    if (!e.destructible || e.hp >= e.maxHp) return 0;
    return Math.max(1, Math.ceil((1 - e.hp / e.maxHp) * e.def.cost * ECONOMY.repairShare));
  }

  /** Kontrollerar om ett verktyg kan användas på en ruta. */
  checkTool(tool, i) {
    if (this.phase !== 'planning') return { ok: false, reason: 'Du kan bara bygga mellan rundorna.' };
    if (i < 0) return { ok: false, reason: '' };
    const occ = this.map.occupant[i];

    if (tool === 'remove') {
      if (!occ) return { ok: false, reason: 'Det finns inget att riva här.' };
      return { ok: true, cost: -this.refundFor(occ) };
    }
    if (tool === 'repair') {
      if (!occ) return { ok: false, reason: 'Det finns inget att reparera här.' };
      const cost = this.repairCost(occ);
      if (cost === 0) return { ok: false, reason: 'Det här behöver inte repareras.' };
      if (this.budget < cost) return { ok: false, reason: 'Du har inte tillräckligt med poäng.', cost };
      return { ok: true, cost };
    }

    const def = this.defFor(tool);
    if (!def) return { ok: false, reason: '' };
    if (!this.map.canBuild(i)) {
      const reason = this.map.isSpawnZone(i) && !occ
        ? 'Zombierna kommer härifrån. Här går det inte att bygga.'
        : 'Här går det inte att bygga.';
      return { ok: false, reason };
    }
    if (this.budget < def.cost) return { ok: false, reason: 'Du har inte tillräckligt med poäng.', cost: def.cost };
    return { ok: true, cost: def.cost };
  }

  apply(tool, i) {
    const check = this.checkTool(tool, i);
    if (!check.ok) return check;
    const occ = this.map.occupant[i];
    if (tool === 'remove') {
      this.budget += this.refundFor(occ);
      this.destroy(occ);
    } else if (tool === 'repair') {
      this.budget -= check.cost;
      occ.hp = occ.maxHp;
    } else {
      this.place(tool, i);
    }
    // Räkna om vägvalen direkt, så att pilarna i felsökningsläget visar effekten.
    if (this.fieldsDirty) this.recomputeFields();
    this.emit('state');
    return check;
  }

  place(key, i) {
    const isDefender = key in DEFENDERS;
    const def = this.defFor(key);
    const { x, z } = this.map.center(i);
    const hp = def.hp ?? Infinity;
    const e = {
      id: nextId++,
      kind: isDefender ? 'defender' : 'structure',
      key,
      def,
      cell: i,
      x,
      z,
      hp,
      maxHp: hp,
      blocking: isDefender ? true : def.blocking,
      destructible: isDefender ? true : def.destructible,
      alive: true,
      cooldown: isDefender ? def.interval * Math.random() : 0,
      aim: 0,
    };
    this.map.occupant[i] = e;
    (isDefender ? this.defenders : this.structures).push(e);
    this.budget -= def.cost;
    this.placedThisPhase.add(e);
    this.fieldsDirty = true;
    this.emit('added', e);
    return e;
  }

  /** Tar bort ett hinder eller en försvarare från kartan. */
  destroy(e) {
    if (!e || !e.alive) return;
    e.alive = false;
    if (this.map.occupant[e.cell] === e) this.map.occupant[e.cell] = null;
    const list = e.kind === 'defender' ? this.defenders : this.structures;
    const idx = list.indexOf(e);
    if (idx >= 0) list.splice(idx, 1);
    this.placedThisPhase.delete(e);
    this.fieldsDirty = true;
    this.emit('removed', e);
  }

  /** Svårighetsgraden kan bara ändras innan första rundan har startat. */
  setDifficulty(key) {
    if (!DIFFICULTY[key] || this.round > 0 || this.phase !== 'planning') return false;
    this.difficulty = key;
    this.diff = DIFFICULTY[key];
    this.emit('state');
    return true;
  }

  // ---------- Rundor ----------

  startRound() {
    if (this.phase !== 'planning') return false;
    if (this.fieldsDirty) this.recomputeFields();
    this.spawnQueue = buildQueue(WAVES[this.round]);
    this.spawnTimer = 0;
    this.spawnCount = 0;
    this.phase = 'round';
    this.placedThisPhase.clear();
    this.emit('state');
    this.emit('message', `Runda ${this.round + 1} börjar.`);
    return true;
  }

  update(dt) {
    if (this.phase !== 'round') return;
    if (this.fieldsDirty) this.recomputeFields();

    this.spawnTimer -= dt;
    // Zombierna kommer i horder: en grupp tätt efter varandra, sedan en paus.
    while (this.spawnQueue.length > 0 && this.spawnTimer <= 0) {
      this.spawn(this.spawnQueue.shift());
      this.spawnCount++;
      this.spawnTimer +=
        this.spawnCount % this.diff.groupSize === 0 ? this.diff.groupPause : this.diff.spawnInterval;
    }

    for (const z of [...this.zombies]) {
      if (this.phase !== 'round') return;
      this.updateZombie(z, dt);
    }
    if (this.fieldsDirty) this.recomputeFields();

    for (const d of [...this.defenders]) this.updateDefender(d, dt);

    if (this.spawnQueue.length === 0 && this.zombies.length === 0) this.endRound();
  }

  spawn(type) {
    const cells = this.map.spawnCells;
    const i = cells[Math.floor(Math.random() * cells.length)];
    const { x, z } = this.map.center(i);
    const def = ZOMBIES[type];
    const hp = def.hp * (1 + this.diff.hpGrowth * this.round);
    const zombie = {
      id: nextId++,
      kind: 'zombie',
      key: type,
      def,
      hp,
      maxHp: hp,
      x: x + (Math.random() - 0.5) * 0.5,
      z: z + (Math.random() - 0.5) * 0.5,
      ox: (Math.random() - 0.5) * 0.44,
      oz: (Math.random() - 0.5) * 0.44,
      lure: null,
      lureTime: 0,
      senseTimer: Math.random() * RULES.senseInterval,
      attacking: false,
      alive: true,
    };
    this.zombies.push(zombie);
    this.emit('added', zombie);
  }

  updateZombie(z, dt) {
    const m = this.map;
    const i = m.cellAt(z.x, z.z);
    if (i < 0) {
      z.x = Math.min(Math.max(z.x, 0.01), m.cols - 0.01);
      z.z = Math.min(Math.max(z.z, 0.01), m.rows - 0.01);
      return;
    }

    if (m.isCamp(i)) {
      this.store = Math.max(0, this.store - z.def.campDamage);
      this.stats.breached++;
      this.removeZombie(z);
      this.emit('state');
      this.emit('breach', z);
      if (this.store <= 0) this.lose();
      return;
    }

    if (z.lure) {
      z.lureTime -= dt;
      if (!z.lure.alive || z.lureTime <= 0) z.lure = null;
    }

    // Vittring: en människa inom radien går före både lägret och ljud längre bort.
    z.senseTimer -= dt;
    if (z.senseTimer <= 0) {
      z.senseTimer = RULES.senseInterval;
      const near = this.nearestDefender(z.x, z.z, z.def.scent);
      if (near) {
        z.lure = near;
        z.lureTime = RULES.scentMemory;
      }
    }

    let next = (z.lure ? this.lureField(z.key, z.lure) : this.fields[z.key]).next[i];
    if (z.lure && next < 0) {
      z.lure = null;
      next = this.fields[z.key].next[i];
    }
    z.attacking = false;
    if (next < 0 || next === i) return;

    const blocker = m.blocker(next);
    if (blocker) {
      z.attacking = true;
      z.aimX = blocker.x;
      z.aimZ = blocker.z;
      blocker.hp -= z.def.strength * dt;
      if (blocker.hp <= 0) this.destroy(blocker);
      return;
    }

    const c = m.center(next);
    const tx = c.x + z.ox;
    const tz = c.z + z.oz;
    const dx = tx - z.x;
    const dz = tz - z.z;
    const dist = Math.hypot(dx, dz);
    const step = z.def.speed * m.speedFactor(i) * dt;
    if (dist <= step || dist < 1e-6) {
      z.x = tx;
      z.z = tz;
    } else {
      z.x += (dx / dist) * step;
      z.z += (dz / dist) * step;
    }
    z.aimX = tx;
    z.aimZ = tz;

    const occ = m.occupant[i];
    if (occ && occ.key === 'stakes') {
      z.hp -= occ.def.dps * dt;
      occ.hp -= occ.def.dps * occ.def.wear * dt;
      if (occ.hp <= 0) this.destroy(occ);
      if (z.hp <= 0) this.killZombie(z);
    }
  }

  updateDefender(d, dt) {
    d.cooldown -= dt;
    if (d.cooldown > 0) return;

    let target = null;
    let best = Infinity;
    for (const z of this.zombies) {
      const dist = Math.hypot(z.x - d.x, z.z - d.z);
      if (dist <= d.def.range && dist < best) {
        best = dist;
        target = z;
      }
    }
    if (!target) {
      d.cooldown = 0;
      return;
    }

    d.cooldown = d.def.interval;
    d.aim = Math.atan2(target.x - d.x, target.z - d.z);
    target.hp -= d.def.damage;
    this.emit('shot', { from: d, x: target.x, z: target.z, noise: d.def.noise });
    if (target.hp <= 0) this.killZombie(target);

    // Ljudet lockar alla zombier inom ljudradien till skytten.
    for (const z of this.zombies) {
      if (Math.hypot(z.x - d.x, z.z - d.z) <= d.def.noise) {
        z.lure = d;
        z.lureTime = RULES.lureDuration;
      }
    }
  }

  nearestDefender(x, z, radius) {
    let best = null;
    let bestDist = radius;
    for (const d of this.defenders) {
      const dist = Math.hypot(d.x - x, d.z - z);
      if (dist <= bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  killZombie(z) {
    if (!z.alive) return;
    this.stats.killed++;
    this.removeZombie(z);
  }

  removeZombie(z) {
    if (!z.alive) return;
    z.alive = false;
    const idx = this.zombies.indexOf(z);
    if (idx >= 0) this.zombies.splice(idx, 1);
    this.emit('removed', z);
  }

  endRound() {
    this.round++;
    const bonus = Math.round(ECONOMY.maxBonus * (this.store / ECONOMY.storeMax));
    this.budget += ECONOMY.baseIncome + bonus;
    if (this.round >= WAVES.length) {
      this.phase = 'won';
      this.emit('state');
      this.emit('end', { won: true });
      return;
    }
    this.phase = 'planning';
    this.emit('state');
    this.emit(
      'message',
      `Rundan är klar. Du får ${ECONOMY.baseIncome} poäng i grundbudget och ${bonus} i bonus för förrådet.`,
    );
  }

  lose() {
    this.phase = 'lost';
    this.spawnQueue = [];
    this.emit('state');
    this.emit('end', { won: false });
  }

  // ---------- Beskrivningar för gränssnittet ----------

  describeCell(i) {
    if (i < 0) return '';
    const parts = [TERRAIN[this.map.terrain[i]].name];
    if (this.map.isSpawnZone(i)) parts.push('zombiernas startområde');
    const o = this.map.occupant[i];
    if (o) {
      const hp = Number.isFinite(o.maxHp) ? ` (${Math.ceil(o.hp)} av ${o.maxHp})` : '';
      parts.push(`${o.def.name}${hp}`);
      if (o.kind === 'defender') parts.push(`räckvidd ${o.def.range}, ljud ${o.def.noise}`);
    }
    return parts.join(', ');
  }
}

/** Blandar vågens zombier. Kolosser hamnar i den senare delen av vågen. */
function buildQueue(wave) {
  const normal = [];
  const heavy = [];
  for (const { type, count } of wave) {
    for (let n = 0; n < count; n++) (type === 'colossus' ? heavy : normal).push(type);
  }
  shuffle(normal);
  const queue = [...normal];
  for (const h of heavy) {
    const from = Math.floor(queue.length * 0.6);
    const pos = from + Math.floor(Math.random() * (queue.length - from + 1));
    queue.splice(pos, 0, h);
  }
  return queue;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
