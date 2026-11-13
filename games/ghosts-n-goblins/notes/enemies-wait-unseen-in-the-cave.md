# Enemies wait unseen in the cave, and come out when Arthur reaches their places.

About: Stage 3: The cave; cave-to-the-boss

Proof: #992; cave-to-the-boss

Kind $21, sub_04_9E32, is hidden where the stage's list puts it. Each round in the view it tests a box of 20 pixels around its place against Arthur. When he touches it, it becomes the enemy its state picks from the list at $9EA8, four bytes each: a kind, a count, and how far across and down from here it starts. The list holds the forest's flying enemy (kind 4), the flier (kind 2, which starts with its flag $02 set), kind 7 and kind 6. Out of the view it stays hidden, and from Arthur's $0AF8 on, one left on a screen before $0B is gone ($BB72).

A weapon thrown from the top of a screen ($E13A) starts on the screen above, 16 lines lower in its numbers, as a screen is 240 lines. And the axe's test of the block above it ($E9E5) looks on the screen above when it's within four lines of the top.
