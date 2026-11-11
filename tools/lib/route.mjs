// What the route finder (tools/route.mjs) reads and writes around its search (lib/explore.h): what a game says of its
// original, in games/<game>/proof/route.json, the file that tells the search what to look for, and the archive the
// search keeps, which holds buttons and the game's own numbers and nothing else of the game.
//
// route.json says where the original keeps the few values the search reads, and what they mean:
//
// {
//   "about": what it's for, in a sentence,
//   "values": { "x": { "address": "03005A20", "bytes": 4, "signed": true, "per": 256, "about": "…" }, … }
//     Each value's place in the work memory, in hexadecimal as the code map has it, its 1, 2 or 4 bytes, whether it can
//     be negative, and `per`, how many of its units make one of what people count in, such as 256 to a pixel. A value
//     the game keeps in memory it hands out as it goes, such as a boss's health, has "found" in place of "address":
//     { "from", "to", "step", "mark", "markBytes", "pointer", "pointerBytes", "base", "offset" }, the stretch of memory
//     to look through, what marks its record, such as the address of the code that ends it, and from the mark where the
//     record's own address is kept and where in the record the value is. It reads -1 while no record is there.
//   "cells": { "x": 32, "y": 32 }
//     The grid the search spreads over: each value in it and how much of it one cell covers, in what people count in.
//     Two places in the same cell are the same place to the search, so a value that says how far a fight has got goes
//     here with 1.
//   "apart": { "speedX": 4 }
//     Optional: what tells two states of one place apart, the same way. A place then keeps a state for each, which a
//     game needs where what can be done from a place depends on how it was reached, such as how fast.
//   "wait": { "frames": 90, "states": 3 }
//     Optional: a place also keeps a state for each stretch of that many frames after the search first reached it, up
//     to that many, so it can wait there for what only comes later, such as a platform that moves.
//   "lost": ["state&0x80"]
//     Play that can't go on, such as a life lost: the search drops it. Each is a condition, and any of them will do.
//   "goals": { "act-end": "flags&2", "the-boss": { "when": "flags&2", "cells": { "x": 16, "y": 16, "bossHealth": 1 } } }
//     The goals a game names, which --goal takes by name: a condition, or one as "when" with a grid of its own, "cells"
//     and "apart", for a part that needs another, such as a fight. One with "after" names the goal to reach first,
//     and is searched for from there: an act's end after the place its boss comes in.
//   "buttons": ["RIGHT", "RIGHT A", …]
//     Optional: the sets of buttons the search may hold, each a list of names with spaces between, "" for none. Without
//     it, every direction alone and with each of the console's other buttons but Start and Select.
// }
//
// A condition is a value, a sign and a number: x>=9000, lives<3, flags&2 (it has one of those bits), flags!&2 (it has
// none), with = and != too. Several with commas between all have to hold: x>=9000,y<700.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sharedProofFolder } from './paths.mjs';
import { versionOf } from '../../src/lib/languages.mjs';

const OPS = ['!=', '<=', '>=', '!&', '=', '<', '>', '&'];
const OP_NUMBER = { '=': 0, '!=': 1, '<': 2, '<=': 3, '>': 4, '>=': 5, '&': 6, '!&': 7 };
const HEX = /^[0-9A-Fa-f]{1,8}$/;
const NAME = /^[a-z][A-Za-z0-9]*$/;
const numberOf = text => (/^-?(0x[0-9a-f]+|\d+)$/i.test(text) ? Number(text.replace(/^-/, '')) * (text.startsWith('-') ? -1 : 1) : NaN);

/**
 * A condition's parts, each { value, op, number }, with `value` the value's name, checked against `values`, a game's
 * values by name. `where` says where it was written, for the messages.
 */
export function parseCondition(text, values, where) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${where}: a condition is a value, a sign and a number, such as x>=9000, with commas between several.`);
  return text.split(',').map(part => {
    const op = OPS.find(sign => part.includes(sign));
    const [name, number] = op ? part.split(op).map(side => side.trim()) : [];
    if (!op || !(name in values) || Number.isNaN(numberOf(number ?? ''))) {
      throw new Error(`${where}: "${part.trim()}" isn't a value, a sign and a number, such as x>=9000. The values are ${Object.keys(values).join(', ')}, and the signs =, !=, <, <=, >, >=, & and !&.`);
    }
    return { value: name, op, number: numberOf(number) };
  });
}

/** Whether a condition's parts all hold for the values a frame had, as the search reads them, by name. */
export function holds(parts, values, held) {
  return parts.every(({ value, op, number }) => {
    const bits = op === '&' || op === '!&', v = held[value], n = bits ? number : number * (values[value].per ?? 1);
    return { '=': v === n, '!=': v !== n, '<': v < n, '<=': v <= n, '>': v > n, '>=': v >= n, '&': (v & n) !== 0, '!&': (v & n) === 0 }[op];
  });
}

/** What's wrong with a "wait", or '' when it's { frames, states }, whole numbers, 1 or more and 0 to 64, or isn't there. */
export const checkWait = wait => (wait === undefined || (Number.isInteger(wait?.frames) && wait.frames > 0 && Number.isInteger(wait.states) && wait.states >= 0 && wait.states <= 64)
  ? '' : '"wait" is { "frames", "states" }: how many frames apart a place keeps a state from later on, 1 or more, and how many of them, 0 to 64.');

/** Checks what a game's route.json says, and throws with everything that's wrong with it. */
export function checkRoute(route, where, machine) {
  const problems = [];
  const { values, cells, apart = {}, wait, lost = [], goals = {}, buttons } = route ?? {};
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw new Error(`${where}: "values" names where the original keeps what the search reads, such as { "x": { "address": "03005A20", "bytes": 4 } }.`);
  for (const [name, value] of Object.entries(values)) {
    const { address, found, bytes, per = 1 } = value ?? {};
    if (!NAME.test(name)) problems.push(`"${name}" is a value's name, which starts with a small letter and has only letters and numbers.`);
    if (![1, 2, 4].includes(bytes)) problems.push(`${name}'s "bytes" is 1, 2 or 4.`);
    if (!Number.isInteger(per) || per < 1) problems.push(`${name}'s "per" is how many of its units make one of what people count in, 1 or more.`);
    if ((address === undefined) === (found === undefined)) problems.push(`${name} has an "address", or else "found" for a value in memory the game hands out as it goes.`);
    if (address !== undefined && (typeof address !== 'string' || !HEX.test(address))) problems.push(`${name}'s "address" is the work memory's, in hexadecimal, such as "03005A20".`);
    if (found !== undefined) {
      const { from, to, step = 4, mark, markBytes = 4, pointer = 0, pointerBytes = 0, base = '0', offset = 0 } = found ?? {};
      const whole = n => Number.isInteger(n);
      if (![from, to, mark, base].every(text => typeof text === 'string' && HEX.test(text)) || ![1, 2, 4].includes(markBytes) || ![0, 1, 2, 4].includes(pointerBytes) || !whole(step) || step < 1 || !whole(pointer) || !whole(offset)) {
        problems.push(`${name}'s "found" has "from", "to", "mark" and "base" in hexadecimal, "markBytes" 1, 2 or 4, "pointerBytes" 0, 1, 2 or 4, and "step", "pointer" and "offset" as whole numbers.`);
      }
    }
  }
  if (problems.length) throw new Error(`${where}: ${problems.join(' ')}`);
  if (!cells || typeof cells !== 'object' || !Object.keys(cells).length || !apart || typeof apart !== 'object' || Object.keys(cells).length + Object.keys(apart).length > 6) {
    problems.push('"cells" is the grid the search spreads over, values with how much of each a cell covers, such as { "x": 32, "y": 32 }, and "apart" what tells two states of one place apart, the same way: up to six between them.');
  } else for (const [word, sides] of [['cells', cells], ['apart', apart]]) for (const [name, size] of Object.entries(sides)) if (!(name in values) || !(size > 0)) problems.push(`"${word}" has ${name}, which has to be one of the values, with a size above 0.`);
  const waitProblem = checkWait(wait);
  if (waitProblem) problems.push(waitProblem);
  if (!Array.isArray(lost)) problems.push('"lost" is a list of conditions.');
  else lost.forEach(text => { try { parseCondition(text, values, '"lost"'); } catch (error) { problems.push(error.message.replace(`${where}: `, '')); } });
  if (!goals || typeof goals !== 'object' || Array.isArray(goals)) problems.push('"goals" gives each goal a name and its condition.');
  else for (const [name, goal] of Object.entries(goals)) {
    const own = goal && typeof goal === 'object' ? goal : { when: goal };
    try { parseCondition(own.when, values, `the goal "${name}"`); } catch (error) { problems.push(error.message); }
    if (checkWait(own.wait)) problems.push(`The goal "${name}": ${checkWait(own.wait)}`);
    if (own.after !== undefined && (!(own.after in goals) || own.after === name)) problems.push(`The goal "${name}" comes "after" ${own.after}, which has to be another of the goals.`);
    for (const [word, sides] of [['cells', own.cells ?? {}], ['apart', own.apart ?? {}]]) for (const [value, size] of Object.entries(sides)) if (!(value in values) || !(size > 0)) problems.push(`The goal "${name}" has ${value} in its "${word}", which has to be one of the values, with a size above 0.`);
  }
  if (buttons !== undefined) {
    const known = new Set(Object.keys(machine?.keys ?? {}));
    if (!Array.isArray(buttons) || !buttons.length || buttons.length > 64 || !buttons.every(set => typeof set === 'string')) problems.push('"buttons" lists up to 64 sets of buttons, each its names with spaces between, such as "RIGHT A".');
    else if (machine) for (const set of buttons) for (const button of set.split(' ').filter(Boolean)) if (!known.has(button)) problems.push(`"buttons" has ${button}, which the console doesn't: it has ${[...known].join(', ')}.`);
  }
  if (problems.length) throw new Error(`${where}: ${problems.join(' ')}`);
}

/** What a game says of its original for the route finder, from its proof/route.json, or null when it has none. `KEY` is the console's buttons, a bit each. */
export function readRoute(game, KEY) {
  const file = join(sharedProofFolder(game), 'route.json'), where = `games/${versionOf(game).game}/proof/route.json`;
  if (!existsSync(file)) return null;
  const route = JSON.parse(readFileSync(file, 'utf8'));
  checkRoute(route, where, KEY ? { keys: KEY } : undefined);
  return route;
}

const DIRECTION = /(^|_)(UP|DOWN|LEFT|RIGHT)$/;

/** The sets of buttons a search may hold when a game names none: nothing, each direction, and each of those with each of the console's other buttons but Start, Select and Mode. */
export function defaultButtons(KEY) {
  const names = Object.keys(KEY);
  const directions = ['', ...names.filter(name => DIRECTION.test(name))];
  const others = ['', ...names.filter(name => !DIRECTION.test(name) && !['START', 'SELECT', 'MODE'].includes(name))];
  return directions.flatMap(direction => others.map(other => [direction, other].filter(Boolean).join(' '))).slice(0, 64);
}

/** A set of buttons, written as names with spaces between, as the console's bits. */
export const maskOf = (set, KEY) => set.split(' ').filter(Boolean).reduce((mask, button) => mask | KEY[button], 0);

/** The names of the buttons a mask holds, in the console's order. */
export const namesOf = (mask, KEY) => Object.keys(KEY).filter(name => mask & KEY[name]);

/**
 * The file that tells the search what to look for (lib/explore.h): `route` is the game's route.json, `goal` and `lost`
 * lists of conditions' parts, any of which will do, `cells` the grid, `apart` what tells a place's states apart and
 * `wait` how it keeps states from later on,
 * and the rest numbers and names of files.
 */
export function specText({ route, goal, lost, cells, apart = {}, wait, buttons, KEY, files, seed, seconds, stale, megabytes, threads = 1 }) {
  const names = Object.keys(route.values), place = name => names.indexOf(name);
  const number = text => parseInt(text, 16);
  const lines = [`prefix ${files.prefix}`, `sets ${files.sets}`, `archive ${files.archive}`, `out ${files.out}`];
  for (const name of names) {
    const { address, found, bytes, signed } = route.values[name];
    if (found) {
      const { from, to, step = 4, mark, markBytes = 4, pointer = 0, pointerBytes = 0, base = '0', offset = 0 } = found;
      lines.push(`value-found ${number(from)} ${number(to)} ${step} ${number(mark)} ${markBytes} ${pointer} ${pointerBytes} ${number(base)} ${offset} ${bytes} ${signed ? 1 : 0}`);
    } else lines.push(`value ${number(address)} ${bytes} ${signed ? 1 : 0}`);
  }
  for (const [word, sides] of [['cell', cells], ['apart', apart]]) for (const [name, size] of Object.entries(sides)) lines.push(`${word} ${place(name)} ${Math.max(1, Math.round(size * (route.values[name].per ?? 1)))}`);
  if (wait?.states) lines.push(`wait ${wait.frames} ${wait.states}`);
  const conditions = (word, groups) => groups.forEach((parts, group) => {
    for (const { value, op, number: n } of parts) {
      const bits = op === '&' || op === '!&';
      lines.push(`${word} ${group} ${place(value)} ${OP_NUMBER[op]} ${bits ? n : Math.round(n * (route.values[value].per ?? 1))}`);
    }
  });
  conditions('lost', lost);
  conditions('goal', goal);
  for (const set of buttons) lines.push(`buttons ${maskOf(set, KEY)}`);
  lines.push(`seed ${seed}`, `seconds ${seconds}`, `stale ${stale}`, `megabytes ${megabytes}`, `threads ${threads}`);
  return `${lines.join('\n')}\n`;
}

/** What a search starts from and reads, as one hash: a search goes on from an archive only when this is the same. The
 *  goal isn't in it, as one archive serves any goal. */
export function searchFingerprint({ original, prefix, sets, route, cells, apart, wait, lost, buttons }) {
  return createHash('sha1').update(JSON.stringify([original, route.values, cells, apart, wait?.states ? wait : null, lost, buttons])).update(prefix).update(sets).digest('hex');
}

/**
 * The archive a search keeps (lib/explore.h): its nodes, each { parent, count, first, frames, values }, with `values`
 * the game's values there by name, and `route(node)`, the buttons held at each frame from the search's start to a node.
 */
export function readArchive(bytes, names) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || bytes.toString('latin1', 0, 4) !== 'DPRT' || view.getUint32(4, true) !== 1 || view.getUint32(8, true) !== names.length) {
    throw new Error('The search\'s archive is of another kind: --fresh starts again.');
  }
  const count = view.getUint32(12, true), pool = view.getUint32(16, true), goal = view.getInt32(20, true), row = 16 + names.length * 8;
  const nodes = [];
  for (let i = 0, at = 24; i < count; i++, at += row) {
    const values = {};
    names.forEach((name, k) => { values[name] = Number(view.getBigInt64(at + 16 + k * 8, true)); });
    nodes.push({ parent: view.getInt32(at, true), count: view.getUint32(at + 4, true), first: view.getUint32(at + 8, true), frames: view.getUint32(at + 12, true), values });
  }
  const poolAt = 24 + count * row;
  const buttons = i => view.getUint32(poolAt + i * 4, true);
  if (bytes.length < poolAt + pool * 4) throw new Error('The search\'s archive is cut short: --fresh starts again.');
  return {
    nodes, goal,
    route(node) {
      const out = new Array(nodes[node].frames);
      for (let n = node, at = out.length; n > 0; n = nodes[n].parent) {
        at -= nodes[n].count;
        for (let f = 0; f < nodes[n].count; f++) out[at + f] = buttons(nodes[n].first + f);
      }
      return out;
    },
  };
}

/**
 * The places a search reached, by its grid: for each cell, the node that got there in the fewest frames. `cells` is
 * the grid, and `values` the game's values, for their `per`.
 */
export function placesOf(archive, cells, values) {
  const places = new Map();
  archive.nodes.forEach((node, index) => {
    const key = Object.entries(cells).map(([name, size]) => Math.floor(node.values[name] / (size * (values[name].per ?? 1)))).join(',');
    const before = places.get(key);
    if (!before || node.frames < archive.nodes[before].frames) places.set(key, index);
  });
  return places;
}
