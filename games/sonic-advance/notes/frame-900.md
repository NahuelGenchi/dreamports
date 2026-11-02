# Pressing Start on Sonic Team's logo makes frame 900 differ, as the original changes tiles while drawing it.

About: neo-green-hill-act-1; The SEGA and Sonic Team logos

Proof: #108; #115

In `neo-green-hill-act-1`, 3,299 of 3,300 frames match. Frame 900 differs by 19 pixels, between 98,44 and 103,47, where the logo's text is half drawn in the original, as its tiles change partway through that frame. It's a real difference, not a fault in the tools, and it's why `prove` still exits with 1 on this recording. It only happens when Start is pressed on that logo: `logos-and-intro`, which leaves the logos alone, matches all of its 3,600 frames, and it's what proves this part.
