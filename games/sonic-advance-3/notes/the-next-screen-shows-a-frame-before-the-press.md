# Pressing A on the language screen changes the frame before the press.

About: The language screen, at the first start; The name entry, at the first start; first-start

Proof: #299; first-start

With A held from frame 600, frame 599 of the original already has layer 0 gone from nearly every line, with the sprites still there, and frame 600 is the name entry. `prove` shows each frame's work a frame later, and the name entry clears video memory directly as the task runs, while the console is still drawing the frame before. So first-start stops at frame 598, before the press.

That frame can't be matched, as a Dreamport doesn't know of a press until its frame comes, and its picture is two tiles of layer 0 cleared partway down the screen. So name-entry gives the original that one frame as `onlyInOriginal`, at 599, and the name entry's part starts on the frame after it. Its sound, of frames 597 to 600, isn't compared.
