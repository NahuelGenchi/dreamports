# A hub's four layers draw 16 pixel blocks, packed by column, with tiles brought into video memory as a block needs them.

About: Crash on foot; first-hub-standing; 0x0802F460; 0x080368CC

Proof: #493; first-hub-standing

A level's definition holds its colours, its four layers, its collision and its two tile sets. A layer's map starts with its width and height, then a word for each column: 0x03000000 unpacks a column in runs, whose top two bits say 2 for one value repeated or 3 for values as they are. A block is four tile words, whose top four bits are its flips and two bits of colours: 0x080368CC moves them to where the console has them. Layers 0 to 2 follow where the last layer ended up, each by its own share of the camera's move.
