# A rotating layer's missing register name writes the display control instead, so the layer goes off and nothing says why.

About: the display registers; rotating layers; kit/gba/video.js

Proof: #191

The kit's REG table in kit/gba/video.js names BG2PA and BG3PA but not BG2PB, BG2PC, BG2PD or their BG3 counterparts. video.write sends a register it doesn't know by an offset that comes out as NaN, which lands on register 0, the display control, so the whole screen changes and the layer disappears. It looks like a picture that never loaded. Code that sets all four parameters takes the offsets from the one name there is, BG2PA, BG2PA + 2, + 4 and + 6, or writes the register numbers itself.
