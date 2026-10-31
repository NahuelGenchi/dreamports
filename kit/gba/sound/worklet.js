// The sound engine's AudioWorklet module for a game with no sounds of its own (processor.js).

import { GbaSoundProcessor } from './processor.js';

registerProcessor('gba-sound', GbaSoundProcessor);
