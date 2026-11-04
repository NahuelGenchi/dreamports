# An act's music runs a frame ahead of the sounds its first frame starts, which decides who gets a channel.

About: tails-neo-green-hill; knuckles-neo-green-hill; amy-neo-green-hill; the whole game

Proof: #90; knuckles-neo-green-hill

The stage's init starts the music before the sound library runs and the act's first frame after it, so on the console the music is one frame further on than any sound effect the game starts later, compared with the kit, which runs the game's frame first. It only shows when two sounds compete: a Game Boy channel still held by a sound effect turns a music note down, and with the music a frame behind that note got the channel instead. That made single frames differ by 11 to 12 dB at quiet moments of the music, such as frames 3055 and 7375 of `knuckles-neo-green-hill`. Running the sound engine one whole frame as the act's music starts fixes it for the act's first start, in `music.js`: running only the music's player that frame also fixed it, but left the first note's sample a frame behind, which made frame 1709 of `tails-neo-green-hill` differ by 10.3 dB. Acts that follow one another, and a restart after losing a life, start their music from inside a frame and aren't changed.
