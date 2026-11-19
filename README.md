# THE LISTENER — Blind Monster Survival

A first-person horror game built in Astro + Three.js. One player becomes **The Listener**, a blind
monster that hunts by sound. Everyone else has to finish a silent objective and get out before it
finds them.

Everything is generated at runtime: the six maps, the props, the sound design (procedural WebAudio),
and the sonar rendering. There are no image or audio assets and no backend.

## Play

```sh
npm install
npm run dev      # http://localhost:4321
```

Open the page, type a username, pick an outfit and a perk, join a room and launch. The **Wheel of
Fate** picks one player to become The Listener.

- **PRACTICE AS THE LISTENER** skips the wheel and puts you straight into the monster.
- Rooms and players are simulated locally with bots; there is no networking layer.

## Controls

**Survivor**

| Key | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Look (click to lock the pointer) |
| `Shift` | Sprint — drains stamina, makes noise |
| `C` | Toggle crouch — slow, quiet, builds leg fatigue |
| `Space` (hold) | Hold breath — silent, but your lungs run out |
| `E` (hold) | Work an objective / escape |
| `F` | Flashlight (light is safe; the click is not) |
| `Q` | Throw a bottle to lure the monster |
| `G` | Drop a glowstick (restores sanity) |
| `1` | Wrap boots in cloth (quieter steps) |
| `2` | Drink water (sanity + breath) |
| `Esc` | Pause / abandon run |

**The Listener**

| Key | Action |
| --- | --- |
| `WASD` / Mouse | Move / look |
| `LMB` or `E` | Echolocation click — paints the room in sonar rings |
| `Shift` (hold) | Hyper-focus — slow crawl, much wider hearing |
| `R` | Seismic slam — knocks standing survivors off balance |
| `F` | Predator lunge — burst toward a sound |

## Systems

- **Sound ecology** — every surface has its own footstep acoustics: shattered glass, cans and
  wrappers, creaking wood, gravel, water, corn, metal grating. Crouching, cloth-wrapped boots and the
  Light-Footed perk reduce the noise you emit.
- **Breathing** — panic breathing emits small ripples. Holding breath cuts it to zero for 8–12
  seconds; running out forces a loud gasp. Releasing early is a silent exhale.
- **Stamina** — sprinting and vaulting drain it; running dry leaves you panting loudly. Crouch-walking
  builds leg fatigue and makes your boots drag.
- **Sanity** — darkness, the monster's proximity and its clicks drain it. Low sanity brings darting
  shadows, phantom clicks and crinkles, flashlight flicker and uncontrollable whimpers. Glowsticks,
  water and standing with another survivor restore it.
- **Perks** — Light-Footed, Steady Nerves, Tinkerer, Quartermaster.
- **Maps** — six locations with their own palette, weather, props, hazards and three-step objective.
- **The Listener** — sonar vision driven by a custom shader, echo pulses, hyper-focus, slam, lunge,
  wall-tracking body animation and a head-snap toward new sounds.
- **Post-match sound map** — a top-down replay of every ripple, trail and close approach.

## Code map

```
src/pages/index.astro      lobby / HUD / wheel / replay markup + styles
src/game/main.ts           screens, matchmaking, wheel, progression, match lifecycle
src/game/match.ts          game loop, survivor systems, monster control, bots, HUD
src/game/world.ts          map carving, props, hazards, objectives, lighting
src/game/maps.ts           the six map blueprints and surface definitions
src/game/monster.ts        AI hunter (hearing, pathfinding, abilities)
src/game/sonar.ts          echolocation shader patch + pulses
src/game/audio.ts          procedural WebAudio engine
src/game/replay.ts         post-match sound-map renderer
src/game/path.ts           A* grid pathfinding
src/game/types.ts          shared types, perks, outfits
```

## Notes

- Desktop + mouse is required; the game uses pointer lock and keyboard input.
- Audio starts on your first click (browser autoplay policy).
- **Live mic detection** is optional and off by default. If enabled, real gasps or whispers picked up
  by your microphone become sound spikes in the match.
- Built as a stylised-realistic prototype of the design document: one local session with bots, not a
  networked 10-player server.
