# Gamma's specials charge in state 0x113 and fire as things 177 to 179.

About: Special attacks; 0x08001b0c; 0x080025a2; 0x0800c728; 0x0800eaec; gamma-shot; gamma-set

Proof: #463; #639; gamma-shot; gamma-set

0x08001b0c's charge steps sit behind a switch on the fighter's character, and Shadow and Gamma take different branches. In Gamma's, at 0x080025a2, the Shot's charge stops at 4 and the Set's at 6, and each step plays the charge sound. Letting go of R fires. Shadow's branch instead charges further, with no sound, and changes his picture as it grows. The Shot fires kind 177, and kinds 178 and 179 for a charge of 3 and 4. The Set's thing is kind 185, and 0x0800c728's table gives its script and 0x0800eaec its hit. While the C ran Shadow's branch for Gamma, gamma-shot's sound differed at frames 81 and 82 and gamma-set stopped at kind 185. With Gamma's own branch, both match every frame in C.
