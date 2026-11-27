# A copy 435 rows long runs over the background copy's stack, so its twin has to take the original's 96 bytes.

About: 0x08001AA4; The language screen, at the first start

Proof: #1901; #2054

With seed 4 from memories of play and 80,000 calls, call 97,377 differed at `0x03007E66`, the twin `0x00` and the original `0x02`. A made-up background 435 rows long had the copy run over the stack, row 368 from `0x03007E66` on, with the function's 16 words at `0x03007E78`. The twin told the stack it took 124 bytes where the original takes 96, so the check put back 28 bytes more of the twin's stack than of the original's, five of which that row had changed. With the frame's room the original's, the same call differed in the 8 bytes under it, `0x03007E70` to `0x03007E77`: the BIOS takes them for the division of a level's background, which the kit's stack has since #2054. With both it leaves the same memory.
