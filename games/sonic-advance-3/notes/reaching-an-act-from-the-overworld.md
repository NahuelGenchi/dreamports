# Route 99's overworld has no short way to act 1's ring, so a recording reaches the act by the warp's own values.

About: An act's opening; Route 99's overworld; route-99-act-1-opening; 0x0800AD2C

Proof: #478; route-99-act-1-opening

The grey block right of where Sonic lands breaks after about four attacks with B, and the drop under it leads by a spring to a ledge that runs back to the start, with a handle overhead nobody reached, so no press list got as far as the act's ring. The big ring in the air over the start goes to Sonic Factory instead. route-99-act-1-opening instead writes the next map's number at 0x030008B2, as the ring does, and the address of the warp's first step, 0x0800AD2C with its Thumb bit, to both characters at 0x030015C0 and 0x03001710, at frame 5040 of its stretch. The white frames end at frame 5141 from power-on, and the card's first state is frame 5142.
