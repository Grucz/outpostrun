/**
 * Flödesfält med Dijkstras algoritm.
 *
 * Sökningen startar i målrutorna och breder ut sig över kartan. Varje ruta
 * får en pekare (next) till grannrutan som leder närmast målet. Alla zombier
 * av samma typ delar fältet, så det räcker att räkna om det när något på
 * kartan förändras.
 *
 * Se Red Blob Games: https://www.redblobgames.com/pathfinding/tower-defense/
 */

const NEIGHBORS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * @param {import('./map.js').GameMap} map
 * @param {number[]} goals målrutor
 * @param {(i:number) => number} enterCost kostnad att gå in i ruta i
 * @returns {{dist: Float64Array, next: Int32Array}}
 */
export function computeFlowField(map, goals, enterCost) {
  const dist = new Float64Array(map.size).fill(Infinity);
  const next = new Int32Array(map.size).fill(-1);
  const goalSet = new Set(goals);
  const heap = new MinHeap();

  for (const g of goals) {
    dist[g] = 0;
    next[g] = g;
    heap.push(0, g);
  }

  while (heap.size > 0) {
    const { key: d, value: i } = heap.pop();
    if (d > dist[i]) continue;

    // Kostnaden att gå in i ruta i från en granne. Målrutor kostar alltid 1,
    // även om målet är en försvarare som annars blockerar.
    const cost = goalSet.has(i) ? 1 : enterCost(i);
    if (!Number.isFinite(cost)) continue;

    const c = map.col(i);
    const r = map.row(i);
    for (const [dc, dr, len] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!map.inBounds(nc, nr)) continue;
      const nb = map.index(nc, nr);
      if (map.isImpassable(nb)) continue;
      // Diagonala steg får inte skära hörn på hinder eller oframkomlig terräng.
      if (dc !== 0 && dr !== 0) {
        if (blocksCorner(map, map.index(nc, r)) || blocksCorner(map, map.index(c, nr))) continue;
      }
      const nd = d + cost * len;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        next[nb] = i;
        heap.push(nd, nb);
      }
    }
  }

  return { dist, next };
}

function blocksCorner(map, i) {
  return map.isImpassable(i) || map.blocker(i) !== null;
}

/** Enkel binär min-heap. */
class MinHeap {
  constructor() {
    this.keys = [];
    this.values = [];
  }

  get size() {
    return this.keys.length;
  }

  push(key, value) {
    const keys = this.keys;
    const values = this.values;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      values[i] = values[p];
      i = p;
    }
    keys[i] = key;
    values[i] = value;
  }

  pop() {
    const keys = this.keys;
    const values = this.values;
    const top = { key: keys[0], value: values[0] };
    const lastKey = keys.pop();
    const lastValue = values.pop();
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && keys[r] < keys[l] ? r : l;
        if (keys[m] >= lastKey) break;
        keys[i] = keys[m];
        values[i] = values[m];
        i = m;
      }
      keys[i] = lastKey;
      values[i] = lastValue;
    }
    return top;
  }
}
