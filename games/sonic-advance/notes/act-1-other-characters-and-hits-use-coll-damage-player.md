# Neo Green Hill act 1 stops for characters other than Sonic, and enemy hits use Coll_DamagePlayer.

About: Neo Green Hill Zone act 1; The character select; character-select-to-course

Proof: #734; sonic-neo-green-hill; character-select-to-course

The C act engine is Sonic's: its player, animations and hitboxes are his. A pick of Tails, Knuckles or Amy therefore stops at the handover in `front_play`, with the screen as it is, instead of starting the act as Sonic; their recordings stay unproven until their own engines come. Enemy and shot hits set a flag that `act_frame` passes to `objects_hurt_player`, the same `obj_hurt` the objects and spikes use, so a shield takes the hit, item-box invincibility destroys the enemy, blinking from the last hit leaves it alone, rings scatter, and the knockback is `ysp = -3.0`. Before, `act_frame` had a second hurt path that ignored both shields and invincibility and used `ysp = +3.0`.
