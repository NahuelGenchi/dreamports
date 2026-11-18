// What match, the function check and the build each need to know of a game's version in C before they build it
// (../match.mjs, ../twin.mjs, c.mjs): every function its files define, with the function of the original each is the
// twin of, and the address of every name the game gives one, so the three never read them differently.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gameFolder, proofFolder, REPO, sharedProofFolder } from './paths.mjs';
import { codeFiles, readShifts } from '../portmap.mjs';
import { twinsIn } from '../gba/match.mjs';

/** The names and addresses in a file shaped as proof/addresses.json, as a Map of name to address. */
export function readAddresses(file) {
  const inRepo = relative(REPO, file).split(sep).join('/');
  const where = inRepo.startsWith('..') ? file : inRepo;
  let found;
  try {
    found = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${where} can't be read: ${error.message}`);
  }
  const entries = Object.entries(found?.addresses ?? {});
  if (!found?.addresses || typeof found.addresses !== 'object' || !entries.every(([name, address]) => /^[A-Za-z_]\w*$/.test(name) && typeof address === 'string' && /^[0-9A-F]{8}$/.test(address))) {
    throw new Error(`${where} needs "addresses": { "<name>": "<address>" }, with each address as eight capital hexadecimal digits.`);
  }
  return new Map(entries.map(([name, address]) => [name, parseInt(address, 16)]));
}

/**
 * A version's twins and names, for `game` such as sonic-advance/c, with `more`, another file of names shaped as the
 * game's proof/addresses.json, read after it:
 *   folder    the version's folder, and shifts, how far the labels' release is from the copy (portmap.mjs)
 *   files     every .c file of the version
 *   twinsOf   a Map of each file to the functions it defines, as twinsIn gives them
 *   twins     a Map of each function's name to the addresses the version says it's the twin of
 *   definedIn a Map of each function's name to the first file that defines it
 *   named     a Map of each name the game gives an address to that address
 */
export function versionTwins(game, more = null) {
  const folder = gameFolder(game), shifts = readShifts(game);
  const named = new Map();
  // the game's names, which every version shares, then the version's own, in its own proof/, then `more`
  const kept = [...new Set([sharedProofFolder(game), proofFolder(game)])].map(each => join(each, 'addresses.json')).filter(file => existsSync(file));
  if (more && !existsSync(more)) throw new Error(`${more} isn't a file.`);
  for (const file of [...kept, ...(more ? [more] : [])]) {
    for (const [name, address] of readAddresses(file)) named.set(name, address);
  }
  const files = codeFiles(folder, 'c').filter(file => file.endsWith('.c'));
  const twinsOf = new Map(files.map(file => [file, twinsIn(readFileSync(file, 'utf8'), shifts)]));
  const twins = new Map(), definedIn = new Map();
  for (const [file, defined] of twinsOf) {
    for (const { name, address } of defined) {
      if (address !== null) twins.set(name, (twins.get(name) ?? new Set()).add(address));
      if (!definedIn.has(name)) definedIn.set(name, file);
    }
  }
  return { folder, shifts, files, twinsOf, twins, definedIn, named };
}
