// Weapon definitions. All names and designs are original to this game.
//
// spread  – cone half-angle in degrees (hip base, multipliers for movement/air/ADS,
//           bloom added per shot, bloom cap, bloom recovery per second)
// recoil  – degrees of camera kick per shot (vertical, horizontal wander),
//           how fast the view recovers, and the viewmodel punch
// falloff – damage multiplier drops linearly from `start` to `end` metres down to `min`

export const WEAPONS = [
  {
    id: 'pistol', key: 'Digit1', name: 'Vex P9', class: 'Pistol', caliber: '9 mm',
    damage: 32, headMult: 3.2, pellets: 1, rpm: 420, auto: false, modes: ['semi'],
    mag: 15, reserve: 75, reload: 1.55, reloadEmpty: 1.9, pen: 0.6,
    spread: { base: 0.55, move: 2.4, air: 6, crouch: 0.75, ads: 0.35, bloom: 0.55, bloomMax: 3.2, recover: 7 },
    recoil: { v: 1.25, h: 0.35, recover: 10, kickZ: 0.06, kickRot: 0.22 },
    falloff: { start: 15, end: 45, min: 0.6 },
    mobility: 1.0, adsFov: 64, adsTime: 0.15, sight: 'iron', tracerEvery: 0, drawTime: 0.35,
    sound: { loud: 0.75, body: 0.12, bodyFreq: 2600, thump: 110, mech: 1.0 },
    stats: { damage: 30, rate: 45, accuracy: 62, range: 28, mobility: 98 },
  },
  {
    id: 'smg', key: 'Digit2', name: 'Hornet MX', class: 'Submachine Gun', caliber: '9 mm',
    damage: 25, headMult: 2.6, pellets: 1, rpm: 860, auto: true, modes: ['auto', 'semi'],
    mag: 32, reserve: 128, reload: 2.0, reloadEmpty: 2.45, pen: 0.7,
    spread: { base: 0.95, move: 1.6, air: 5, crouch: 0.75, ads: 0.4, bloom: 0.22, bloomMax: 3.0, recover: 6 },
    recoil: { v: 0.36, h: 0.26, recover: 9, kickZ: 0.025, kickRot: 0.06 },
    falloff: { start: 12, end: 38, min: 0.5 },
    mobility: 0.97, adsFov: 58, adsTime: 0.17, sight: 'reddot', tracerEvery: 0, drawTime: 0.45,
    sound: { loud: 0.7, body: 0.1, bodyFreq: 2200, thump: 95, mech: 1.2 },
    stats: { damage: 24, rate: 92, accuracy: 55, range: 32, mobility: 92 },
  },
  {
    id: 'rifle', key: 'Digit3', name: 'Talon AR-7', class: 'Assault Rifle', caliber: '5.56 mm',
    damage: 34, headMult: 3.8, pellets: 1, rpm: 690, auto: true, modes: ['auto', 'semi'],
    mag: 30, reserve: 120, reload: 2.35, reloadEmpty: 2.9, pen: 1.6,
    spread: { base: 0.6, move: 2.6, air: 7, crouch: 0.7, ads: 0.12, bloom: 0.3, bloomMax: 3.5, recover: 6.5 },
    recoil: { v: 0.5, h: 0.32, recover: 8, kickZ: 0.035, kickRot: 0.09 },
    falloff: { start: 45, end: 140, min: 0.72 },
    mobility: 0.9, adsFov: 50, adsTime: 0.21, sight: 'reddot', tracerEvery: 3, drawTime: 0.55,
    sound: { loud: 0.95, body: 0.14, bodyFreq: 1800, thump: 85, mech: 1.0 },
    stats: { damage: 38, rate: 76, accuracy: 74, range: 72, mobility: 80 },
  },
  {
    id: 'shotgun', key: 'Digit4', name: 'Brute 12', class: 'Shotgun', caliber: '12 gauge',
    damage: 19, headMult: 1.6, pellets: 9, rpm: 72, auto: false, modes: ['pump'],
    mag: 7, reserve: 35, reload: 0.5, reloadEmpty: 0.5, shellReload: true, pen: 0.3,
    spread: { base: 3.6, move: 1.4, air: 2, crouch: 0.9, ads: 0.78, bloom: 0, bloomMax: 0, recover: 6 },
    recoil: { v: 4.2, h: 1.1, recover: 6.5, kickZ: 0.11, kickRot: 0.32 },
    falloff: { start: 7, end: 24, min: 0.18 },
    mobility: 0.93, adsFov: 62, adsTime: 0.2, sight: 'iron', tracerEvery: 0, drawTime: 0.6, pumpTime: 0.55,
    sound: { loud: 1.0, body: 0.22, bodyFreq: 1300, thump: 70, mech: 0.6 },
    stats: { damage: 95, rate: 18, accuracy: 25, range: 15, mobility: 85 },
  },
  {
    id: 'sniper', key: 'Digit5', name: 'Halcyon LR-338', class: 'Sniper Rifle', caliber: '.338',
    damage: 120, headMult: 4, pellets: 1, rpm: 46, auto: false, modes: ['bolt'],
    mag: 5, reserve: 25, reload: 3.0, reloadEmpty: 3.5, pen: 4,
    spread: { base: 7.5, move: 2.2, air: 2, crouch: 0.9, ads: 0.003, bloom: 0, bloomMax: 0, recover: 4 },
    recoil: { v: 4.8, h: 0.7, recover: 4.2, kickZ: 0.13, kickRot: 0.28 },
    falloff: { start: 999, end: 1000, min: 1 },
    mobility: 0.84, adsFov: 7.5, adsTime: 0.32, sight: 'scope', tracerEvery: 1, drawTime: 0.8, boltTime: 1.05,
    sound: { loud: 1.25, body: 0.3, bodyFreq: 1100, thump: 60, mech: 0.3 },
    stats: { damage: 100, rate: 8, accuracy: 98, range: 100, mobility: 62 },
  },
  {
    id: 'lmg', key: 'Digit6', name: 'Anvil LMG-90', class: 'Machine Gun', caliber: '7.62 mm',
    damage: 31, headMult: 3.2, pellets: 1, rpm: 760, auto: true, modes: ['auto'],
    mag: 100, reserve: 200, reload: 5.0, reloadEmpty: 5.6, pen: 2.2,
    spread: { base: 1.15, move: 2.8, air: 8, crouch: 0.6, ads: 0.32, bloom: 0.18, bloomMax: 4.2, recover: 4 },
    recoil: { v: 0.42, h: 0.45, recover: 6, kickZ: 0.03, kickRot: 0.06 },
    falloff: { start: 50, end: 150, min: 0.75 },
    mobility: 0.78, adsFov: 54, adsTime: 0.3, sight: 'iron', tracerEvery: 4, drawTime: 0.95,
    sound: { loud: 1.05, body: 0.17, bodyFreq: 1500, thump: 75, mech: 1.3 },
    stats: { damage: 40, rate: 85, accuracy: 48, range: 70, mobility: 50 },
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
