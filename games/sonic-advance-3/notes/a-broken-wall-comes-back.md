# A broken wall comes back once the camera has gone far from it and returned, in the original too.

About: Task_8034E44; character-jumping-flying

Proof: #477; character-jumping-flying

Forty frames after a breakable wall breaks, Task_8034E44 writes the wall's own place back in the stage's list of objects before its task ends, at 0x08034F64 in the USA copy, as an object does when it leaves. So the list takes it as not made yet, and the wall is made again, whole, when the camera's band passes it. In character-jumping-flying the wall has gone by frame 925, Sonic walks left from frame 1300 and back from frame 1640, and at frame 1830 the wall stands whole, with all 2,000 frames the same in picture and sound. It isn't a difference to fix.
