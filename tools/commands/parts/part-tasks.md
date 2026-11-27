# A part of the game, a function at a time

For the `/dreamport` command, when `find` said the task is a part of the game and gave its functions, or said it has no recording of the original yet. Such a game is made a function at a time, and its tasks are its parts (`tools/lib/part-functions.mjs`): a part's task is the functions the original runs in that part that no part before it runs, each proven as `tools/commands/parts/functions.md` says, and the part is done when each has its proof and its recording matches the original on every frame of the part. So the person finishes something a player would know, such as a menu or a level, and nothing of it comes in without its proof.

## A part with no recording yet

Nothing says which functions a part runs until the original has been played through it. Make that recording first, on the original alone, as `npm run dp -- help proving a part` says: play the whole part with `npm run dp -- play <game> --record`, or `--record --from` where another recording reaches it, find its first and last frames, and write the part's `recording` and `frames` in `games/<game>/proof/parts.json`. Run `npm run dp -- prove <version>`: it plays the original and keeps the functions it ran in those frames in `games/<game>/proof/part-functions.json`, which only it writes. The Dreamport needn't match a frame of it yet. Commit the recording, `parts.json` and that file, run `npm run dp -- tasks <version> --update --yes`, which writes the functions into the part's task, and run `npm run dp -- find <game> --take` again: it now gives how many functions the part has and the command that lists them.

A later part can be recorded before the parts before it are done. Its task then has what it runs that the earlier parts don't, and those functions can be proven right away, as a proof needs nothing played.

## Its functions, a few at a time

List them with the `npm run dp -- proofs <version> "<part>"` line `find` gave. A part can have hundreds, so it goes out in several pull requests. Work in small waves of 3 to 5 functions at a time, starting with those the game calls first: read just that wave with one `npm run dp -- read <game> <addr1> <addr2> ... --quiet` call, write their twins, and prove the wave together with `match` or `twin` before reading the next wave, so the session's context stays light. Avoid reading whole decompilation files or unrelated source files; read only the functions in the current wave. A twin is put right from what `match` and `twin` say of it, never from a picture.

The list is what the original ran in the part's frames. A function the part's code only names, as an address it keeps or hands on, or calls on a path the recording never takes, isn't in it, and the part is done without it: name it in the twin by its address, as the game's `addresses.json` gives it, and leave it without C. On the Game Boy and the Game Boy Color, where a twin calls a function in C, make it an empty function with `dp:stop` and the original's function in the comment just above it, and its contract when it takes or gives anything: `twin` runs the original's function for each call to it (`npm run dp -- help the function check on the Game Boy`). `npm run dp -- proofs <version> <address>` says which task has it, or that none has yet. Write it now only if the game stops there for want of it.

Then let the game play them: have the game's code call the new twins where the original calls them. For a partial pull request that leaves other functions of the part for later, run `npm run dp -- prove <version> <the part's recording> --quick` first to confirm the new twins match at least as far as `main` did, then go straight to `npm run dp -- ready <version>` (which proves every recording once). Do not spend rounds chasing pre-existing differences on later frames or other recordings that already differed on `main` and belong to functions not ported yet. This is what lets anyone play the game as far as it has come.

## When a pull request goes out, and when the part is done

Run `npm run dp -- ready <version>` for a pull request that proves some of the part's functions and leaves others. It passes when every proof kept still holds and no frame that matched before differs. That pull request names the task with `Refs #<task>`, never `Closes`, lists each function it proves under Changes, and the task stays theirs. In step 13's Progress, say how far the part is, as in `The main menu: 36 of 212 functions proven, and its recording matches to frame 410 of 955.`

The part is done when `npm run dp -- ready <version> --task "<part>"`, the line `find` gave, says each of its functions has its proof and the part is proven by its recording. Only that pull request closes the task.

When every part of the game is done, what's left is the code no recording ran. `tasks` then opens it as tasks of functions, groups that sit together in the code map, made as `tools/commands/parts/functions.md` says.
