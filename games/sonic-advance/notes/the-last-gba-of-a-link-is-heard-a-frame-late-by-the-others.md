# The last GBA on a link is heard a frame later than the others, by every GBA with a lower id.

About: vs-multipak-2-players; vs-multipak-3-players; vs-multipak-4-players

Proof: #96; vs-multipak-2-players; vs-multipak-3-players; vs-multipak-4-players

In the linked cores' menus a packet sent in frame f is read in frame f + 2, except that the packet of the last GBA (the highest id) is read by every GBA with a lower id in frame f + 3. With two players that is the child's packet reaching the parent, and with 3 and 4 it is the last child's to all before it. No other pair differs, and the rule matches every frame of the 2, 3 and 4 player recordings (3924 and 4160 frames); the earlier model, with one delay for children to the parent and another for the parent to the children, matched only two players. In the port it is `delayFrom` in `engine/link.js`.

The parent's A on the Chao Hunt stage choice with 3 or 4 players reaches the children one frame later in the original than in the port. The transfers there wobble by a frame, and the rule above doesn't explain it, so the recordings stop before that frame.

Registering the players met (`sub_800FD9C`, the lobby's chao variants come from it) compares the packet's bytes 5 to 15 with each record's bytes 1 to 11, moves a record it finds to the front, and otherwise pushes the others down and writes the new one, zeroing its wins, losses and draws. The decompilation's matching version compares different bytes, so a literal port of it gives different variants for 3 and 4 players.
