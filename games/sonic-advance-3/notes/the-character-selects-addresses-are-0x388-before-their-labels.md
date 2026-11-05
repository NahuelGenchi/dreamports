# The character select's code is 0x388 before its labels in the USA copy.

About: The character select

Proof: #305

As for the logos and the main menu, SAT-R's labels for the character select, such as `Task_8098DE4`, are 0x388 past the USA copy's functions: that one is at 0x08098A5C. This holds from `CreateCharacterSelect` (0x080978CC) to the last of its helpers (0x0809B3D0), and for the character task that follows (`LoadCharacterSelectSprites` at 0x0809B3E8, `sub_809BA58` at 0x0809B6D0). Some labels are only a function's place in the file, with no address in the name, so their USA places come from the order of the functions. The comments in `src/character-select.js` give the USA addresses.
