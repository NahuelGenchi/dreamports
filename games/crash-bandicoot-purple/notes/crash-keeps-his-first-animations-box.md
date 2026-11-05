# Crash keeps the box of his first animation, whichever plays after, and a place in the level is the middle of that box.

About: Crash on foot; first-hub-standing; 0x0803874C; 0x08038668; 0x08021E74; 0x08022B50

Proof: #493; first-hub-standing

0x0803874C moves an actor from the list's place to the middle of its animation's box, and 0x08038668 draws from it with the box the actor kept, not the one of the animation playing. After 300 frames of standing, at the start of his animation, 0x08021E74 calls 0x08022B50 with a random number, whose lowest two bits pick one of his four standing animations.
