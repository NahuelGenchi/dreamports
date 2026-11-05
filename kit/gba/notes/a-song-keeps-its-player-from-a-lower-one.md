# A song keeps its player from a song of lower priority.

About: sound

Proof: #450

MPlayStart doesn't always start the song it's given. When the player table's own byte at +10 is set (MPlayOpen's `unk_B`), a song still playing, or about to start, on that player keeps it from one with a lower priority, which the song's header gives at +2. Sonic Battle sets it on players 1 to 5, so its healing sound, priority 40, isn't cut short by the swings, priority 30, that come while it plays. Since #450 the kit's `mplayStart` in `sound/m4a.js` does the same; a game whose table leaves the byte at 0 sounds as before.
