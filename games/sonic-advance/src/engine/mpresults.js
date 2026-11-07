// The multiplayer round's results screen, for one GBA of the link (SAT-R decompilation,
// src/game/sa1/multiplayer/chao_message.c, CreateMultiplayerResultsScreen(1), and sub_803AB60): a strip for
// each player, sliding in from alternate sides out of white, with the player's name from this GBA's save, a
// Chao and a message (in the save's language) for how the player did, the winner's, the loser's or the draw
// music, and a sound 45 frames in. Creating it counts the round in the save's VS record: the player's own
// result and, for the players this GBA has met, how each did against them. It holds until a player presses A,
// or 30 seconds, and every GBA follows the first to press it (a packet of kind 0xB0); then the strips slide
// out, the screen whitens, and the save is written if it changed (sub_803BC64), which takes 14 frames; the
// continue screen follows (`onDone`).

import { SONG } from '../sound/songs.js';
import { makeSprite, animate } from './objects.js';
import { SCREEN_W, SCREEN_H } from './constants.js';
import { MULTIPLAYER_RESULT, multiplayerRecord, recordMultiplayerResult, recordOwnMultiplayerResult, WRITE_FRAMES } from './save.js';

const STRIP = 40, SLIDE = 16, HOLD = 0x707, SOUND_AT = 45;
const MUSIC = [7, 8, 9];   // MUS_007, MUS_008, MUS_009: won, lost, drew
const SOUND = [SONG.VS_WIN_SE, SONG.VS_LOSE_SE, SONG.VS_DRAW_SE];
const KIND_DONE = 0xB0;
const s16 = v => (v << 16) >> 16;

// The Chao's and the message's variants for each player, and how this GBA's player and each of the others did
// against them, as the save's records count it (sub_803AB60's mode 1, the Chao Hunt): `foes[i]` is the result
// for player i's record in this GBA's save, or null when the original records none.
function outcome(ranks, count, id) {
  const chao = [], msg = [], foes = new Array(4).fill(null);
  const { WIN, LOSS, DRAW } = MULTIPLAYER_RESULT;
  let result;
  if (count === 2) {
    for (let i = 0; i < count; i++) chao[i] = msg[i] = ranks[i] === 0 ? 2 : ranks[i] === 4 ? 4 : 3;
    result = ranks[id] === 0 ? 0 : ranks[id] === 4 ? 2 : 1;
    // the two-player round's records, as sub_803AB60's first branch counts them
    for (let i = 0; i < count; i++) {
      if (i === id) continue;
      foes[i] = ranks[i] === 0 ? (ranks[id] === 0 ? DRAW : LOSS) : ranks[i] === 4 ? DRAW : ranks[id] === 0 ? WIN : DRAW;
    }
  } else {
    const winners = ranks.slice(0, count).filter(r => r === 0).length;
    for (let i = 0; i < count; i++) {
      chao[i] = msg[i] = winners === 1 ? (ranks[i] === 0 ? 2 : 3) : winners === 0 ? 4 : ranks[i] === 0 ? 4 : 3;
    }
    if (winners === 1) {
      result = ranks[id] === 0 ? 0 : 1;
      for (let i = 0; i < count; i++) {
        if (i === id) continue;
        foes[i] = ranks[i] === 0 ? LOSS : ranks[id] === 0 ? WIN : null;
      }
    } else if (winners === 0) {
      result = 2;
      for (let i = 0; i < count; i++) if (i !== id) foes[i] = DRAW;
    } else result = ranks[id] === 0 ? 2 : 1;
  }
  return { chao, msg, result, foes };
}

/**
 * GBA `id`'s results screen, drawn on `canvas`. `ranks` are the round's (gMultiplayerRanks), `input` this
 * GBA's buttons, `save` this GBA's save (whose player name and VS record it uses) and `language` its save's
 * (uiLanguage: 0 Japanese, 1 English). `records[i]` is the save record of player `i` (gUnknown_03005008), 0xFF
 * when this GBA has no record of them.
 */
export function createResultsScreen({ canvas, assets, link, id, count, ranks, sound, input, save = null, records = null, language = 1, onDone }) {
  const { atlas, frames, anims } = assets.sprites, { background, backdrop, names } = assets.results;
  const g = canvas.getContext('2d');
  const top = count === 2 ? 40 : count === 3 ? 20 : 0;      // unk50
  const slide = [-240, 240, -240, 240];                      // unk48: each strip's x
  const { chao, msg, result, foes } = outcome(ranks, count, id);
  // the names' task (sub_803BFE8): this player's name from the save, the others' from the records it keeps of them
  const spaces = new Uint8Array(8).fill(0x20);
  const nameOf = i => i === id ? (save?.playerName ?? spaces) : (multiplayerRecord(save, records?.[i] ?? 0xFF)?.subarray(4, 12) ?? spaces);
  // sub_803AB60's records, as the screen is made: this player's own result and, for the players it has met, theirs
  if (save) {
    recordOwnMultiplayerResult(save, result);
    for (let i = 0; i < count; i++) if (i !== id && foes[i] !== null) recordMultiplayerResult(multiplayerRecord(save, records?.[i] ?? 0xFF), foes[i]);
  }
  const sprites = [];
  for (let i = 0; i < count; i++) {
    const c = makeSprite(`resultChao${chao[i]}`, { order: 16, prio: 3 });
    const m = makeSprite(`resultMessage${language ? '' : 'Japanese'}${msg[i]}`, { order: 16, prio: 3 });
    sprites.push({ s: c, x: 45, y: i * STRIP + 2, i }, { s: m, x: 169, y: i * STRIP + 20, i });
  }
  const send = link.send(id);
  send.bytes.fill(0);
  sound.play(MUSIC[result]);
  let bldY = 16, frame = 0, phase = 'in', finished = false, spritesRun = false;
  // sub_803BC64: the save is written on the white, if it changed, which takes WRITE_FRAMES in which nothing runs
  let saveStarted = false, saving = 0;

  // the strips move in turn, the first to start being the last to stop; true once all are in place
  function move(out) {
    let done = 0;
    const step = (i, after, target, dir) => {
      if (!(after(frame))) return;
      if (slide[i] !== target) slide[i] = s16(slide[i] + dir * SLIDE);
      else done++;
    };
    if (!out) {
      if (count >= 4) step(3, f => f >= 16, 0, -1);
      if (count >= 3) step(2, f => f > 10, 0, 1);
      if (count >= 2) { step(1, f => f > 5, 0, -1); step(0, f => f !== 0, 0, 1); }
    } else {
      if (count >= 4) step(3, f => f !== 0, 240, 1);
      if (count >= 3) step(2, f => f > 5, -240, -1);
      if (count >= 2) { step(1, f => f > 10, 240, 1); step(0, f => f >= 16, -240, -1); }
    }
    return done === count;
  }

  function step() {
    input.poll?.();
    if (finished) return;
    const pressed = input.jumpPressed;
    input.jumpPressed = false; input.attackPressed = false;
    if (phase === 'in') {
      frame++;
      if (move(false)) phase = 'hold';
      if (bldY !== 0) bldY--;
    } else if (phase === 'hold') {
      frame++;
      let seen = false;
      for (let i = 0; i < 4; i++) if (link.recv(i)?.kind === KIND_DONE) seen = true;
      if (pressed || frame > HOLD || seen) {
        phase = 'out'; frame = 0;
        if (!seen) send.kind = KIND_DONE;
      }
      if (frame === SOUND_AT) sound.play(SOUND[result]);
    } else if (phase === 'out') {
      frame++;
      if (move(true)) phase = 'white';
    } else if ((bldY & 0x1F) < 16) bldY++;
    else {
      if (!saveStarted) {
        saveStarted = true;
        sound.stopAll();
        if (save?.write()) saving = WRITE_FRAMES;
        if (!saving) { finished = true; onDone?.(); return; }
      }
      // the frames of the write, in which nothing else runs and the screen keeps the white
      if (--saving > 0) return;
      finished = true;
      onDone?.();
      return;
    }
    // the Chao's and the message's tasks (Task_803C130) are made in the screen's first frame and first run in
    // the next, so their animations start a frame after the strips move and nothing is drawn before then
    if (spritesRun) for (const { s } of sprites) animate(s, anims);
    spritesRun = true;
  }

  function draw() {
    g.imageSmoothingEnabled = false;
    g.fillStyle = `rgb(${backdrop.join(',')})`;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // each strip shows its 40 lines of the background, at its own x
    for (let i = 0; i < count; i++) g.drawImage(background, 0, i * STRIP, background.width, STRIP, slide[i] + 1, top + i * STRIP, background.width, STRIP);
    for (const { s, x, y, i } of sprites) {
      if (s.frame < 0) continue;
      const [sx, sy, w, h, ax, ay] = frames[s.frame];
      g.drawImage(atlas, sx, sy, w, h, x + slide[i] - ax, y + top - ay, w, h);
    }
    // sub_803BFE8: six glyphs of the UI font for each player, over its strip; lowercase ones 8 px lower
    if (names) for (let i = 0; i < count; i++) {
      const name = nameOf(i);
      for (let c = 0; c < 6; c++) {
        const code = name[c], glyph = code >= 0x20 && code < 0x20 + 0x6A ? code - 0x20 : 0;
        const low = ((code - 0x70) & 0xFF) < 26 ? 8 : 0;
        g.drawImage(names.sheet, glyph * names.width, 0, names.width, names.height,
          slide[i] + 10 + c * 8, top + i * STRIP + 20 + low, names.width, names.height);
      }
    }
    if (bldY) {
      // brightness up by bldY sixteenths, as mGBA rounds it
      const img = g.getImageData(0, 0, SCREEN_W, SCREEN_H), d = img.data, y = Math.min(bldY, 16);
      for (let k = 0; k < d.length; k += 4) for (let c = 0; c < 3; c++) d[k + c] += ((255 - d[k + c]) * y) >> 4;
      g.putImageData(img, 0, 0);
    }
  }

  return { step, draw };
}
