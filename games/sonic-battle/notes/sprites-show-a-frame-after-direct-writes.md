# A callback's sprites reach OAM at the next V-blank, so they show a frame after what it writes to registers directly.

About: The title screen; title; 0x080185d8; 0x08017c5c; 0x08017ed0

Proof: #275; title

When 0x08017c5c has asked for it, the V-blank interrupt 0x080185d8 hides every sprite and builds them again from the queue as it stands at that moment, then copies them to OAM. A callback's scrolls, written directly, show in the frame that follows it, and its sprites one frame after those. So the title's first pulse, which its counters reach on its frame 15, is frame 561 of `title` for the layers and shows on the sprites at frame 562. It also means 0x08017ed0 emptying the queue after the sprites were queued leaves them hidden: Start at frame 747 takes all six sprites away at frame 748, though nothing in 0x0803e6e8 touches them. core.js's vblank does the same, with clearSprites and copyAtVblank.
