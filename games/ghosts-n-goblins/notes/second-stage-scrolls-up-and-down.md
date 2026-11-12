# The second stage scrolls up and down: the view draws a row of 35 tiles, and a column can run on to the screen below.

About: Stage 2: The castle and the haunted apartments; towers

Proof: #991; towers

The second stage is two screens high, and the view follows Arthur up and down as well as across. When the view's pixel row crosses into a new row of tiles, at $E739, the view's task calls sub_E849. It draws the row just above the view when the view moves up, and the one 232 lines below its top when it moves down, 35 tiles from 8 pixels left of the view, into the list at $07A6 that V-blank writes at $C11B. A row that runs off the right of its screen goes on from the left of the next screen, as a second run in the other name table, from $E8FF.

A column, sub_E76F, that runs off the bottom of its screen goes on from the top of the screen below, at $E800: the first run's count goes to $07DA, and a second run starts at the top of the same name table. sub_EA73 puts a row past the name table's 30 at its top.

In towers the view first draws a row at frame 7530, as Arthur jumps to the upper ledge, and a column first splits at 7554. A lance kills a devil at 7590, by $A976: nothing is carried, so the side it falls to is read from Arthur's own heading, object 0. Kind $36 is a small ledge that goes up and down, in the view from frame 7713.

At two frames' ends, 7830 and 7848, the frame ends inside the sprites' task's first swap of the first and fourth objects. The port had counted the two instructions after that swap, at $8003, before it, so it was four cycles late there and one byte behind the original at each.
