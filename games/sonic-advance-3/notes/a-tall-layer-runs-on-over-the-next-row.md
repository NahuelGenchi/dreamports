# On a layer that's tall and not wide, a map row wider than 32 tiles runs on over the next row.

About: An act's opening; route-99-act-1-opening

Proof: #478; route-99-act-1-opening

Route 99's acts have layer 0 with a map 64 tiles wide on a layer of size 2, 256 by 512. The engine copies all 64 columns of each row in one go, 64 bytes on from the last, so the next row writes over the second half. Only layers of sizes 1 and 3 send it to the next block. Sending the second half back over the row's own start made the buildings at the bottom right of the screen differ from frame 99 on, and copying straight on made all 324 frames match.
