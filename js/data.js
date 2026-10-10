'use strict';

// ---- Weapons -------------------------------------------------------------
// price buys a bundle of `qty`. tier gates availability by the "arms level" option.
const WEAPONS = [
  { id: 'baby_missile', name: 'Baby Missile', price: 400, qty: 10, tier: 0, kind: 'missile', radius: 10, damage: 35, infinite: true, color: '#fff' },
  { id: 'missile', name: 'Missile', price: 1875, qty: 5, tier: 0, kind: 'missile', radius: 20, damage: 65, color: '#fff' },
  { id: 'baby_nuke', name: 'Baby Nuke', price: 10000, qty: 3, tier: 1, kind: 'missile', radius: 40, damage: 100, nuke: true, color: '#ffe066', info: 'Big blast. Don\'t stand close.' },
  { id: 'nuke', name: 'Nuke', price: 12000, qty: 1, tier: 2, kind: 'missile', radius: 75, damage: 160, nuke: true, color: '#ffe066', info: 'Flattens half the map. Blinding flash included.' },
  { id: 'leapfrog', name: 'LeapFrog', price: 10000, qty: 2, tier: 2, kind: 'leapfrog', radius: 20, damage: 55, bounces: 3, color: '#7CFC00' },
  { id: 'funky_bomb', name: 'Funky Bomb', price: 7000, qty: 2, tier: 3, kind: 'funky', radius: 25, damage: 55, count: 8, childRadius: 17, childDamage: 45, color: '#ff66ff' },
  { id: 'mirv', name: 'MIRV', price: 10000, qty: 3, tier: 3, kind: 'mirv', count: 5, spread: 38, radius: 20, damage: 60, color: '#66ccff' },
  { id: 'deaths_head', name: "Death's Head", price: 20000, qty: 1, tier: 4, kind: 'mirv', count: 9, spread: 42, radius: 35, damage: 85, color: '#ff4444' },
  { id: 'napalm', name: 'Napalm', price: 10000, qty: 10, tier: 2, kind: 'napalm', particles: 90, life: 4, dps: 0.9, color: '#ff8800' },
  { id: 'hot_napalm', name: 'Hot Napalm', price: 20000, qty: 2, tier: 3, kind: 'napalm', particles: 160, life: 6, dps: 1.4, hot: true, color: '#ff3300' },
  { id: 'tracer', name: 'Tracer', price: 10, qty: 20, tier: 0, kind: 'tracer', color: '#ccc' },
  { id: 'smoke_tracer', name: 'Smoke Tracer', price: 500, qty: 10, tier: 0, kind: 'tracer', smoke: true, color: '#aaa' },
  { id: 'baby_roller', name: 'Baby Roller', price: 5000, qty: 10, tier: 1, kind: 'roller', radius: 10, damage: 40, color: '#ddd' },
  { id: 'roller', name: 'Roller', price: 6000, qty: 5, tier: 1, kind: 'roller', radius: 20, damage: 65, color: '#ddd' },
  { id: 'heavy_roller', name: 'Heavy Roller', price: 6750, qty: 2, tier: 2, kind: 'roller', radius: 40, damage: 100, color: '#ddd' },
  { id: 'riot_charge', name: 'Riot Charge', price: 2000, qty: 10, tier: 0, kind: 'riotcharge', range: 40, spread: 28, color: '#9cf' },
  { id: 'riot_blast', name: 'Riot Blast', price: 5000, qty: 5, tier: 1, kind: 'riotcharge', range: 75, spread: 32, color: '#9cf' },
  { id: 'riot_bomb', name: 'Riot Bomb', price: 5000, qty: 5, tier: 1, kind: 'riotbomb', radius: 30, color: '#9cf' },
  { id: 'heavy_riot_bomb', name: 'Heavy Riot Bomb', price: 4750, qty: 2, tier: 2, kind: 'riotbomb', radius: 50, color: '#9cf' },
  { id: 'baby_digger', name: 'Baby Digger', price: 3000, qty: 10, tier: 0, kind: 'digger', length: 45, width: 4, count: 1, color: '#c96' },
  { id: 'digger', name: 'Digger', price: 2500, qty: 5, tier: 1, kind: 'digger', length: 80, width: 5, count: 2, color: '#c96' },
  { id: 'heavy_digger', name: 'Heavy Digger', price: 6750, qty: 2, tier: 2, kind: 'digger', length: 120, width: 7, count: 3, color: '#c96' },
  { id: 'baby_sandhog', name: 'Baby Sandhog', price: 10000, qty: 10, tier: 2, kind: 'sandhog', count: 1, length: 55, radius: 14, damage: 45, color: '#fc6' },
  { id: 'sandhog', name: 'Sandhog', price: 16750, qty: 5, tier: 3, kind: 'sandhog', count: 3, length: 70, radius: 18, damage: 55, color: '#fc6' },
  { id: 'heavy_sandhog', name: 'Heavy Sandhog', price: 25000, qty: 2, tier: 4, kind: 'sandhog', count: 5, length: 90, radius: 24, damage: 70, color: '#fc6' },
  { id: 'dirt_clod', name: 'Dirt Clod', price: 5000, qty: 10, tier: 0, kind: 'dirt', radius: 15, color: '#a0522d' },
  { id: 'dirt_ball', name: 'Dirt Ball', price: 5000, qty: 5, tier: 1, kind: 'dirt', radius: 25, color: '#a0522d' },
  { id: 'ton_of_dirt', name: 'Ton of Dirt', price: 6750, qty: 2, tier: 2, kind: 'dirt', radius: 40, color: '#a0522d' },
  { id: 'liquid_dirt', name: 'Liquid Dirt', price: 5000, qty: 10, tier: 2, kind: 'liquiddirt', amount: 1600, color: '#8b5a2b' },
  { id: 'dirt_charge', name: 'Dirt Charge', price: 5000, qty: 5, tier: 1, kind: 'dirtcharge', range: 55, spread: 30, color: '#a0522d' },
  { id: 'earth_disrupter', name: 'Earth Disrupter', price: 5000, qty: 10, tier: 1, kind: 'disrupter', color: '#0ff' },
  { id: 'plasma_blast', name: 'Plasma Blast', price: 9000, qty: 5, tier: 3, kind: 'plasma', color: '#f0f' },
  { id: 'laser', name: 'Laser', price: 5000, qty: 5, tier: 3, kind: 'laser', color: '#f33' },
];

const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// Weapons that don't launch a shell.
const DIRECT_KINDS = new Set(['riotcharge', 'dirtcharge', 'plasma', 'laser']);

const WEAPON_INFO = {
  missile: 'Standard explosive shell.',
  leapfrog: 'Bounces forward, exploding three times.',
  funky: 'Bursts into a shower of bomblets.',
  mirv: 'Splits into several warheads at the top of its arc.',
  napalm: 'Burning jelly that runs downhill and roasts tanks.',
  tracer: 'Harmless — shows where a shot lands.',
  roller: 'Rolls downhill until it hits a tank or a wall of dirt.',
  riotcharge: 'Blasts dirt away from your turret. No damage.',
  riotbomb: 'Clears a big hole of dirt. No damage.',
  digger: 'Tunnels through the ground.',
  sandhog: 'Tunnels, then explodes underground.',
  dirt: 'Dumps a ball of dirt — bury your enemies.',
  liquiddirt: 'Dirt that flows and fills valleys.',
  dirtcharge: 'Sprays dirt in front of your turret.',
  disrupter: 'Makes all floating dirt collapse.',
  plasma: 'Energy burst around your tank. Power = size.',
  laser: 'Instant beam that cuts through everything.',
};

// ---- Accessories -----------------------------------------------------------
const ITEMS = [
  { id: 'parachute', name: 'Parachute', price: 10000, qty: 8, tier: 0, kind: 'parachute', info: 'Deploys automatically to stop fall damage.' },
  { id: 'battery', name: 'Battery', price: 5000, qty: 10, tier: 0, kind: 'battery', info: 'Restores 10 health (and max power).' },
  { id: 'fuel_tank', name: 'Fuel Tank', price: 10000, qty: 10, tier: 1, kind: 'fuel', info: 'Lets you drive. Each tank = 10 px.' },
  { id: 'contact_trigger', name: 'Contact Trigger', price: 1000, qty: 25, tier: 1, kind: 'trigger', info: 'Rollers, diggers & leapfrogs explode on first contact.' },
  { id: 'mag_deflector', name: 'Mag Deflector', price: 10000, qty: 2, tier: 1, kind: 'shield', hp: 40, mag: 1, info: 'Weak shield that repels incoming shells.' },
  { id: 'shield', name: 'Shield', price: 20000, qty: 3, tier: 1, kind: 'shield', hp: 55, info: 'Absorbs 55 damage.' },
  { id: 'force_shield', name: 'Force Shield', price: 25000, qty: 3, tier: 2, kind: 'shield', hp: 100, deflect: true, info: 'Absorbs 100 damage and bounces shells away.' },
  { id: 'heavy_shield', name: 'Heavy Shield', price: 30000, qty: 2, tier: 3, kind: 'shield', hp: 150, info: 'Absorbs 150 damage.' },
  { id: 'super_mag', name: 'Super Mag', price: 40000, qty: 2, tier: 4, kind: 'shield', hp: 80, mag: 2.6, info: 'Strong shield that hurls shells aside.' },
  { id: 'heat_guidance', name: 'Heat Guidance', price: 10000, qty: 6, tier: 2, kind: 'guidance', mode: 'heat', info: 'Shell homes in when it gets close to the target.' },
  { id: 'ballistic_guidance', name: 'Ballistic Guidance', price: 10000, qty: 2, tier: 2, kind: 'guidance', mode: 'ballistic', info: 'Shell ignores wind.' },
  { id: 'horz_guidance', name: 'Horizontal Guidance', price: 15000, qty: 5, tier: 3, kind: 'guidance', mode: 'horizontal', info: 'At the target’s height, flies straight at it.' },
  { id: 'vert_guidance', name: 'Vertical Guidance', price: 20000, qty: 5, tier: 3, kind: 'guidance', mode: 'vertical', info: 'Above the target, drops straight down.' },
  { id: 'lazy_boy', name: 'Lazy Boy', price: 20000, qty: 2, tier: 4, kind: 'guidance', mode: 'lazyboy', info: 'Aims your shot for you.' },
];

const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const SHIELD_IDS = ITEMS.filter((i) => i.kind === 'shield').map((i) => i.id);
const SHIELD_COLORS = {
  mag_deflector: '#66aaff',
  shield: '#ffffff',
  force_shield: '#ffff66',
  heavy_shield: '#ff66ff',
  super_mag: '#66ffff',
};

// ---- Computer players ------------------------------------------------------
// errA/errP: aiming error std-dev (degrees / power). wind: whether it accounts
// for wind. learn: tightens its aim on repeat shots at the same target.
const AI_TYPES = {
  moron: { name: 'Moron', errA: 22, errP: 220, wind: false, buy: 0.3 },
  shooter: { name: 'Shooter', errA: 6, errP: 80, wind: false, buy: 0.6 },
  poolshark: { name: 'Poolshark', errA: 4, errP: 55, wind: true, buy: 0.7 },
  tosser: { name: 'Tosser', errA: 12, errP: 150, wind: true, learn: true, buy: 0.7 },
  chooser: { name: 'Chooser', errA: 3, errP: 35, wind: true, smart: true, buy: 0.8 },
  spoiler: { name: 'Spoiler', errA: 1.6, errP: 20, wind: true, smart: true, buy: 0.85 },
  cyborg: { name: 'Cyborg', errA: 1, errP: 12, wind: true, smart: true, vindictive: true, buy: 0.9 },
};
const AI_KEYS = Object.keys(AI_TYPES);

const PLAYER_COLORS = ['#ff4b3e', '#3e8bff', '#43d14a', '#ffd23e', '#e055ff', '#3ee6e0', '#ff9a3e', '#f2f2f2', '#9a6bff', '#b7ff3e'];

const CPU_NAMES = [
  'Patton', 'Rommel', 'Monty', 'Sherman', 'Bradley', 'Zhukov', 'Guderian', 'Abrams', 'Ike', 'Napoleon',
  'Sun Tzu', 'Custer', 'Grant', 'Lee', 'Nelson', 'Hannibal', 'Caesar', 'Wellington', 'Halsey', 'Nimitz',
];

const FIRE_QUOTES = [
  'Eat this!', 'Incoming!', 'Fire in the hole!', 'Special delivery!', 'Catch!', 'Duck!', 'Bombs away!',
  'Say cheese!', 'This one has your name on it.', 'Nothing personal.', 'Boom goes the dynamite.',
  'Hold still...', 'Return to sender!', 'Have a nice day!', 'Ka-BLAM!', 'Gotcha now!', 'Here\'s a present!',
  'Read it and weep.', 'Air mail!', 'Taste the rainbow!', 'Knock knock.', 'I aim to please.',
];

const DEATH_QUOTES = [
  'I\'ll be back...', 'Tell my turret I loved it.', 'Not like this!', 'Ow.', 'Rosebud...', 'Avenge me!',
  'I regret nothing!', 'Is it hot in here?', 'Well, that happened.', 'Curse you!', 'My warranty!',
  'Was it something I said?', 'Medic!', 'Lucky shot!', 'Goodbye, cruel world!', 'Et tu?', 'I see the light...',
  'That was my good tread!', 'Game over, man!', 'Remember me...', 'Not the face!', 'Totally meant to do that.',
];

const HIT_QUOTES = ['Ouch!', 'Hey!', 'Watch it!', 'That stings!', 'Rude!', 'You\'ll pay for that!', 'Missed me! ...wait.'];

// ---- Scenery -----------------------------------------------------------------
const THEMES = [
  { name: 'Meadow', sky: [[24, 60, 160], [90, 150, 230], [190, 220, 255]], ground: [[86, 180, 64], [120, 88, 46], [72, 48, 30]], grass: [120, 220, 80] },
  { name: 'Dusk', sky: [[30, 14, 70], [150, 60, 110], [255, 150, 70]], ground: [[226, 186, 110], [178, 118, 62], [104, 58, 30]] },
  { name: 'Night', sky: [[0, 0, 12], [6, 10, 40], [24, 34, 90]], ground: [[110, 110, 135], [70, 70, 95], [32, 32, 48]], stars: true },
  { name: 'Arctic', sky: [[90, 140, 200], [170, 205, 235], [235, 245, 255]], ground: [[245, 248, 255], [170, 190, 215], [80, 100, 135]] },
  { name: 'Mars', sky: [[50, 14, 8], [140, 60, 36], [220, 130, 80]], ground: [[200, 92, 46], [140, 56, 30], [70, 26, 14]] },
  { name: 'Alien', sky: [[6, 0, 24], [40, 8, 70], [110, 30, 140]], ground: [[70, 230, 150], [36, 130, 120], [20, 50, 76]], stars: true },
  { name: 'Classic', sky: [[0, 0, 0], [0, 0, 70], [40, 40, 170]], ground: [[180, 180, 180], [120, 120, 120], [60, 60, 60]], stars: true },
];

const TERRAIN_TYPES = ['rolling', 'mountains', 'plains', 'rugged', 'canyons'];
const WALL_TYPES = ['none', 'wrap', 'padded', 'rubber', 'spring', 'concrete'];

const WALL_LABELS = {
  none: 'None', wrap: 'Wrap-around', padded: 'Padded', rubber: 'Rubber', spring: 'Spring', concrete: 'Concrete', random: 'Random',
};

const DEFAULT_SETTINGS = {
  rounds: 10,
  startCash: 25000,
  interest: 5,
  gravity: 1,
  wind: 60,
  changingWind: false,
  walls: 'random',
  terrain: 'random',
  theme: 'random',
  armsLevel: 4,
  talking: true,
  fallingDirt: true,
  hpBars: true,
  speed: 1,
  turnMode: 'sequential',
  gusts: 0,
  stalemate: 8, // full turns without damage before a round is drawn; 0 = never
};

const DEFAULT_PLAYERS = [
  { name: 'You', type: 'human' },
  { name: 'Patton', type: 'shooter' },
  { name: 'Rommel', type: 'poolshark' },
  { name: 'Zhukov', type: 'chooser' },
];

// ---- Economy -----------------------------------------------------------------
const ECON = {
  damageCash: 40, // per hp dealt to an enemy
  killCash: 4000,
  winCash: 10000,
  surviveCash: 2000,
  killScore: 250,
  winScore: 500,
  sellRate: 0.8,
};

// ---- Physics -----------------------------------------------------------------
const PHYS = {
  W: 800,
  gravity: 300, // px/s^2 at gravity 1.0
  powerScale: 0.6, // px/s per power point
  windScale: 0.55, // px/s^2 per wind unit
  maxPower: 1000,
  tankHalfW: 7,
  tankH: 8,
  tankR: 8,
  shieldR: 17,
  barrel: 11,
  tick: 1 / 60,
};
