# A song number the front end names from the wrong table reaches the sound worklet as undefined and stops the proof.

About: Time Attack; time-attack-result

Proof: #95

The Time Attack lobby's song is number 155. Asked for as SONG.LASER, which the table has no entry for, it reached the worklet as undefined and the prove of time-attack-result never finished. The result's jingles (0x131 and 0x132) are in the separate EXTRA_SONG table, which SONG doesn't hold. With 155 in SONG as TIME_ATTACK_LOBBY the lobby plays, and its frames match.
