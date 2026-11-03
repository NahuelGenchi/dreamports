# The engine's tables are at 0x08BF71FC and 0x08BF7244, and the players they hold point into IWRAM.

About: the whole game

Proof: #190; logos; logos-skipped

gMPlayTable (0x08BF71FC) holds six music players of twelve bytes each, and gSongTable (0x08BF7244) follows it with 833 songs. The players' state and track lists are pointers into IWRAM, 0x03000000 and up, while the kit's findMusicPlayers looks for EWRAM pointers, so it finds nothing in this copy whatever number of players it is given. Handing soundLayout the player table's offset itself works instead: it reads the song table that follows, counts its songs, and needs no scan.
