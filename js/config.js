/**
 * Balansdata för prototypen.
 * Alla siffror är riktvärden som justeras i testning. Ändra här i stället
 * för i spelkoden, så hålls reglerna samlade på ett ställe.
 */

export const GRID = { cols: 40, rows: 28 };

/** Terrängtyper. moveCost styr vägvalet, speed styr farten (1 = normal). */
export const TERRAIN = {
  meadow: { name: 'Äng', moveCost: 1, speed: 1.0, color: 0x86a95e, buildable: true },
  forest: { name: 'Skog', moveCost: 3, speed: 0.6, color: 0x5a7a42, buildable: true },
  rock: { name: 'Klippa', moveCost: Infinity, speed: 0, color: 0x8b8a83, buildable: false },
  water: { name: 'Vatten', moveCost: Infinity, speed: 0, color: 0x5583ad, buildable: false },
  camp: { name: 'Läger', moveCost: 1, speed: 1.0, color: 0xcdbb8e, buildable: false },
};

/** Hinder och terrängingrepp. */
export const STRUCTURES = {
  ditch: {
    name: 'Dike',
    cost: 15,
    blocking: false,
    destructible: false,
    moveCost: 8,
    speed: 0.3,
    info: 'Permanent. Zombier kan ta sig igenom men mycket långsamt, så de flesta väljer en annan väg.',
  },
  barricade: {
    name: 'Värn',
    cost: 25,
    blocking: true,
    destructible: true,
    hp: 300,
    info: 'Blockerar. Vandrare går hellre runt, kolosser slår sig igenom.',
  },
  stakes: {
    name: 'Pålar',
    cost: 10,
    blocking: false,
    destructible: true,
    hp: 120,
    moveCost: 4,
    speed: 0.5,
    dps: 18,
    wear: 0.5,
    info: 'Bromsar och skadar zombier som passerar. Slits ut med tiden.',
  },
};

/** Försvarare. noise är ljudradien i rutor: zombier inom radien lockas till skytten. */
export const DEFENDERS = {
  crossbow: {
    name: 'Armborst',
    cost: 40,
    hp: 80,
    range: 4.5,
    damage: 28,
    interval: 2.0,
    noise: 1.2,
    color: 0x3f8f8a,
    info: 'Kortare räckvidd men nästan tyst. Lockar bara zombier i närheten.',
  },
  rifle: {
    name: 'Gevär',
    cost: 60,
    hp: 80,
    range: 7,
    damage: 25,
    interval: 1.0,
    noise: 9,
    color: 0x2f5d8a,
    info: 'Lång räckvidd. Skotten hörs långt och lockar zombier till skytten.',
  },
};

/**
 * Zombietyper.
 * aggression (0 till 1): hur villig typen är att anfalla ett hinder i stället
 * för att gå en omväg. strength är skada per sekund mot hinder och försvarare.
 * scent är vittringen i rutor: en människa inom radien blir zombiens mål.
 */
export const ZOMBIES = {
  walker: {
    name: 'Vandrare',
    hp: 60,
    speed: 0.9,
    strength: 10,
    aggression: 0.2,
    scent: 2,
    size: 0.3,
    campDamage: 1,
    color: 0x6f8f4e,
    info: 'Långsam. Går hellre runt hinder.',
  },
  runner: {
    name: 'Löpare',
    hp: 35,
    speed: 2.0,
    strength: 6,
    aggression: 0.8,
    scent: 4,
    size: 0.24,
    campDamage: 1,
    color: 0xb5a642,
    info: 'Snabb och svag. Tar raka vägen.',
  },
  colossus: {
    name: 'Koloss',
    hp: 420,
    speed: 0.55,
    strength: 40,
    aggression: 1.0,
    scent: 3,
    size: 0.46,
    campDamage: 5,
    color: 0x8e3b33,
    info: 'Stor och tålig. Slår sig igenom hinder.',
  },
};

/** Vågor per runda. */
export const WAVES = [
  [{ type: 'walker', count: 7 }],
  [{ type: 'walker', count: 10 }, { type: 'runner', count: 4 }],
  [{ type: 'walker', count: 20 }, { type: 'runner', count: 12 }],
  [{ type: 'walker', count: 28 }, { type: 'runner', count: 16 }, { type: 'colossus', count: 2 }],
  [{ type: 'walker', count: 36 }, { type: 'runner', count: 22 }, { type: 'colossus', count: 4 }],
];

export const ECONOMY = {
  startBudget: 200,
  baseIncome: 100,
  maxBonus: 30,
  storeMax: 20,
  repairShare: 0.5,
  refundShare: 0.5,
};

export const RULES = {
  spawnInterval: 0.5,
  lureDuration: 6,
  scentMemory: 3,
  senseInterval: 0.25,
  maxFrameTime: 0.05,
};

/** Verktygsraden i den ordning knapparna visas. */
export const TOOLS = [
  { id: 'ditch', hotkey: '1' },
  { id: 'barricade', hotkey: '2' },
  { id: 'stakes', hotkey: '3' },
  { id: 'crossbow', hotkey: '4' },
  { id: 'rifle', hotkey: '5' },
  {
    id: 'repair',
    hotkey: 'r',
    name: 'Reparera',
    info: 'Lagar ett skadat värn eller en skadad försvarare. Kostar hälften av nypriset för den skadade delen.',
  },
  {
    id: 'remove',
    hotkey: 'x',
    name: 'Riv',
    info: 'Full återbetalning om du byggde det i den här planeringen, annars hälften.',
  },
];
