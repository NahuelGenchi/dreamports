# The title screen draws from bank 3, loads its tiles from bank 0, and turns on at frame 99.

About: The title screen; title

Proof: #987; title

The title screen task starts at $C3DC, one before the $C3DF the table at $C3CC points past, because the scheduler returns into it with RTS. It draws from bank 3's lists at $8054 and $8056, whose rows are 20 and 29 tiles wide; it loads 8 KB of tiles from bank 0 at $8000, and takes its palette and attributes from the last bank at $C80C and $C82C. The picture stays off until frame 99, the first frame the stills show the title screen; frames 0 to 5 show the PPU's grey, and 6 to 98 black, with the palette written at frame 6. The whole recording matches picture and sound: frames 0 to 98 are the setup, with the APU's second clear landing in frame 4, and frame 99 is the first with the title screen. The sword object at $04F0 names tile $1B, whose descriptor at $855D expands to two sprites at $0200: Y=$8A, tile $CE, colour 1, X=$58, and Y=$92, tile $CF, colour 1, X=$58. The second player's words and score are the copy's $A2 block, at $2058 and $2076.
