# The menu's compressed pictures build their 16-bit references with the first byte as the high half.

About: The main menu; the whole game

Proof: #193

The initializer at 0x08039e20 calls the BIOS's LZ77UnCompVram for each of its pictures. Reading a reference's two bytes as a little-endian word, the way the BIOS's LZ77 is usually described, gives tiles that don't look like the menu: its background is noise and its flame is not there. Reading the first byte as the high half and the second as the low one builds the background's art, its "MODE SELECT" and "STORY MODE" and the flame. Its stills at frames 781 and later show the difference. The pictures' headers still say their size the usual way, little-endian in bytes 1 to 3.
