# Sources

The twins in this folder were written from these sources:

- SAT-R/sa1 at fdd8956 (https://github.com/SAT-R/sa1): `src/lib/m4a/m4a.c` and `include/lib/m4a/m4a_internal.h`, the engine's part in C and its structures, taken as that decompilation writes them, with its build switches set for the Game Boy Advance; and `src/lib/m4a/m4a0.s` with `constants/m4a_constants.inc`, the engine's part in assembly, which `m4a_mixer.c` and `m4a_sequencer.c` write as C, an instruction's work at a time.
- pret/agbcc at da598c1 (https://github.com/pret/agbcc): old_agbcc, the compiler `match` builds the engine's C with to compare it with a game's bytes, run on the contributor's computer and not kept here.
