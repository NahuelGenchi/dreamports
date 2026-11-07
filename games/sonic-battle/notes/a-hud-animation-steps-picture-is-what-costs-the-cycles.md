# A HUD animation step costs 160 cycles, and its picture another 270, which the arena's moving colours feel.

About: A fight's opening; knuckles-moves; knuckles-power; knuckles-set; knuckles-air; 0x08015924; 0x08011c7c

Proof: #456; knuckles-moves; knuckles-power; knuckles-set; knuckles-air; fight-opening

The choice screen's attack picture runs 0x08015924, and its cycle count moves the arena's colours (0x08011c7c) down by a line or not. One cost of 430 for each step matched Sonic and Tails, whose frames always had a picture in their steps. Knuckles's picture has steps of only an end command, and those cost 160; a step with a picture costs 160 plus 270. A picture step still totals 430, so the older recordings keep matching.

The step's scanning and its other commands aren't priced yet. Amy's and Cream's choice screens still differ at frames 56 and 80 of their recordings, where their scripts run several commands in one step.
