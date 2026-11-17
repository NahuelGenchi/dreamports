# A task of functions

For the `/dreamport` command, when `find` said the task is functions of the original: it then gave how many, the command that lists them and the one that says the task is done. Such a game is made a function at a time (`docs/STANDARD.md`, Twins and their proof). Its parts stay as names for people and as what its recordings are for, and the task isn't a part.

## Each function, the same every time

List the task's functions with the `npm run dp -- proofs <version> <address>` line `find` gave. Take them one by one, and do the same five things for each.

1. **Read it.** `npm run dp -- read <game> <address>` prints its instructions from their copy, which stay out of every commit. Where step 4 found a decompilation whose license allows it, its code for the function can come in, with its notice. One with no license is only read as a guide.
2. **Write its twin**, in `games/<version>/src/`, in plain C, with every path of the original's: each branch, both ways. The comment just above it names the function, as in `/** Fall, 0x08000200: the ball a frame further down. */`. Every value it uses sits where the console keeps it: a name that isn't the game's yet gets its address in `games/<game>/proof/addresses.json` (`npm run dp -- help matching the original's bytes`). A function it calls that has no twin yet needs one too, written and proven the same way, whichever task lists it.
3. **Build it.** The two tools of the next step build it, and say where it doesn't.
4. **Prove it.** On the Game Boy Advance, when the game's `original.json` names its `compiler`, run `npm run dp -- match <version> <address>`: the same bytes prove every path with nothing played, so try that first, and read the file it names to see which instruction differs. When it can't come out the same, or the game names no compiler, or on the NES, run `npm run dp -- twin <version> <address>`, which calls the original's function and the twin from the same memory thousands of times. It's a proof only when its calls took every path of the original's: when it says some were left out, give it more calls with `--calls`, or another `--seed`. On the NES the twin's contract goes beside it first (`npm run dp -- help the function check on the NES`). Fix the twin from what the tool says and run it again, until it says the function is kept as proven.
5. **Only then play.** Once every function of the task is kept as proven, run `npm run dp -- prove <version>`, so the recordings that reach them still match.

Each of the two tools keeps what it proves in `games/<version>/proof/proofs.json`, and nothing else writes that file: never change it yourself, as `ready` refuses a line no tool wrote. A twin whose code changes afterwards has to be proven again. A twin with a path left out is never kept as proven, whether it's marked with `dp:stop` or not, so write the path. Only a path that truly can't be written yet gets a `dp:stop`, and then the task isn't finished: `tools/commands/parts/unfinished.md`, Not finished.

## When it's done

It's done when the `npm run dp -- ready <version> --task <address>` line `find` gave says each of its functions has its proof, and nothing that matched before differs. Run that in step 11, in place of `ready` with the version alone. A recording isn't needed for a function the game can't reach yet. Where a recording does reach the new twins and a frame changes, its clip goes with the pull request as for any step, and where none does, `share` puts the record of the proof in a clip's place by itself.

In the pull request, under Changes, list each function with its proof, as `npm run dp -- proofs <version> <address>` prints them. In step 13's Progress, say how many functions the task proved after the two numbers, as in `Its 8 functions are proven, 7 by the same bytes and 1 by the same memory.`
