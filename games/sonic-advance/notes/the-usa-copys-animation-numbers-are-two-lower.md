# From about animation 886 on, the USA copy's numbers are 2 lower than the European decompilation's.

About: vs-mode-select; the whole game

Proof: #96; vs-mode-select

The decompilation the labels come from is the European release, and an animation number in its code is not the USA copy's. The VS menu's choices were 901 and 897 there and are 899 and 895 in the USA copy, which drew the wrong shapes (sprites of another size and palette) until the numbers were read from the USA copy's own instructions at `0x0800E470` and `0x0800E934`. The waiting screen's literals are 0x376 and 0x379 where the decompilation has 0x378 and 0x37B. Read an animation number with `npm run dp -- read` and never copy it from the decompilation.
