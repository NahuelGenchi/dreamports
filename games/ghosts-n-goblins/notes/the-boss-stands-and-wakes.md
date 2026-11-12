# The stage's boss gets an object even when none is free, stands asleep before the gate, and wakes after 40 rounds.

About: The enemies; Stage 1: The graveyard; boss-wakes

Proof: #983; boss-wakes

The first stage's third part lists one object, kind 5 at $0D90, and the kinds' table sends it to $D673, not to the routine the others use. That one calls sub_DA28 in place of sub_DA18: it looks from where its last search stopped, at $CE, and takes a free object, or one in use that isn't shown, unless its kind is 5, $0F, $10 or $11, or 6 and awake. In the recording all 16 are in use and it takes one of those. The boss's state starts at 1 and its heading at $0C, and bit 2 of its listed flags would count it at $C3.

Kind 5 is bank 7's $FBC4. Each round it's hidden, and shown again if it's in the view, with the tests every enemy has in a box of $10 by $10. A hit by a weapon of kind $27 is taken back. Asleep, with $065D at 0, it has shape $C0 and looks for Arthur in a box of $50 by $10. It wakes, at sub_FF1D, when he's there, or after 40 rounds counted while he isn't below it, or with three hits: its count comes from the dice at $83, $065D becomes $FF, and it faces his side.

What it does awake, from $FC3F, and its death after ten hits aren't ported, so the recording ends on the round it wakes.

The switch to a stage's next part, at $D341, leaves X at $11, and the round's mix at $CA reads X every fourth round. The port didn't keep that, which no recording showed until this one changed parts with no object made in the rounds after: $CA was 4 off for twelve frames.
