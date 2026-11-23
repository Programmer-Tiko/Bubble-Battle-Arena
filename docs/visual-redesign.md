# Anime chibi visual redesign

The arena art is original and generated locally by `frontend/src/art.ts` as cached canvas textures. The Phaser renderer reuses image objects for tiles, characters, items, bombs, splashes, and the supply balloon. Character poses, team rings, status transitions, and pickup effects are presentation only; movement, collisions, and game decisions still come from engine snapshots.

Bombs and placed items use `(tile + 0.5) * tileSize` for their visual centres. The normal bomb render model deliberately omits the fuse duration; the existing engine and bot hazard predictor retain it. Explicitly enabled development Bot Debug continues to show predicted hazard timing. The existing multiplayer snapshot contract still carries bomb fuse values, so this is a display change, not protection against a client inspecting network traffic.

The existing engine selects locations and creates supply items in the same simulation step. The gold landing rings therefore mark **already-created authoritative drops** for three seconds after the server event, disappearing sooner if the corresponding item is removed. They are not advance warning. All clients derive the same marker positions and lifetime from the event's `supplyDroppedAt` and snapshot time; a late join during that window sees the same current state. A true pre-drop warning would require the server to select or reserve locations earlier, potentially changing which tiles qualify, and is not implemented here.

Permanent upgrades remain engine stats and appear in Character Stats; only banana and slowdown charges appear in the five active-item slots. The default development server uses the engine's default initial bomb capacity and range.

Screenshots below include a local baseline, the redesigned local arena, a placed bomb, and a multiplayer supply event. The supply screenshot uses a development test fixture that advanced the existing server simulation to its scheduled supply event. The loadout screenshot uses a fixture that placed pickups on the player's starting tile; the engine then collected them normally. Neither fixture introduces a production endpoint or a new game rule.

- [Before](screenshots/visual-before.png)
- [Redesigned arena](screenshots/visual-after.png)
- [Placed water balloon](screenshots/visual-bomb.png)
- [Splash and trapped state](screenshots/visual-effects.png)
- [Authoritative supply landing markers](screenshots/visual-supply.png)
- [Permanent stats and active-item inventory](screenshots/visual-loadout.png)
