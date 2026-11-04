# The copyright screen and both logos are FLC videos, packed with the console's LZ77 and played by a small script.

About: The copyright screen and the logos; logos; 0x0802D35C; 0x0800D46C; 0x0800D5D4

Proof: logos

The script is a list of three-word commands at 0x02009224, which 0x0803C120 builds, run by 0x0802D35C. Each video starts with a first word whose high nibble says packed or not, then an ordinary FLC file with chunks 4, 7, 11, 13, 15 and 16, drawn into the hidden page of mode 4 and copied at the V-blank by 0x0800DCA8. Picture matches on every one of frames 0 to 518 of `logos` only with the console's timing added: loading a video takes 2 frames for the second and 1 for the third, and frames 4 to 7, 18 and 19 of the third take past the V-blank to unpack, so the main loop, the fade included, loses a frame there. All of those are measured against mGBA, not worked out from the code, and a video's clock starts only after its first frame is drawn.
