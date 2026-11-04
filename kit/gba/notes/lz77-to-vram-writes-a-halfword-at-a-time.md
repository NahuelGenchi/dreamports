# LZ77UnCompVram writes VRAM a halfword at a time, so a copy from one byte back reads what VRAM held before.

About: the BIOS's LZ77UnCompVram; decompressing into VRAM; reading a picture that differs by a few bytes

Proof: #193

VRAM can't take a single byte, so the BIOS keeps each even byte until the odd one after it completes the halfword. A copy whose distance is one byte, landing on an odd address, reads the even byte of that same halfword, which isn't written yet, and gets what VRAM held there before. So what a picture unpacks to can depend on the screen before it. In Sonic Battle's main menu this showed as `prove` naming stretches of tiles that start at odd addresses and differ by a few bytes, and treating it the BIOS's way made all of them match. The references themselves are the usual format: the first byte holds the length and the distance's top bits, the second byte the rest.
