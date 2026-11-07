# Emerl's screen opens from the story map with R, by way of 0x08021b0c, and no choice on the main menu leads to it.

About: Emerl's skills; skills-screen; 0x08021b0c; 0x08021f20; 0x08041458; 0x080220a4

Proof: #518; skills-screen

The main menu's seven choices are Story mode, Battle mode, Challenge mode, Training mode, Mini-games, Battle record and Options. The story map's frame, 0x08041458, stores 0x08021b0d as the next screen when R is pressed and the halfword at 0x02000584 isn't 0. The screen's menu has Edit skills, Change memory, Skill list, Exchange skills and Return to game: 0x080220a4 hands over to 0x080221e0, 0x08022c2c, 0x08023064 and 0x08025d50 for the first four, and 0x08023038 for the last. 0x08021f20 calls the same initializer and sets 0x03004dc8, which makes 0x08022f40 open Exchange skills at once, with no menu. The family runs from 0x08021b0c to 0x08027db8, about 26 KB. `emerl-menu` sets the screen's callback at 0x03002030 to 0x08021b0d from the main menu, and with 901 frames only in the original every picture matches. The sound after frame 610 belongs to the screen that follows.
