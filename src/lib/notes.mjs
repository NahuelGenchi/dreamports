// The notes in a game's or a kit's folder (docs/NOTES.md), read the same way by the build, `npm run check` and the proof
// tools. What a note is and what it may hold is in .github/moderation/notes.mjs, which the Dreamports bot uses too.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NOTE_NAME, noteProblems, parseNote } from '../../.github/moderation/notes.mjs';

// what a game's note says when it's about all of it
export const WHOLE_GAME = 'the whole game';
// how a function is written, as `read` takes it: an address, or a label such as sub_8029E78 or FUN_08029E78
const FUNCTION = /^(?:0x)?[0-9a-f]{7,8}$|^[a-z][a-z0-9]*_0?8[0-9a-f]{6}$/i;

const listed = folder => (existsSync(folder) ? readdirSync(folder, { withFileTypes: true }) : []);

/** The notes in games/<name>/ or kit/<name>/, by their files' names: each with its parts, and with `problems`, what
 *  keeps it from being read. A note with problems is still listed, with no parts, and nothing but the build's and
 *  `npm run check`'s messages quotes from it. */
export function notesIn(root, top, name) {
  const folder = join(root, top, name, 'notes');
  const empty = (file, path) => ({ name: file.replace(/\.md$/, ''), path, title: '', about: [], proof: [], text: '' });
  if (existsSync(folder) && !lstatSync(folder).isDirectory()) {
    return [{ ...empty('notes', `${top}/${name}/notes`), problems: ['A notes folder has to be a folder of its own, not a link to one somewhere else.'] }];
  }
  return listed(folder).filter(entry => !entry.name.startsWith('.')).map(entry => {
    const path = `${top}/${name}/notes/${entry.name}`;
    const base = empty(entry.name, path);
    if (!entry.isFile() || !NOTE_NAME.test(entry.name)) {
      return { ...base, problems: ['A note is a plain file named with lowercase letters, numbers and single dashes, ending in .md.'] };
    }
    const text = readFileSync(join(root, path), 'utf8');
    const problems = noteProblems(text);
    return problems.length ? { ...base, problems } : { ...base, ...parseNote(text), problems };
  });
}

/** A game's kit, as its entry names it, or null. */
export function kitOf(root, game) {
  const entry = join(root, 'games', game, 'entry.md');
  return existsSync(entry) ? /^kit:\s*['"]?([a-z0-9-]+)/m.exec(readFileSync(entry, 'utf8'))?.[1] ?? null : null;
}

// what a game's note can be about, and what can prove it
function factsOf(root, game) {
  const proof = join(root, 'games', game, 'proof');
  const json = file => (existsSync(join(proof, file)) ? JSON.parse(readFileSync(join(proof, file), 'utf8')) : {});
  return {
    parts: new Set((json('parts.json').parts ?? []).map(part => part.name)),
    recordings: new Set(listed(join(proof, 'recordings')).map(entry => entry.name.replace(/\.json$/, ''))),
    functions: new Set((json('code-map.json').functions ?? []).map(([, , name]) => name?.toLowerCase()).filter(Boolean)),
  };
}

/** What's wrong with every note in games/ and kit/, as [{ path, why }]. A game's note also has to be about something the
 *  game has, so `prove` and `read` find it, and a kit's has only the rules every note keeps. */
export function checkNotes(root) {
  const problems = [];
  for (const top of ['games', 'kit']) {
    for (const entry of listed(join(root, top)).filter(found => found.isDirectory())) {
      const notes = notesIn(root, top, entry.name);
      if (!notes.length) continue;
      const facts = top === 'games' ? factsOf(root, entry.name) : null;
      for (const note of notes) {
        for (const why of note.problems) problems.push({ path: note.path, why });
        if (!facts || note.problems.length) continue;
        for (const about of note.about) {
          if (about === WHOLE_GAME || facts.parts.has(about) || facts.recordings.has(about) || facts.functions.has(about.toLowerCase()) || FUNCTION.test(about)) continue;
          problems.push({ path: note.path, why: `Its About: line names "${about}", which isn't one of the game's parts in parts.json, a recording, a function, or ${WHOLE_GAME}.` });
        }
        for (const proof of note.proof) {
          if (!proof.startsWith('#') && !facts.recordings.has(proof)) problems.push({ path: note.path, why: `Its Proof: line names "${proof}", which isn't one of the game's recordings.` });
        }
      }
    }
  }
  return problems;
}
