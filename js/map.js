import { GRID, TERRAIN } from './config.js';

/**
 * Kartan: ett rutnät där varje ruta har en terrängtyp och högst ett
 * föremål (hinder eller försvarare). Koordinater: x = kolumn, z = rad.
 */
export class GameMap {
  constructor() {
    this.cols = GRID.cols;
    this.rows = GRID.rows;
    this.size = this.cols * this.rows;
    this.terrain = new Array(this.size).fill('meadow');
    this.occupant = new Array(this.size).fill(null);
    this.campCells = [];
    this.spawnCells = [];
    this.generate();
  }

  index(c, r) {
    return r * this.cols + c;
  }

  col(i) {
    return i % this.cols;
  }

  row(i) {
    return Math.floor(i / this.cols);
  }

  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  cellAt(x, z) {
    const c = Math.floor(x);
    const r = Math.floor(z);
    return this.inBounds(c, r) ? this.index(c, r) : -1;
  }

  center(i) {
    return { x: this.col(i) + 0.5, z: this.row(i) + 0.5 };
  }

  /** Bygger prototypbanan: en sjö, tre skogsdungar, klippor och lägret. */
  generate() {
    const ellipse = (cx, cz, rx, rz, type) => {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const dx = (c + 0.5 - cx) / rx;
          const dz = (r + 0.5 - cz) / rz;
          if (dx * dx + dz * dz <= 1) this.terrain[this.index(c, r)] = type;
        }
      }
    };
    const rect = (c0, r0, w, h, type) => {
      for (let r = r0; r < r0 + h; r++) {
        for (let c = c0; c < c0 + w; c++) {
          if (this.inBounds(c, r)) this.terrain[this.index(c, r)] = type;
        }
      }
    };

    ellipse(17, 6, 4.5, 3.2, 'water');
    ellipse(9, 13, 3, 4, 'forest');
    ellipse(26, 8, 3.5, 2.5, 'forest');
    ellipse(22, 21, 4, 3, 'forest');
    rect(14, 19, 2, 5, 'rock');
    rect(29, 15, 2, 6, 'rock');
    rect(30, 4, 3, 2, 'rock');
    rect(35, 12, 3, 3, 'camp');

    for (let i = 0; i < this.size; i++) {
      if (this.terrain[i] === 'camp') this.campCells.push(i);
      if (this.col(i) === 0 && !this.isImpassable(i)) this.spawnCells.push(i);
    }
  }

  terrainDef(i) {
    return TERRAIN[this.terrain[i]];
  }

  isImpassable(i) {
    return this.terrainDef(i).moveCost === Infinity;
  }

  isCamp(i) {
    return this.terrain[i] === 'camp';
  }

  /** Spawnzonen är de två vänstra kolumnerna, där spelaren inte får bygga. */
  isSpawnZone(i) {
    return this.col(i) < 2;
  }

  blocker(i) {
    const o = this.occupant[i];
    return o && o.blocking ? o : null;
  }

  /** Kostnad att gå in i rutan, utan blockerande föremål. */
  moveCost(i) {
    let cost = this.terrainDef(i).moveCost;
    const o = this.occupant[i];
    if (o && !o.blocking && o.def.moveCost) cost = Math.max(cost, o.def.moveCost);
    return cost;
  }

  speedFactor(i) {
    let speed = this.terrainDef(i).speed;
    const o = this.occupant[i];
    if (o && !o.blocking && o.def.speed) speed = Math.min(speed, o.def.speed);
    return speed;
  }

  canBuild(i) {
    if (i < 0) return false;
    if (!this.terrainDef(i).buildable) return false;
    if (this.occupant[i]) return false;
    if (this.isSpawnZone(i)) return false;
    return true;
  }
}
