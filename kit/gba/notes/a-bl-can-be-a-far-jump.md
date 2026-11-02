# A bl can be a far jump, with a pool of numbers right after it, not a call that comes back.

About: reading Thumb code

Proof: #171; #173

The compiler these games use writes a long jump inside a function as a `bl`, and the numbers it loads can follow it, so reading straight on after one turns those numbers into instructions. `codemap` and `read` follow the jump and show them as data. Treating every such `bl` as ending the code wouldn't do either, as most are calls that come back.
