# The flier wakes when Arthur comes within 48 pixels, takes off, dives at him from a high place, and lands again.

About: The enemies; Stage 1: The graveyard; flier

Proof: #983; flier

Kind 2, at bank 4's $9FB0, sits at $05E0 across. Its flags say what it is: $02 awake, $08 flying, $04 the side it faces, $10 just after a shot, $20 old, after 1,024 rounds. $066E has what it's doing, $061D a number each part uses its own way, and $0607 with $065D count its rounds, which make it faster.

Asleep, at $A02B, it wakes when sub_F687 finds Arthur in a box of 48 pixels, or when a weapon has hit it. Awake on the ground, at $A063, it steps towards him, or away within 88 pixels, and on its 31st round takes off. A weapon within the box sub_A41E reads from $A45C, by how hard the game is, makes it take off at once.

In the air, at $A172, it flies at speed $28 to a place 32 pixels in from the side it faces away from, 64 or 80 down, and there waits one to eight rounds. Then $A215 heads it for Arthur, a 16th of a turn nearer straight down, with a 16th of how far across he is as a sideways speed that doubles every eighth round. At his height it turns round, goes back up at $A30A, comes level with him at $A33B, and lands.

Sub_A4B0 shoots at him on the 16th round of every 32, unless he's within 48 pixels: kind $2C, a plant's shot at speed $1A. Sub_F585 has a weapon that hits it stay three rounds as a spark, shape $56 or $66, with sound $1C. The fourth hit kills it, for 1,000 points.
