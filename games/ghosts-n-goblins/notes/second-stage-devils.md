# The second stage's blue devils wait a count from its list, then fly, hover and dive, and are gone after two dives.

About: Stage 2: The castle and the haunted apartments; stage-2-begins

Proof: #991; stage-2-begins

The second stage's list of objects has kinds the first stage doesn't. Kind 6, the small blue devil, is placed by $D692, which gives it the count in the list's second byte. Kind 0 in the list goes to $D66D, which only steps on to the next entry, as zombies come by themselves. Kinds $36 and $37, both with shape $3E, are placed like the first stage's kinds whose state the list gives.

A devil's turn is bank 4's $A89E. Until its flag $04 is set it does nothing out of the view, and in the view takes one off its count each round. At 0 it wakes, heading right in the picture's left 48 pixels, left in its right 48, down above the 112th line, and up otherwise. Awake it flies for 16 rounds at speed $10 and what $D3 adds, then, with flag $08, hovers for 16 at speed 8, aims at Arthur with sub_FA58, and with flag $10 dives for 24 rounds at speed $14. After the dive its state goes up by one and its new heading is the game's count of rounds, $83, and $0C. From state 2 it flies at speed $18 without stopping, and once out of the view it's gone. One hit kills it, by $A976, for 100 points.

A stage more than one screen high lists its screens a row at a time: sub_E945 adds the row's length, from the list at $EB30, once for each screen down.

With nothing pressed in stage-2-begins the first two devils wake at frame 7536, one touches Arthur at 7696, and he lands without his armour at 7738.
