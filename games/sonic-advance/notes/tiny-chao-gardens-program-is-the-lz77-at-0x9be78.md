# Tiny Chao Garden's program is the LZ77 at 0x9BE78 of the USA copy, a different build from the decompilation's.

About: tiny-chao-garden; tiny-chao-hatches; Tiny Chao Garden

Proof: #1310; #1311; tiny-chao-garden; tiny-chao-hatches

LoadTinyChaoGarden unpacks the LZ77 data at 0x9BE78 of the USA copy, 138,752 bytes, to 0x02000000 and soft resets into it: what it unpacks matches the work RAM byte for byte at frame 1800, except the three words the menu leaves at 0x02000008 (the ring bank at save offset 0x428, the language at 0x19, the frame count plus the save's checksum, with the 15 frames the unpacking takes counted). Another LZ77 at 0x7BC214, 118,744 bytes, is a different program with a cartridge header, which isn't what runs.

SAT-R's chao_garden decompiles Sonic Advance 2's build. Sonic Advance's runs the same code with its functions elsewhere (InitGarden at 0x020014F8, the frame at 0x0200196C, the objects from 0x02001CCC to 0x020064F4) and saves marked 0x0817, not 0x1965. Its sound engine starts with 4 players, 4 channels, volume 15 and 10512 Hz, the music players' table at 0x020129DC and the garden's music as song 1. In tiny-chao-garden the menu hands over at frame 1729, the program's start runs until 1757, the garden's first frame is 1758, and the egg's 1,800 frames end at 3572, where its hatching sound starts.
