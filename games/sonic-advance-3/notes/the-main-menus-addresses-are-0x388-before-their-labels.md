# The main menu's code is 0x388 before its labels in the USA copy, and its tables 0x38C.

About: The main menu

Proof: #304

As near the intro (see the logos' note), SAT-R's labels for the main menu, such as `sub_8088FD4`, are 0x388 past the USA copy's functions: that one is at 0x08088C4C. Its tables, such as `gUnknown_080D6294`, are 0x38C past theirs: that one is at 0x080D5F08. `names.json` maps these names wrongly here too, so read them by address. The comments in `src/menu.js` give the USA addresses.
