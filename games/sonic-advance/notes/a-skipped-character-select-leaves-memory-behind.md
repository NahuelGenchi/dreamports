# A character select only the original plays leaves its memory apart from the C's, so both play it to the course select.

About: The course select; course-select-down-and-up; neo-green-hill-act-2; course-select-first-act

Proof: #1882; course-select-down-and-up; neo-green-hill-act-2; course-select-first-act

`course-select-first-act` opens the Dreamport at the course select with `?unlocked=1&only=126` and plays the character select in the original alone. The version in C keeps the console's work memory, which `prove` compares after every frame, and the original's 126 frames of the character select leave 5,223 bytes of it apart from frame 3751 on, from 0x02000001, so no frame of the course select after them can match. In `course-select-down-and-up` and `neo-green-hill-act-2` both play the character select, the original is given Sonic's progress by the recording's `sets` at frame 3760, and the version in C gives itself the same value at the same frame with `?given=3760` (`main.c`). Every frame of `course-select-down-and-up` then matches, the work memory too, and the course select is frames 3918 to 4255 of it: the character select's fade is black until 3917, where CreateCourseSelect runs, and the course select's own fade ends black at 4254 and 4255.

The USA copy's Task_8062140 reads the chaos emeralds at 0x1C of the save, the byte `save.h` names `btnConfig` after the decompilation's European save, and its Task_8062540 calls 0x0803DBA0, the stage's start, where the decompilation names ApplyGameStageSettings. Its Task_CourseSelectInit puts each act's lines 24 times the act's number down from where the gap above them ends, `(n * 24) - line + 0x20`, which comes out as the original's bytes; the decompilation's form, which doesn't match, also moves the line on each time round.
