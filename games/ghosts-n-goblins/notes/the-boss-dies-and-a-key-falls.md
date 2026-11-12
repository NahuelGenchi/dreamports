# Ten hits kill the boss, for 2,000 points, and when the stage's last one has burnt away a key falls from the top.

About: The enemies; Stage 1: The graveyard; boss-dies

Proof: #983; boss-dies

With ten hits at $0647 the boss's turn goes to $FC10. Sub_F7A5 plays sound $13 and leaves $0D at $070A with 32 at $070B: the game's round, at $D284, counts that down and then plays it, or the hurried music, sound $0B, if the time was short. The boss's flag $01 is set, 2,000 points are added, at sub_D902, and it stops asking for its own sound.

It burns away at $F6F6 as every enemy does, but the kinds 5, 9 and $15 take their eight shapes from $F768, not $F760. When one of those is gone and its flag $04 says the stage counted it, $C3 goes down, and at 0 $C4 is set.

The game's round sees $C4 at $D3F8 and calls sub_D529: every object after Arthur's is cleared, and the first becomes the key, kind $1E, at the top of the screen the list at $D56E gives, $50 across, with sound $0C. $EB is set, which stops the stage's own objects, its dangers and both of the round's counted sounds.

The key is bank 4's $BC9C: shape $47, its colours one on every round, falling at speed 8 until the ground is under it, flag $02. Arthur within 8 pixels takes it: $C9 stops the time and it's worth 1,000 points. The recording doesn't take it, and what the stage does after isn't ported.
