# An act the course select starts differs from one the character select starts in five ways, all of which the proof shows.

About: The course select; course-select-first-act; course-select-all-rows

Proof: #92; course-select-first-act; course-select-all-rows

The fade's last frame makes the act, so one frame loads and the next is its first picture. That picture has the layers scrolled to 0, 0 and the sprites placed by the camera before it's kept inside the act, which is why it differed by 21,938 pixels for as long as the layers followed the camera. The music is heard from the frame after the fade ends and fades in over about 35 frames, and starting it on the fade's last frame or two frames later both made more frames differ. Cutting the select sound off at that moment made a frame differ too. The HUD's zero-ring counter starts at whatever memory holds, a number that goes by the act. From 40 up its first frame shows a character code of 0, which lands on tiles 20 and 21 of sprite video memory, and those hold what the character select loaded: UI graphics 39's tiles 19 and 20, in the font's colours. Act 2's card doesn't start as the results' band, as `gFinalBossActive` is set to the level chosen.
