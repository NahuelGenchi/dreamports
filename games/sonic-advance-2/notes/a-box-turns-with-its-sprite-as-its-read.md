# A sprite's box is turned by which way the sprite faces at the moment its animation reads it.

About: Being hit; leaf-forest-buzzer-beaten

Proof: #501; leaf-forest-buzzer-beaten

The AddHitbox command in an animation swaps and negates the box's sides when the sprite has its X or Y flip set, as the decompilation's animCmd_AddHitbox does, and the box stays as it was read until the next one. With the box taken as written, a jump at a Buzzer passed through it at frame 185, where the original beat it, while the same code beat a Mon. A sprite that turns between two reads keeps a box that faces the old way.
