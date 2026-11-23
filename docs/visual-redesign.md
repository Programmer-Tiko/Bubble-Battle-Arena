# Anime chibi visual redesign

The arena art is original and generated locally by `frontend/src/art.ts` as cached canvas textures. The Phaser renderer reuses image objects for tiles, characters, items, bombs, splashes, and the supply balloon. Character poses, team rings, status transitions, and pickup effects are presentation only; movement, collisions, and game decisions still come from engine snapshots.

Bombs and placed items use `(tile + 0.5) * tileSize` for their visual centres. The normal bomb render model deliberately omits the fuse duration; the existing engine and bot hazard predictor retain it. Explicitly enabled development Bot Debug continues to show predicted hazard timing. The existing multiplayer snapshot contract still carries bomb fuse values, so this is a display change, not protection against a client inspecting network traffic.

The server selects supply locations three seconds before each scheduled event and publishes them in `supplyPreview`. The balloon approaches and gold rings mark those authoritative locations for players, spectators, and late joins. No item is created until the scheduled drop. At landing the server rechecks occupancy, retaining valid announced locations and replacing blocked ones when possible; if fewer than four tiles are free the drop is skipped. If fewer than four tiles are available when the preview begins, locations can instead be selected at landing if space has since opened. Choosing locations earlier can change which tiles qualify compared with the previous behavior. The preview is cleared on landing or match end.

Permanent upgrades remain engine stats and appear in Character Stats; only banana and slowdown charges appear in the five active-item slots. The default development server uses the engine's default initial bomb capacity and range.

Screenshots below include a local baseline, the redesigned local arena, a placed bomb, and a multiplayer supply event. The supply screenshot uses a development test fixture that advanced the server simulation to the advance-warning window. The loadout screenshot uses a fixture that placed pickups on the player's starting tile; the engine then collected them normally. Neither fixture introduces a production endpoint or a new game rule.

- [Before](screenshots/visual-before.png)
- [Redesigned arena](screenshots/visual-after.png)
- [Placed water balloon](screenshots/visual-bomb.png)
- [Splash and trapped state](screenshots/visual-effects.png)
- [Authoritative supply landing markers](screenshots/visual-supply.png)
- [Permanent stats and active-item inventory](screenshots/visual-loadout.png)
