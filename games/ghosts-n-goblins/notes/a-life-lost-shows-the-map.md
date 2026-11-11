# A hit without armour kills Arthur, and each life after a game's first starts with the map of the stages.

About: The armor and lives; The stage map; game-start

Proof: #980; game-start

Arthur's task goes to $E171 when his flag $01 says he's hit. With flag $20, no armour, it yields a round, plays sound $0A, throws him back with the same jump as the first hit, sub_E1EE, which gives him other colours and shape $18 without armour, then shows his bones, shape $1A, sleeps 60 frames, sets $81 and ends.

The game's task reads $81 at the end of its round, at $D3F0. At $D408 it stops the sound, keeps the weapon he had at $C5 for the player, and stops the view's, Arthur's and the objects' tasks with sub_CAD6. Back at $C8FF it sets $A6, takes a life from $0715 and calls sub_D01D again, as for a game's first life: the screen that says whose turn it is, with the lives left.

With $A6 set, sub_CD8E shows the map, at $CD9B, and sub_CE71 leaves the opening scene out. The map loads 6 KB of tiles from bank 0's $8800, clears both name tables, writes its picture in one run of 192 tiles and nine rows of names from bank 2, plays sound 1, and puts a marker, kind $22 at $FF62, at the player's place from the tables at $CC50 and $CC78. After 60 frames the picture moves a pixel a round for 112 rounds, by $3D and $64, and stays 60 frames more.

In game-start the zombie touches Arthur at frame 1553, his task ends at 1666, the screen for the next life shows from 1700, the map from 1897 to 2244, and the stage shows again from 2395.
