# The stage's own task stops every music player when it is destroyed, so leaving an act for the lobby cuts its sounds.

About: Time Attack; time-attack-pause; time-attack-death; time-attack-result

Proof: #761; time-attack-pause

TaskDestructor_GameStage calls m4aMPlayAllStop, so anything that destroys every task in an act stops all music players there and then. A in the Time Attack pause menu plays SE_SELECT on player 2 and then destroys every task, which stops it before the lobby starts its own sound on player 3; the original's frames after the A have no select sound. In C, `end_run` in `c/src/act.c` stops every song after the act's tasks go, and the music manager (`c/src/music.c`) drops its pause with its stage song when every player stops.
