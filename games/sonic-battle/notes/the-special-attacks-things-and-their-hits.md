# Special attacks make shaped things, and their hits are kept on the owner's record.

About: Special attacks; specials-power; specials-shot; specials-set; 0x0800bb88; 0x0800eaec; 0x0800f0ac; 0x080036dc; 0x08001b0c

Proof: #451; specials-power

Sonic's ground Shot, state 19, sets voice 0x25 at script frame 0, kind 37, a two-part ball at the hand, and voice 0x26 at frame 9, kind 38, a three-part shot. The shot's own script makes kind 43 at its frame 16. The ground Power, state 21, makes kind 35, the ring. These kinds have shapes: 0x0800bb88 writes each part's picture and, for 35, 37, 38, 39, 43, 44, 158 and 160, looks up the part's offsets in the tables at 0x0806C0EC and 0x0806C14C, or 0x0806C250 and 0x0806C34C for 38 and 43, or 0x0806C4A4 and 0x0806C558 for 39 and 44. The way the thing faces adds 0x100 or 0x200 to a 37's picture, 0x2A0 or 0x540 to a 38's or 43's, 0x1E0 or 0x3C0 to a 39's or 44's, and 0x90 or 0x120 to a 158's or 160's first.

A thing's hit is kept at its owner's record +174: damage in the low six bits, kind in bits 6 to 10, the fighter it reached in bits 11 and 12, and the frames it holds in bits 13 and up. 0x0800f0ac writes it only while the owner's +174 is still 0, and 0x080036dc reads it after the fighter's own attacks. When the thing's +65 has bit 0 and its kind's bits are above 0x27F, the damage is 63, the knockout a full Ichikoro gauge gives. The kind 38 shot's parameters are radius 0x160, height 6, damage 20, hold 2 and kind 14, which is a state 84 reaction.

The hardest hit on the person playing, state 85, sets +156 and +157 to 40 and starts 0x08020898(5), a five-frame brightness rise. When +157 ends, 0x080208ec fades the brightness back over 40 frames.

The Power ring's script gives kind 35 speed 0x30 and fall 1 at frame 0, and speed 0x10 at frame 0x30. 0x0800cec8's per-kind step takes its +12 down by its +14 each frame until +62 reaches +17. That gravity moved the ring's first difference from frame 477 to frame 525, where its screen x is one pixel right of the original's: its world x is 694 at the spawn in the Dreamport, and the original's is 693.
