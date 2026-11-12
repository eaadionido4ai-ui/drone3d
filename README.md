# DRONE 3D

**Drones for disaster risk reduction and management: the mobile game**

DRONE 3D is the phone version of [DRONE VR](https://github.com/eaadionido4ai-ui/droneVR). It needs no headset:
it runs in the phone's browser, installs on the home screen like an app (a progressive web app), and plays
offline. The player is the drone operator of a riverside barangay's emergency operations center. After a flight
school, they fly three missions, one for each use of drones in a disaster: **BANTAY**, watching for hazards after
an earthquake (environmental safety); **SAGIP**, finding people stranded by a flood (search and rescue); and
**HATID**, carrying relief to places cut off by a typhoon (logistics).

It is DRONE VR's game: the same barangay, built from the same plan; the same rules for the drone, the
autopilot, the wind, the flood, the falling packages and the rescue boats; the same missions, texts (in English
and Filipino) and scores. The rules are DRONE VR's C# rules written again in JavaScript, and the tests fly DRONE
VR's recorded flights step by step to show that they agree.

> 🧪 Version 0.1.0, for review. The rules pass their tests, and the game has been played in a phone-sized
> browser window (Chromium, with touch emulated). It has **not yet been played on a real phone** (see
> [What has been checked](#what-has-been-checked)).

## The missions

| Mission | Use of drones | The incident | Weather | What to do |
|---|---|---|---|---|
| **LIPAD** | flight school | a calm morning | 1.5 m/s | take off, fly through six rings in order, land on the pad |
| **BANTAY** | environmental safety | just after a strong earthquake | 3 m/s | find the seven hazards near the places the residents reported (a fire, a fallen power line, a crack in the bridge, a landslide, a fuel spill, a leaning water tower, debris damming the creek), and photograph each one from a safe distance |
| **SAGIP** | search and rescue | the river over its banks, still rising (2.2 m to 2.8 m) | 5 m/s, rain | find the eight groups of people (18 in all) and mark them: a rescue boat goes to each one marked. Some are hidden under roofs and trees: the thermal camera finds them, from close. One man is in fast water: a boat can reach him only after the drone drops him a life ring |
| **HATID** | logistics | after a typhoon: the bridge is out, streets are blocked | 9 m/s, gusty | carry what four places asked for (the evacuation center, the sitio across the river, the health center, a family on a roof) and drop it on the mark: 8 kg at most on three hooks, from below 4 m, aiming against the wind |

The drone flies as a GPS-stabilized drone does: let go of the sticks and it holds its place, leaning into the
wind by itself. A load makes it slower and drains the battery faster; a battery hovers seven minutes. It breaks
on a hard hit or a hard landing, and is lost in water; a spare is on the pad five seconds later. On the pad the
battery is changed in four seconds. It never flies higher than 120 m, the 400 feet of the CAAP's rules for drones.

A mission's report gives up to three stars from a score out of 100: the task itself (70), flying safely (18) and
time (12). After BANTAY, the report also says what the barangay will do about each hazard photographed.

## Three ways to fly

The briefing of each mission asks how to fly it:

- **Command Desk.** The map of the barangay fills the screen, with the operator's panel beside it. Tap the map to
  put a waypoint (the panel sets its height). Over a place that asked for supplies the drone will come down and
  drop; on the hazard patrol it stops to look; near a ring of the flight school it goes through the middle. The
  panel says what the route will cost in metres, time and battery. Hang the supplies on the drone (tap them, or
  drag them onto the hooks), press **Launch**, and watch: on the map, through the drone's camera, or from behind
  it. The autopilot comes home by itself when the battery would not last.
- **FPV Pilot.** Fly the drone yourself with two thumbs, through its camera or from just behind it.
- **Hybrid.** Plan the route on the map and let the autopilot fly it; **take the sticks** when it matters (a
  small roof in the wind, a hidden family, a sharp photograph), then **hand them back**: the autopilot goes on
  with the route from where the drone is.

The autopilot does not see obstacles, frames hazards less sharply than a pilot, drops from straight above the
mark, and finds hidden people only when the route passes low over them. A well-planned route earns two or three
stars on its own; the best results need a pilot.

## Controls

On a phone held sideways:

| | |
|---|---|
| Left thumb | up and down: climb and descend; left and right: turn |
| Right thumb | up and down: forward and back; left and right: sideways |
| Let go | the drone hovers where it is |
| Drag the picture (above the sticks) | tilt the drone's camera up or down |
| **Photo** / **Mark** / **Drop** | the camera's button: photograph a hazard, mark the people in the middle of the picture, or drop a package |
| **Thermal** | the thermal camera (SAGIP) |
| **Map**, **Camera**, **Behind** | the map, the drone's camera, or the view from behind the drone |
| The round map | tap it to open the map |
| On the map | tap to put a waypoint; drag to move the map, pinch to zoom, turn it with two fingers |

The sticks appear wherever the thumbs touch the lower part of the screen. The compass at the top shows the way to
the pad (H) and to what to fly to next.

On a computer: **W S** forward and back, **A D** sideways, **Q E** turn, **R F** up and down (**Shift** for small
moves), **Space** the camera's button, **G** drop, **T** thermal camera, **Z X** tilt the camera, **V** change the
view, **M** the map, **H** take the sticks or hand them back (Hybrid), **Esc** pause. A click on the map puts a
waypoint.

## Playing it on a phone

The game is a set of files that any web server can serve over HTTPS. The repository publishes it on GitHub
Pages:

1. In the repository's **Settings > Pages > Build and deployment**, set **Source** to **GitHub Actions** (once).
2. In **Actions > pages**, press **Run workflow** (it also runs by itself on every push to `main`).
3. Open the address it gives (`https://<owner>.github.io/drone3d/`) on the phone.
4. Install it: on Android in Chrome, **Install app** (or the **Install** button on the title screen); on an
   iPhone in Safari, **Share > Add to Home Screen**. From then on it opens full screen and plays without a
   connection. It saves nothing anywhere but on the phone: the language, the sound and each mission's best result.

To try it from a computer on the same network: `npm run dev`, then open the address it prints on the phone
(a phone keeps a game for offline play only from an HTTPS address, so installing needs GitHub Pages or another
HTTPS server).

## Running it from the code

Node.js 20.19 or newer (Vite 7 needs it):

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run preview
```

`npm run dev` serves the game for development (also to phones on the same network); `npm test` runs the rules'
and missions' tests; `npm run build` writes the game to `dist/`, with its service worker; `npm run preview` serves
`dist/` as a phone would get it.

## How it is put together

```
index.html             the page
src/main.js            the start: the font, the styles, the game, the service worker
src/app.js             the screens, the mission being flown, and the loop that draws each frame
src/core/              the rules, with no drawing in them (DRONE VR's DroneVR.Core, in JavaScript)
  plan.js              the barangay's plan: DRONE VR's, unchanged
  world.js             what the rules know of the barangay, made from the plan
  rules.js             the town's solid parts, the wind, the flood, the drone's flight, the falling packages
  autopilot.js         the autopilot that flies a route drawn on the map
  missions.js          LIPAD, BANTAY, SAGIP, HATID, and the rescue boats
  flight.js            a mission being flown in one of the three ways; the player's record
  routes.js            the boats' ways through the flood (written by scripts/gen-routes.mjs)
  text.js              every text, in English and Filipino
src/world/             the 3D world, in three.js
  kit.js, town.js      DRONE VR's builders of the barangay
  props.js             the drone, the supplies, the people, the boat, the rings
  bake.js              joins the barangay's thousands of pieces into a dozen meshes, so a phone draws it fast
  scene.js             the sky, the water, the mission's objects, the drone, the route, the cameras
src/ui/                the instruments: hud.js (the top bar, the radio, the panel, the labels), sticks.js,
                       minimap.js (the round map and the compass), sound.js (made by the phone, nothing to
                       download), text.js, store.js
public/                the manifest and the icons
sw-template.js         the service worker; the build writes dist/sw.js with the list of the game's files
scripts/               gen-routes.mjs (the boats' ways), make-icons.py (the icons; needs Pillow)
test/                  the tests, with DRONE VR's recorded flights and ground heights in test/data
```

The barangay is built when the game starts (about a quarter of a second on a computer), not downloaded. The
whole game is about 1.2 MB; its code is 950 kB (260 kB compressed), mostly three.js.

What DRONE 3D leaves out of DRONE VR: the headset and the room of the operations center (its map table, big
screen and loading dock become the screen's map, views and panel), the link to GAMA (the weather, the flood and
the boats run on the phone, as DRONE VR does without GAMA), and flying as a class.

## What has been checked

| Check | How | Result |
|---|---|---|
| The rules and the missions | `npm test`: the ground, the town in each mission, the weather, the flight, the falling packages, each mission flown from the map, by a pilot (a small program at the sticks) and in Hybrid, the scores, the record kept on the phone, the texts in both languages | 17 tests pass |
| The drone flies as DRONE VR's does | the tests fly DRONE VR's six recorded flights (from its Python reference, which its C# rules also match), step by step | pass, to 1e-7 m |
| Playing in a phone-sized window | Chromium with WebGL in software, through Playwright: 844×390 and 667×375 with touch, 1280×720 with the keys. The menus; flying with two thumbs; the map and its waypoints; a delivery from the desk to the roof; marking with the thermal camera; a photograph in Hybrid; pause and the report | works, no errors |
| Installable and offline | the built game: the manifest and icons, the service worker keeps every file; offline, the game opens again and a mission starts | works |
| **On real phones** | an iPhone (Safari), Android phones (Chrome), including a low-end one: speed, the sticks under real thumbs, sound, vibration, installing | **not done yet** |

So the first thing to do is to publish it (see [Playing it on a phone](#playing-it-on-a-phone)) and play it on a
few phones. Please report what does not work, and how fast it runs.

## Credits

DRONE 3D was conceptualized by the author of DRONE VR and TANGHALAN VR, and built with AI assistance (Claude),
from DRONE VR.

Built with three.js (threejs.org, MIT license) and Vite (MIT license). The font is Nunito (SIL Open Font
License 1.1), through Fontsource.

## License

No license has been chosen for DRONE 3D's own content and code, so all rights are reserved by the author for now,
as for DRONE VR. three.js, Vite and the Nunito font keep their own licenses.
