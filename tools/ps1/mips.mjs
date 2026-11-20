// The PlayStation's processor, the MIPS R3000A, as the tools read it: the tools' shared reader of MIPS (../lib/mips.mjs),
// whose `processor` is the R3000A unless another is named. `read` prints a game's function with it (read.mjs), the
// function finder tells code from values with it (functions.mjs), the function check knows which instructions branch
// (twin.mjs), and the tools' assembler encodes with its tables (assemble.mjs).

export * from '../lib/mips.mjs';
