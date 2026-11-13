# The cave's shooters rise from its floor and walls to fire, and the axe Arthur finds there hits each enemy once.

About: Stage 3: The cave; cave-axe

Proof: #992; cave-axe

Kind $0B, sub_04_B56F, is the cave's shooter. It waits hidden until Arthur is within 24 lines, picks low, high or both by its count, rises blinking for 16 rounds and stays open for 16 more, then fires kind $2A ($F461) from object $14, $15 or both, and closes. Open, a weapon sparks on it; four hits kill it for 300 points.

A weapon picked up ($BA63) becomes Arthur's from then on. Kind $26, the axe ($ECAF), rises and falls by the list at $ED07 for 16 rounds, then drops eight pixels a round, and otherwise flies like the lance at speed $22. A gravestone's block stops it at once. It isn't spent by what it hits: its state keeps the last enemy hit ($F5B5), so it passes through and hits each one only once.

The interrupt can run two frames ahead of the kit's frame, before either frame's buttons have come. Its guess of the A buttons now goes with the read, so the time is put right against the guess it made, not a later one.
