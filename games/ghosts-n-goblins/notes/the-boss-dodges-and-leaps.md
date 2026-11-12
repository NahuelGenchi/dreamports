# The boss jumps out of a weapon's way for 16 rounds, by a list of heights, and its leap is the same jump, faster.

About: The enemies; Stage 1: The graveyard; boss-dodges

Proof: #983; boss-dodges

Flag $10, which a weapon near the walking boss sets, sends its turn to $FCEF. For 16 rounds, counted at $0607, it has shape $B4, or $C4 facing left, with flag $02 kept to match. Sub_FF36 takes the round's height from the list at $FEDD, 16 words from -16 to 16 pixels, and sub_F099 moves it down by that: up for seven rounds, still for two, down for seven. Across it moves at the step's speed in the list at $FF0D: 0, 4 or 8. It's hidden once it's out of the view. On the 16th round the flag is cleared, the count comes from the dice at $83, the next step begins and its shape is $B0 or $C0.

Flag $20, which every 64th step sets, sends it to $FEA4: the same jump at speed $2E, and as it lands the flag is cleared and it turns round. No recording reaches a 64th step, so the leap is written from the code alone and its cycles aren't checked.

In the recording Arthur throws a lance every 12 frames. The third hit wakes the boss, at about frame 6107, its shot hits Arthur at about frame 6188, and it dodges from about frame 6197.

Waking on a third hit takes 39 cycles to sub_FF1D, not the 43 it had been counted as before any recording ran it.
