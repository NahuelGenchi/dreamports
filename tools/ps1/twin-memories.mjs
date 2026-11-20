// The memories of play the PlayStation's function check can start its calls from (twin.mjs): the console's memory and
// the processor's registers as they were each time a function started in play, taken and kept as
// ../lib/memories-of-play.mjs does on every console whose emulator tells of each function's start. PCSX ReARMed tells
// of each instruction its interpreter is about to run, with the tools' change to it (../libretro/pcsx.patch), and a
// memory is the check's image (original.mjs): the 2 MB of RAM, then the scratchpad's page and the hardware's two, with
// the 34 registers, the 32, hi and lo, in REGISTERS' order.

import { EACH, memoriesOf } from '../lib/memories-of-play.mjs';
import { IMAGE, REGISTERS } from './original.mjs';

export { EACH };
export const { memoriesKey, takeMemories, startsIn, hasMemories, openMemories } = memoriesOf({ words: REGISTERS.length, image: IMAGE, page: 0x1000 });
