# Pressing A on the language screen changes the frame before the press.

About: The language screen, at the first start; The name entry, at the first start; first-start

Proof: #299; first-start

With A held from frame 600, frame 599 of the original already has layer 0 gone from nearly every line, with the sprites still there, and frame 600 is the name entry. `prove` shows each frame's work a frame later, and the name entry clears video memory directly as the task runs, while the console is still drawing the frame before. So first-start stops at frame 598, before the press.
