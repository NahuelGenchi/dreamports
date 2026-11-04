# The game's sound doesn't reach the kit's sound engine: it has a mixer and a song format of its own.

About: the whole game; The copyright screen and the logos; logos; 0x0803407C; 0x080342A4; 0x080423D0; 0x08042AD4

Proof: logos

From frame 29 of `logos`, as the first command that starts a song runs, `prove` finds the original playing and the Dreamport silent, and every picture matches. The script's commands 11 and 12 reach 0x080342A4 and 0x0803407C, which hand the game's own data to 0x08042AD4 and the functions after it. 0x080423D0 works out how much memory a mix takes from a table of 13 mix rates and the sizes of code it copies into memory to run, and 0x080434F8 runs from the V-blank. The code from 0x08041E00 to 0x08044400 is about 8.5 KB, with its mixer beyond that. Nothing in this game's parts can be proven until it's rewritten, as the kit plays only the other engine.
