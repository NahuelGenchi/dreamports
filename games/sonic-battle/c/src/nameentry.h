// The name entry, at the first start (name-entry.js in the JavaScript version). The title screen's fade to black hands
// over to nameEntryScreen.

#ifndef SONIC_BATTLE_NAMEENTRY_H
#define SONIC_BATTLE_NAMEENTRY_H

/** 0x08036560: the screen's first frame, when no name is saved. The title screen calls it when its fade reaches black. */
void nameEntryScreen(void);

#endif
