# The character select's part ends on the act's music, which starts before the act's first picture.

About: The character select; neo-green-hill-act-1

Proof: #732; neo-green-hill-act-1

Frames 1776 to 1778 of `neo-green-hill-act-1` are black, and the original has already started the act's music in them. The character select's part ends at frame 1778, so a version that stops at the character select has to start the act's music as it leaves for the part to prove. The JavaScript version starts it with `playStageMusic` and its ahead frame. The C version starts the same song, song 12, where the character select's leave task hands over to the act, and the part proves from power-on. Until the act is in C, that music plays on over the black the version leaves.
