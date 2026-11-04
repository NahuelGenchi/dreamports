# Pressing A on the language screen changes the frame before the press.

About: The language screen, at the first start; The name entry, at the first start; first-start; name-entry

Proof: #299; #300; first-start; name-entry

With A held from frame 600, frame 599 of the original already has layer 0 gone from nearly every line, with the sprites still there, and frame 600 is the name entry. `prove` shows each frame's work a frame later, and the name entry clears video memory directly as the task runs, while the console is still drawing the frame before. So first-start stops at frame 598, before the press.

That frame can't be matched: its picture has two tiles of layer 0 cleared partway down the screen by a press a Dreamport doesn't know of until its own frame comes, and giving it that frame would take a frame more between every press and the screen, all through the game. So name-entry proves the name entry from a start point, with A pressed on the recording's first frame, and from power-on the Dreamport differs from the original on that one frame. Its sound, of frames 0 and 1, isn't compared.
