# Neo Green Hill act 1 plays for other characters with Sonic's engine, and enemy hits use Coll_DamagePlayer.

About: Neo Green Hill Zone act 1; The character select; character-select-to-course

Proof: #734; sonic-neo-green-hill; pick-tails; pick-knuckles; pick-amy

The C act engine is Sonic's: its player, animations and hitboxes are his. A pick of Tails, Knuckles or Amy starts the act all the same, as main's front end did before this step: the title card, the HUD's face and the stage are the level's own, and only the player is Sonic's until the others' engines come, so their recordings match up to where his sprite would show. Enemy and shot hits set a flag that `act_frame` passes to `objects_hurt_player`, the same `obj_hurt` the objects and spikes use, so a shield takes the hit, item-box invincibility destroys the enemy, blinking from the last hit leaves it alone, rings scatter, and the knockback is `ysp = -3.0`. Before, `act_frame` had a second hurt path that ignored both shields and invincibility and used `ysp = +3.0`.
