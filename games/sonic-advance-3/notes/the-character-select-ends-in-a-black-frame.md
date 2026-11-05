# The character select's last frame is black, then the original moves on to the next screen.

About: The character select; character-select

Proof: #305; character-select

After the announcer, the screen fades to white and holds, then the original shows one black frame and starts the next screen, with its own sound and palettes. The recording stops on that black frame, as the parts' rule says, and the way out (`Task_CharSelect_Destroy`) isn't ported yet, so the Dreamport holds on its white fade. The screen's task is also made by the main menu's, so it first runs in the second frame and the start point makes it the same way.
