# The Mini-games screen starts at 0x080315bc, and its entries lead on to two other places that aren't this screen.

About: The mini-games; mini-games-menu; mini-games-open; 0x080315bc; 0x08031e68; 0x0803187c; 0x080325f0; 0x08032594

Proof: #508; mini-games-menu; mini-games-open

Choosing the fifth entry of the main menu runs 0x080315bc once the fade is black. In `mini-games-menu`, A at 1100 is black from 1131 to 1134 and the screen fades in from 1135. B at 1680 is black from 1711 to 1716 and the main menu comes back on the entry it left. A on the first entry at 2000 is black from 2031 to 2037, and at 2038 the original is on 0x080284b4, the screen Battle mode starts at, so the mini-games on that path need what comes after it. The third entry takes another way: 0x08032594 fades to white, unpacks a program from the cartridge into work RAM, and restarts into it. The byte at 0x03002188 says which entries are open, one bit each, and a new save has only the first.
