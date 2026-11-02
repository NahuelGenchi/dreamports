# The decompilation's function list doesn't follow switches, so a function here can be longer than the list says.

About: the whole game

Proof: #171; #178

`config/BSBE78/function_extents.csv` has addresses and ends, no names, and doesn't follow switches: 40 of the 48 stretches automated play found outside the first map were the rest of functions it lists. `codemap --fill` follows them, which made 955 functions longer and added 69, many only over the pool of numbers after their code. It also leaves out 18 listed entries that start in data. So what the code map says of a function can differ from the list, and the code map is what the tools count.
