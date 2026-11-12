// The systems Dreamports are for, such as the NES and the Game Boy Advance, which the launcher's first row shows: the
// consoles of kit/consoles.js, each with its drawing in public/systems/. A game's system is its proof's console, the
// one the proof tools ran its original on (#1168).
import { CONSOLES } from '../../kit/consoles.js';

export interface System {
  id: string;
  name: string;
  // its drawing, which the launcher fills with its own colours (global.css, .sys-icon)
  icon: string;
}

// The consoles with a drawing in public/systems/, each from the single-colour icons of libretro/retroarch-assets
// (CC BY 4.0, credited in About), with only its shapes kept.
const DRAWN = ['nes', 'gb', 'gbc', 'gba', 'snes', 'md', 'n64', 'ps1', 'ps2', 'psp'];

/** A console as the launcher shows it. The build stops on one Dreamports doesn't know, or with no drawing yet. */
export function systemOf(console: string | undefined, game: string): System {
  const known = console === undefined ? undefined : (CONSOLES as Record<string, { name: string }>)[console];
  if (console === undefined || !known) throw new Error(`games/${game}/proof/original.json names the console "${console}", which kit/consoles.js doesn't have.`);
  if (!DRAWN.includes(console)) throw new Error(`The ${known.name} has no drawing for the launcher's row of systems yet: add public/systems/${console}.svg and its name to src/lib/systems.ts.`);
  return { id: console, name: known.name, icon: `/systems/${console}.svg` };
}
