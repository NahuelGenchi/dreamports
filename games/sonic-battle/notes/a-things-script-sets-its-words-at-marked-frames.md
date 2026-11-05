# A thing's script sets its words only on the frame its marker names, and a thing ends with a word of 0xFFFF.

About: 0x0800BB88

Proof: #448

Each kind of thing has a list of 32-bit words. A word whose first half is 0xFFF0 is a marker, and its second half is a frame number. A thing keeps the place of the marker it waits at, and when the frame it is on equals that number, the words after the marker run until the next marker. The frame always goes up by one. The dash's puff (kind 31) shows it: it sets a picture and a size at each marker, and a word of 0xFFFF frees the thing at its last frame. A dash recording that plays every frame the same as the original proves it.
