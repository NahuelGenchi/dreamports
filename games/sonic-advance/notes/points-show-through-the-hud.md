# A defeat's points show through the HUD's digit boxes, even in front of the ring icon, as the sprites' order lets them.

About: tails-neo-green-hill; knuckles-neo-green-hill

Proof: #90; tails-neo-green-hill

The points are at OAM order 0 and priority 2, the HUD's digits at order 2 and its icons at order 3, both priority 0. mGBA takes a pixel's priority up to that of each later sprite that covers it, even where that sprite is transparent, and a later sprite of the same priority can't then cover the pixel. So inside a digit's 8 by 16 box the points stay in front of the ring icon, and behind only the digit's own pixels. A run where the camera carries the points under the HUD shows it: frames 3976 to 3982 and 5159 to 5161 of `tails-neo-green-hill` differed by 1 to 7 pixels until `renderer.js` drew it this way. The first digit in OAM decides where two boxes overlap, so the digits are drawn in the opposite order to the one `Task_StageUIMain` lays them out in.
