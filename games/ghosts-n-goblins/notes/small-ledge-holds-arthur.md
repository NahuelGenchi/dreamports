# The second stage's small ledge holds Arthur above it and carries him only in the half of the picture it's heading to.

About: Stage 2: The castle and the haunted apartments; ledge

Proof: #991; ledge

Kind $36, the small ledge that goes up and down, looks each round at whether Arthur is coming down onto it, from $9E04: he isn't going up, isn't held already, is less than 20 pixels above it in the picture, and is within 36 pixels of it across. Then it jumps to $B795.

There his flag $10 is set, which his own turn reads as ground under him, and his state's $08. He's put above the ledge's place, 16 pixels when it's heading down and 12 when it's heading up, on the screen above when that's past its top. Then, only while the ledge is below the picture's 120th line going down, or above its 128th going up, sub_B80D adds the ledge's own move to his place down, with sub_EFDA, so he moves with it. His place in the picture is worked out again with sub_F181.

The first one is at $0180 across, on the stage's second screen down, past the end of the long ledge at about $014A. Walking off that end drops Arthur straight down into the water at $0150, too far from it. In ledge he walks from frame 7830 and jumps at 7896, and it holds him from 7944, when it's heading down past his height. With nothing pressed he rides it down and up again.
