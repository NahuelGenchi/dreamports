# Near the intro, the USA copy's addresses are the decompilation's labels less 0x388, not what names.json says.

About: The SEGA and Sonic Team logos

Proof: #301

SAT-R's decompilation builds the European release, and its labels around the intro, such as `sub_80A217C`, are 0x388 past the same functions in the USA copy: that one is at 0x080A1DF4. `names.json` maps these names as if they didn't move, so `read sub_80A217C` lands on another function. Read them by address, and check the instructions against the C. The comments in `src/logos.js` give the USA addresses.
