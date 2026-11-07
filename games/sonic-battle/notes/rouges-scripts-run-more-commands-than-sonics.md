# Rouge's animation scripts run more commands than Sonic's, which can move Emerald Beach's choice colours a line.

About: A fight's opening; fight-opening; 0x08015924

Proof: #457; #972

The choice of special attacks writes Emerald Beach's moving colours partway down the screen, after the frame's work and the sound (0x08011c7c). The Dreamport counts 430 cycles for a step of an animation's script (0x08015924) whatever commands the step runs. Sonic's idle step usually runs two, and Rouge's frame 4 runs nine, so on some frames her colours land one line apart from the original's. #457 found it with recordings first named for Amy that played Rouge, fighter 4, from the same presses as `specials-shot`'s opening. Training's maps whose colours are copied at once, such as 6, 7, 9 and 11, don't show it.
