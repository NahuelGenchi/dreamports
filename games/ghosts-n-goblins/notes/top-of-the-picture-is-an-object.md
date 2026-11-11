# The score, the lives and the time at the top of a stage are one object, whose shape is kept in work memory at $06D6.

About: the whole game; game-start

Proof: #1005; game-start

Objects $16 and $18, past the 22 the objects' task runs, are the words at the top of a stage's picture and the weapon Arthur has. The first has shape $FF, and bank 4's table of shapes points that one at $06D6 in work memory, where $D17A copies 40 bytes from $CD16 as a stage starts: 19 sprites. The game writes the digits into that copy: the score's six from $06E0, every other byte, empty until the first that isn't 0, the lives at $0700 and $0702, and the time at $06F6, $06FA and $06FC, from the table at $D847. So the top of the picture is sprites, drawn with the rest by the sprites' task, and the stage scrolls under it with no split of the screen.
