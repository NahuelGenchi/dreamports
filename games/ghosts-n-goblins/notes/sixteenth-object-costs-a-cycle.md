# An object from the sixteenth place on takes a cycle more to read its flags, and from the fifteenth its heading.

About: The processor's time; walk-across

Proof: #983; walk-across

The objects' fields are lists of 22 bytes that follow each other in memory. The flags start at $04F0, so the sixteenth object's are at $0500, and the headings at $05F1, so the fifteenth's is at $0600. An instruction that reads one by the object's number takes a cycle more when the byte is in the next page, and one that only writes it doesn't.

On the walk across the first stage a zombie and then a thing to pick up use the sixteenth place. A zombie's shape reads its heading as it comes up and as it walks, and a thing to pick up hides itself and reads its flags when it's out of the view: each was a cycle short there.

Kind 2, at bank 4's $9FB0, is placed on the sixth screen. Out of the view it's hidden, and its flag $02 says whether it has flown off; until then it only waits.

A frame can end inside sub_F181, which finds where an object is on the screen, and inside the list of shown objects at $0480, so both are counted a write at a time.
