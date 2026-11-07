# A fighter thrown into a wall it flew at bounces with flag 0x80, unless a guard's last hit takes it.

About: A fighter's attacks; amy-shot; amy-set; amy-air; 0x0800444c

Proof: #457; amy-shot; amy-set; amy-air

A fighter in the throw states 66 and 81 reads the walls and edges it met, at its +50, against the way it last faced, at its +37: bits 1 and 16 with the way that faces 4, bits 2 and 32 with 6, bits 4 and 64 with 8, and bits 8 and 128 with 2. When one matches, its +185 being 1 copies its +124 to its +125 and takes state 96, the guard's last hit; else its flags at +180 get 0x80, the bounce.
