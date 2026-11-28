# An act's first blank lines run out in the backgrounds' copy, so the original's first stage frame comes a frame late.

About: The character select; neo-green-hill-act-1

Proof: #1881; neo-green-hill-act-1

Frame 1776 of `neo-green-hill-act-1` makes the act, and leaves twelve entries in the graphics copy queue, among them the backgrounds' tiles, of 0x7AC0 and 0x1A00 bytes. In the blank lines after it the queue is emptied (its cursor at 0x030045F8 reaches its index, 9), but the last of the V-blank's four steps, `sa2__sub_8002B20` at 0x08001AA4, finds the blank lines over and gives back FALSE: after frame 1777 `sLastCalledVblankFuncId` (0x03001F94) holds 3, where it holds 0xFF after frames 1776 and 1778. So `EngineMainLoop` skips `GetInput` and `TasksExec` in frame 1777: `gFlagsPreVBlank` is 0 after it, the stage's clock at 0x03005120 is still 0 and the collision cache at 0x03000408 still empty. The stage's tasks first run in frame 1778, when the clock reaches 1.

With the V-blank's work timed only on the title screens' paths, the Dreamport's blank lines never ran out there, its frame 1777 ran the stage's tasks, and its work memory differed from then on. The pictures of frames 1776 to 1778 are black in both. In that V-blank both palettes go up, the second step (0x08002F84) clears the maps of backgrounds 1 and 2, and the last finds the blank lines on at its first look, copies background 1's level map (0x08002454 to 0x0800256E) and finds them over at its next. With all of it timed, frames 1777 and 1778 match in the Dreamport too.
