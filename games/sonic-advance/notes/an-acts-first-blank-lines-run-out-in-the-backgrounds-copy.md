# An act's first blank lines run out in the backgrounds' copy, so the original's first stage frame comes a frame late.

About: The character select; neo-green-hill-act-1

Proof: #1881; neo-green-hill-act-1

Frame 1776 of `neo-green-hill-act-1` makes the act, and leaves twelve entries in the graphics copy queue, among them the backgrounds' tiles, of 0x7AC0 and 0x1A00 bytes. In the blank lines after it the queue is emptied (its cursor at 0x030045F8 reaches its index, 9), but the last of the V-blank's four steps, `sa2__sub_8002B20` at 0x08001AA4, finds the blank lines over and gives back FALSE: after frame 1777 `sLastCalledVblankFuncId` (0x03001F94) holds 3, where it holds 0xFF after frames 1776 and 1778. So `EngineMainLoop` skips `GetInput` and `TasksExec` in frame 1777: `gFlagsPreVBlank` is 0 after it, the stage's clock at 0x03005120 is still 0 and the collision cache at 0x03000408 still empty. The stage's tasks first run in frame 1778, when the clock reaches 1.

The Dreamport in C times `UpdateScreenDma` and the V-blank's steps only on the path the screens before the title take (sprite palettes up, background palettes not, every step done) and its copy queue only for tiles of 1 KB or less, so its blank lines never run out there. With `ApplyGameStageSettingsAndStart` and the stage's tasks in C, its frame 1777 runs those tasks, and the work memory differs from frame 1777 on, the collision cache first. The pictures of frames 1776 to 1778 are black in both.
