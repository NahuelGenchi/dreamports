# The Egg Ball's eighth hit removes the floating platforms, and the act's objects need their own range destroy for it.

About: Casino Paradise Zone act 2; sonic-casino-paradise-act-2

Proof: #739; sonic-casino-paradise-act-2

When the eighth hit beats the Egg Ball (sub_802FB2C), the original destroys every task from priority 0x2010 up to 0x2011, which are the arena's two floating thin platforms. In the C the act's objects are in their own task list, so the engine's `destroy_tasks` doesn't reach them: the platforms stayed on screen from frame 11248 of `sonic-casino-paradise-act-2`, two frames after the hit. `act_tasks_destroy` in `objects.c` removes them from that list instead, and leaves their entities marked as made, as the original does, so they don't come back.

Standing on the right-hand platform, at x 7553, Sonic can jump into the mobile on the high paths, and the ball on the low path passes under him. The boss's hit count is the signed byte at 0x030028CA in this recording, and its place is at 0x030028B0 and 0x030028B4 in 1/256 px from where it was made, (7664, 2256).
