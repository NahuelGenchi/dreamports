// How many compilers a build runs at once: no more than the processor has room for, than memory can hold, or than make it
// much faster. Each takes a few hundred megabytes, and a build with every thread going can ask for gigabytes it won't be given.

import { availableParallelism, freemem } from 'node:os';

const MOST = 8;
const MEMORY_EACH = 300 * 1024 * 1024;

export const buildJobs = () => Math.max(1, Math.min(MOST, availableParallelism(), Math.floor(freemem() / MEMORY_EACH)));
