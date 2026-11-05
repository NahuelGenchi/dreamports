# A later sprite with a better priority lifts what its box covers, even where it is transparent.

About: title-demos

Proof: #94; title-demos

mGBA goes through OAM in order. A later sprite with a better priority than a pixel already drawn takes that pixel where it is opaque, and where it is transparent leaves the colour but gives the pixel its own priority. A later sprite of that same priority can't then cover the pixel. In `title-demos` this shows in three ways: Sonic's dust at priority 2 and order 8 comes through the holes of DEMO PLAY (priority 1, order 15) in front of the pole's layer, at frame 5597; his grind sparks show in front of the rail inside his box as he grinds at priority 1, at frame 5759; and a spark in DEMO PLAY's box stays in front of Sonic himself, at frame 5720. The act's renderer draws each such sprite again, clipped to the later sprite's box, just behind that sprite. It uses a frame's whole rectangle as the box, not its separate OAM entries, and leaves out rotated sprites.
