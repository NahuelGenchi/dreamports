// The memories of play the PlayStation 2's function check can start its calls from (twin.mjs): the console's memory and
// the EE's registers as they were each time a function started in play, taken and kept as ../lib/memories-of-play.mjs
// does on every console whose emulator tells of each function's start, with the EE's registers (EE_REGISTERS) and its
// image (KINDS.ee) from original.mjs.

import { EACH, memoriesOf } from '../lib/memories-of-play.mjs';
import { EE_REGISTERS, KINDS, PAGE } from './original.mjs';

export { EACH };
export const { memoriesKey, takeMemories, startsIn, hasMemories, openMemories } = memoriesOf({ words: EE_REGISTERS.words, image: KINDS.ee.image, page: PAGE });
