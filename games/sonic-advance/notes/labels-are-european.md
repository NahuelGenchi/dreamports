# The decompilation's labels are the European release's, while the proof uses the USA copy.

About: the whole game

Proof: #111; #173

SAT-R builds the European release, and `proof/original.json` names the USA copy, so a label such as sub_8029ED8 isn't that address in this copy. `proof/names.json` says how far each stretch of labels moved, worked out from 885 labels, and `portmap` and `read` follow it. A number written in the code, such as 0x08016078, is taken as the USA copy's own address. When a label lands somewhere no function starts, `read` says so, and what it prints may be the wrong function.
