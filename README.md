# vibe-games: Kestrel

A realistic browser-based tactical shooter prototype built with Three.js. **Stage 1** is a live-fire training range: six weapons, reactive steel targets from 10 m to 300 m, and photo-scanned environments.

## Run it

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173). The first run downloads about 120 MB of free (CC0) textures, sky and props from [Poly Haven](https://polyhaven.com) into `public/assets/`. That folder is git-ignored, so each computer downloads it once.

## Maps

| Map | Mode | What you do |
|---|---|---|
| **Kestrel Range** | Practice | Steel targets from 10 m to 300 m, a moving target and a plate rack |
| **Rimba Basin** | Combat | An original rainforest valley: a river with a rope bridge and a shallow ford, a stilt-hut village, a mercenary camp and a supply landing. Kill every mercenary to clear the area. |

Choose the map on the main menu. For combat you can also set the **number of enemies (1–25)** and **difficulty**:
- **Recruit:** slow reactions, poor aim.
- **Regular:** the default.
- **Veteran:** fast and accurate.

### How the enemies behave
- **Patrol:** they walk the estate.
- **Detection:** they hear your gunshots and running footsteps, and spot you gradually. Spotting is faster up close, when you move, and if they're already alert.
- **Combat:** they react, fire in bursts with realistic inaccuracy, side-step, and fall back to cover when hurt.
- **Hunting:** they search where they last saw you.

You regenerate health after 5 seconds without taking damage. Grenades hurt them, and you.

## Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look |
| LMB / RMB | Fire / aim down sights |
| 1–6, wheel, Q | Switch weapon (Q = last weapon) |
| Tab | Armory (pick a weapon) |
| R | Reload |
| V | Fire mode (auto / semi) |
| Shift (or C) | Crouch |
| W | Forward, sprints automatically (slows when aiming, crouching or firing) |
| Space | Jump, or hold your breath while scoped |
| G | Switch to grenade, then left click = throw, right click = short lob (hold the button to cook the fuse, release to throw). G again puts it away. |
| T | Restock ammo and grenades |
| Esc | Pause / settings |

## Weapons (all original designs)

Vex P9 pistol · Hornet MX SMG · Talon AR-7 rifle · Brute 12 pump shotgun · Halcyon LR-338 bolt-action sniper · Anvil LMG-90 machine gun.

Weapon behaviour:
- Recoil follows a learnable pattern, and the view recovers after you stop firing.
- Spread grows when you move, jump or keep firing, and shrinks when you crouch or aim.
- Damage drops off with distance; headshots deal extra damage.
- Bullets go through thin wood and plastic.
- The sniper has scope sway and hold-breath.
- The bolt-action and pump guns cycle their actions, and spent brass ejects and bounces.
- The steel ring from a distant target arrives late, at the speed of sound.

## Graphics quality: how "Auto" works

`src/quality.js` uses two layers:

1. **First guess:** reads the GPU name the browser reports, plus CPU threads and RAM, to pick a starting tier and texture resolution. For example, integrated AMD/Intel graphics starts at Medium and an RTX card starts at Ultra.
2. **Live tuning while you play:**
   - **Dynamic resolution** (every 0.5 s): renders fewer pixels when frames are slow, down to a floor for each tier.
   - **Tier changes:** if it is still too slow at that floor, it drops a whole tier (shadows, AO, grass, bloom, anti-aliasing). If everything is smooth, it tries the tier above. If that fails, it reverts and waits progressively longer before trying again, so it never flip-flops.
   - **GPU timer:** when the browser exposes a GPU timer, real GPU milliseconds are used to detect spare capacity.

You can override this in **Esc → Graphics**, with fixed Low/Medium/High/Ultra, a target FPS, and an FPS overlay.

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Max pixel ratio | 0.85 | 1.0 | 1.5 | 2.0 |
| Shadows | 1024, 45 m | 2048, 70 m | 2048, 100 m | 4096, 140 m |
| Ambient occlusion | – | – | half-res | full |
| Bloom | – | ✓ | ✓ | ✓ |
| Anti-aliasing | FXAA | FXAA | SMAA | MSAA 4× + SMAA |
| Grass density | 0 | 35 % | 70 % | 100 % |
| Textures | 1k | 1k | 2k | 2k |

## Code map

- `src/main.js`: boot, game loop, menus
- `src/quality.js`: presets, hardware detection, auto governor
- `src/pipeline.js`: renderer and post-processing chain
- `src/world.js`, `environment.js`, `grass.js`: range, sky/sun, vegetation
- `src/weapons/`: weapon data, procedural models, firing/recoil/reload logic
- `src/effects.js`, `targets.js`, `audio.js`, `hud.js`, `player.js`
