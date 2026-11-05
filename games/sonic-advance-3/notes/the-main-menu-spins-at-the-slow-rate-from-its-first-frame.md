# The main menu's spinning layer turns at the slow rate from its first frame, though the C starts it at the fast one.

About: The main menu

Proof: #304

In `sub_8088FD4` the layer turns by 0x400 a frame while `unk3` is 0 and by 0x100 once it is 1, and `unk3` is only set when the scale has shrunk to 0x180, eight frames in. The original turns by 0x100 from the very first frame, as if `unk3` were already 1 when the task is made (perhaps its memory isn't cleared). `src/menu.js` starts it at 1. The layer's picture matches in every frame this way and not otherwise.
