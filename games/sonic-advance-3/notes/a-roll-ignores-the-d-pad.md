# A character's roll ignores the d-pad, so it can't be braked, turned or sped up, in the original too.

About: Player_80089CC; character-rolling

Proof: #477; character-rolling

Player_80089CC, the function that runs each frame of a roll, doesn't read the d-pad: it slows the roll by 8 each frame, adds the slope, moves, stops at walls and looks for a jump. In character-rolling Sonic holds the opposite way through rolls in both directions and through the roll after a spin dash, and the way he's going through another, and all 1,700 frames are the same in picture and sound. A jump out of a roll with the opposite way held doesn't steer either, as the jump keeps the d-pad off in the air until it lands.
