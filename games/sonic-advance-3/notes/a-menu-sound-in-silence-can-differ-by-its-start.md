# Some cursor sounds on the quiet language screen differ around 250 Hz as they start, depending on when they start.

About: The language screen, at the first start; first-start

Proof: #299; first-start

Every picture of first-start matches, and its only differences are three frames of sound around some of its presses of Up and Down, each around 250 Hz and a little over the 10 dB that counts as the same, with the Dreamport the louder. Played a frame later, the same sounds differed at other presses: 120 and 270 instead of 120, 150 and 300. The sound is one short high note on a square channel with nothing else playing, so what is left in that low band is little and depends on where the note starts in its wave. mGBA and the kit's sound/apu.js both keep a square's wave moving while it's silent, and the kit writes a frame's registers at the frame's start where the console writes them later in the frame, so the two start the note at different points of the wave. That is the likely cause, not yet shown by making them start together.
