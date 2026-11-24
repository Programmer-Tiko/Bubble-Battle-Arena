# Anime chibi visual redesign

The arena art is original and generated locally by `frontend/src/art.ts` as cached canvas textures. The Phaser renderer reuses image objects for tiles, characters, items, bombs, splashes, and the supply balloon. Character poses, team rings, status transitions, and pickup effects are presentation only; movement, collisions, and game decisions still come from engine snapshots.

Bombs and placed items use `(tile + 0.5) * tileSize` for their visual centres. The normal bomb render model deliberately omits the fuse duration; the existing engine and bot hazard predictor retain it. Explicitly enabled development Bot Debug continues to show predicted hazard timing. Multiplayer join replies and snapshot broadcasts use an explicit public projection that omits bomb fuse values. The engine and server-side bots receive authoritative timing. The explicitly enabled local development debug endpoint can expose predicted hazard timing and must be treated as diagnostic access. Clients can still infer timing from observed bomb placement and known game rules.

The server samples distinct traversable floor tiles uniformly without replacement one second before each scheduled supply event and publishes their coordinates in `supplyPreview`. Indestructible and intact destructible walls are excluded; occupants and danger do not affect selection. Players, spectators, and bots receive the same public preview, with mystery question marks and no item types. Types are selected when the items spawn at the announced positions. Bombs, traps, collectibles, players, and explosions do not cancel or relocate a drop. The existing pickup and explosion rules apply. Stacked item icons cycle at their shared tile centre, with a small stack marker; icons on occupied tiles are smaller and drawn above the other objects. The preview is cleared on landing or match end.

Permanent upgrades remain engine stats and appear in Character Stats; only banana and slowdown charges appear in the five active-item slots. The default development server uses the engine's default initial bomb capacity and range.

Screenshots below include a local baseline, the redesigned local arena, a placed bomb, and a multiplayer supply event. The supply screenshot uses a development test fixture that advanced the server simulation to the advance-warning window. The loadout screenshot uses a fixture that placed pickups on the player's starting tile; the engine then collected them normally. Neither fixture introduces a production endpoint or a new game rule.

- [Before](screenshots/visual-before.png)
- [Redesigned arena](screenshots/visual-after.png)
- [Placed water balloon](screenshots/visual-bomb.png)
- [Splash and trapped state](screenshots/visual-effects.png)
- [Authoritative supply landing markers](screenshots/visual-supply.png)
- [Permanent stats and active-item inventory](screenshots/visual-loadout.png)

## Final QA fixtures

The [eight-player fixture](screenshots/qa-eight-player.png) places eight players and representative items, a bomb, a splash, and a trapped character in a controlled server state. It is not an eight-human playtest. The [bomb overlap fixture](screenshots/qa-bomb-overlap.png) shows a bomb and trap on a player tile; the bomb remains centered and is drawn above the player, with varying opacity to expose the co-located trap. The [supply preview](screenshots/qa-supply-preview.png) was captured from a two-client session advanced to 179 seconds; both clients received matching coordinates and observed the subsequent landing. The [loadout fixture](screenshots/qa-loadout.png) collected all five item types through the engine and used a banana charge.

## Character and HUD visual refinement

The [previous eight-player view](screenshots/qa-eight-player.png) and [refined view](screenshots/chibi-eight-after.png) use equivalent controlled fixtures. The updated original canvas vector artwork uses distinct curved hairstyles, larger expressive faces, layered outfits, and a higher-resolution render surface. The [updated loadout](screenshots/chibi-loadout-after.png) shows larger, higher-contrast stats and active slots, together with the redrawn banana and slowdown icons. The loadout fixture collects pickups through the engine and uses a banana charge; the screenshots are visual fixtures rather than an eight-human playtest.
