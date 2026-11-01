// Where the sound engine's tables are in a ROM: the music player table (gMPlayTable) and the song table
// (gSongTable) that follows it. The engine (m4a.js) reads songs, voices and samples through them. A game builds
// the engine with its own number of music players, usually one for the music and a few for sound effects.

const EWRAM = [0x02000000, 0x02040000];
const inEwram = v => v >= EWRAM[0] && v < EWRAM[1];

// a song table entry: a ROM pointer to the song header, then the player's number twice
function isSong(rom, at, players) {
  const ms = rom.u16(at + 4);
  return rom.isPointer(rom.u32(at)) && ms < players && rom.u16(at + 6) === ms;
}

/**
 * The music player table is `players` entries of {player state, track array (both EWRAM pointers), track count,
 * 0, u16}, and the song table starts right after it. Returns the player table's file offset, or null.
 */
export function findMusicPlayers(rom, players) {
  for (let at = 0; at + players * 12 + 16 <= rom.size; at += 4) {
    let ok = true;
    for (let i = 0; i < players && ok; i++) {
      const e = at + i * 12, tracks = rom.u8(e + 8);
      ok = inEwram(rom.u32(e)) && inEwram(rom.u32(e + 4)) && tracks >= 1 && tracks <= 16 && rom.u8(e + 9) === 0;
    }
    if (ok && isSong(rom, at + players * 12, players) && isSong(rom, at + players * 12 + 8, players)) return at;
  }
  return null;
}

/**
 * The layout the engine needs (m4a.js): both tables, how many songs there are, and the game's sound `mode`
 * (soundMode in m4a.js).
 */
export function soundLayout(rom, playerTable, { players, mode }) {
  const songTable = playerTable + players * 12;
  let songs = 0;
  while (songTable + (songs + 1) * 8 <= rom.size && isSong(rom, songTable + songs * 8, players)) songs++;
  return { playerTable, songTable, players, songs, mode };
}
