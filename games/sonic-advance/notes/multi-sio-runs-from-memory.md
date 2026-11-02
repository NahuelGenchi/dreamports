# MultiSioRecvBufChange and MultiSioIntr are ARM, and only ever run from the copies the game makes in memory.

About: 0x080001CC; 0x0800020C

Proof: #174

Both are ARM after a word of data, 64 and 288 bytes long, the sizes of the two buffers the decompilation copies them into. The game copies them to memory before running them, so they never run from the cartridge, and no recording can count them as having run there. They count toward code ported only when the code names them.
