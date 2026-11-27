# The BIOS pushes r2 and lr on the game's stack for every swi, and a copy's routine saves three words more.

About: the BIOS; the console's stack

Proof: #2054; #1901

mGBA 0.10.5's BIOS (`src/gba/hle-bios.s`, `swiBase`) switches to the mode the game runs in before its work and pushes r2 and lr there, so they land 8 bytes under the stack pointer of the stub's caller, and stay once the BIOS is back. `CpuSet` then saves r4, r5 and where it goes back to in the BIOS, `0xA4`, `CpuFastSet` r4 to r10 and the same, and `IntrWait` r2, r3 and the same. A division saves nothing more.

`npm run test:stack` measures the division's and the copy's on a made-up cartridge. After a copy of one word, the five words under the caller's own pushes were a register of its caller's, `0xA4`, the copy's control, and where the stub goes back to, with the caller's own register under them written over by the function that read them. A wait's words are from the source alone.
