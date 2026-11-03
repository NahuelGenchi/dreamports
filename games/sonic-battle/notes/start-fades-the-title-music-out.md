# 0x0801f718 fades a song's player out, not in, and a louder sound can hide that mistake from prove for a long time.

About: The title screen; title; 0x0801f718; 0x080491d4

Proof: #192; title

0x0801f718 finds the song's player and calls 0x080491d4, which is MPlayFadeOut, with its second argument shifted right by four. Start on the title calls it with song 0 and 120: the music steps down every 7 frames. The kit's fadeOut does this, and its fadeIn doesn't: on a playing song it drops the volume by about 24 dB at its first step, then raises it. Song 404, which Start plays over it, is loud enough that `prove` found every band within 10 dB until frames 764 to 766 and 773, when song 404 had died down and the music's bass, around 125 Hz on the right, was 10.8 dB too quiet. So a few frames of difference in one band can be a wrong volume all along.
