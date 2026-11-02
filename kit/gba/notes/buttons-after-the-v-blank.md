# Some games read their buttons just after the V-blank and some just before, which moves a press by a frame.

About: reading the buttons

Proof: #131

Sonic Advance reads them just before it and Sonic Battle just after. With Start pressed on the logos, Sonic Battle's original was a frame behind until `"keysAfterVBlank": true` in its `proof/original.json` gave the original its buttons a frame later. After that, every frame of its two recordings matched. A difference that starts with a press, a frame off, can be this.
