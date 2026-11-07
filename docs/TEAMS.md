# Claims and teams

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Previews](PREVIEWS.md) · [Issues](https://github.com/NahuelGenchi/dreamports/issues)

Every Dreamport has one lead, and each of its tasks one person at a time, so nobody does the same work twice. Claims are issues in this repository, and the Dreamports bot answers them within seconds. Each game has one issue of its own, its **game's issue**, which lists every piece of the game and is where people talk about it. When several people work on one game, the lead's **team build** gathers their finished pieces, and its preview, the **team preview**, shows everyone's work together before the Dreamports team reviews it. With a coding agent, [`/dreamport <game>`](../README.md#make-a-dreamport) takes a free task or a whole new game for you, makes it, and sends it on.

## Where a game stands

```sh
npm run dp -- find sonic battle
```

`find` takes a game's folder or a few words of its name. It shows the game's lead, its game's issue, its two numbers, code ported and gameplay proven, its Make page, its team build and team preview, and the pieces under its game's issue: who has claimed which, the ones free to start, what the waiting ones need, and how many are done. If nobody makes a Dreamport of the game yet, it says so. With no game, it lists every Dreamport and every game claimed so far.

## Start a Dreamport

Open a [New Dreamport](https://github.com/NahuelGenchi/dreamports/issues/new?template=new-dreamport.yml) issue. It names the game, its folder in `games/`, such as `sonic-battle`, its console, and where it starts, usually where a player starts. Opening it claims the whole game: you're its lead, and the issue becomes the game's issue. The bot assigns the issue to you, gives the game a label, which is its folder's name, and a milestone named after it, such as *Sonic Battle Dreamport*. If the game already has a Dreamport, or an earlier New Dreamport issue claimed it, the bot closes yours instead, and says who leads it and what's still free.

The lead maps the whole game first, with its [code map](../tools/README.md#the-code-map-and-the-two-numbers), so its progress map shows all of it from the start. Then `npm run dp -- new <game>/c` writes its first files, as a new game starts in C ([Versions in other languages](../games/README.md#versions-in-other-languages)), with the kit's controller, touch screen, settings and start screen wired in, and its [entry](../games/README.md#the-entry), which names its game's issue as `issue: <number>`. With a [capture](STANDARD.md#a-games-capture), that's its first entry. Then the lead lists the game's parts in `proof/parts.json`, `npm run dp -- tasks <game>/c` opens a task for each, and the lead builds the first playable piece. `/dreamport` does all of this, with the window for the capture open beside it as soon as the first files are written, and sends the capture as the first entry, apart from the first task's pull request, which takes a normal review.

### A game's first entry

A pull request with only what `new` and `capture` wrote, from the game's lead, comes in with no review of its code, and gives the game its place in the [Make row](MAKE.md). The Dreamports bot, in `.github/workflows/first-entry.yml`, reads the pull request through GitHub's API and runs nothing from it. It writes the page, the code, the license, the entry, the port map, the progress map and the new row in `docs/STATUS.md` again from `proof/original.json` and the claim, and compares them byte by byte. Only `original.json`, the code map and the capture are the lead's, so those must have the exact shapes the tools write, with no words of anyone's beyond the game's name, and the capture's files can hold only pictures.

What it can't check is that the capture really is the game, as GitHub has no copy to compare it with. So it asks, in a comment with the capture and a box. Ticking the box takes someone who runs this repository, and merges that very commit once the moderation bot has read the pull request. A new push clears the box. When anything is other than the tools wrote, it says why in a fixed sentence, and the pull request takes a normal review. A first entry made of exactly the two commits the tools make, the game's first files and its capture, in the tools' own words, keeps them when it merges, as nothing else can come along with them, and the first task's branch, which starts from those first files, stays clean. Anything else is squashed, which leaves that branch to be brought up to date by hand. Later steps, which have code, always do: a game's code runs on the same address as players' sessions, and GitHub can't play the game to prove it matches.

## Tasks

A task is one piece of a game: a character, a level, a mode, an achievement, an extra, a foundation, or a difference from the original. Anyone can suggest one with the [Task](https://github.com/NahuelGenchi/dreamports/issues/new?template=task.yml) form, and ticking *I'm taking this task myself* claims it at once. The bot puts each new task under its game's issue, as a sub-issue, so the game's issue lists every piece with its state and who has it, such as [Sonic Battle Dreamport's](https://github.com/NahuelGenchi/dreamports/issues/123). Sonic Advance Dreamport's older issues, made before the forms, are under its game's issue too. The lead can drag the pieces there into the order a player meets them, and `find` lists them in that order.

`npm run dp -- tasks <game>` opens a task for each of a game's foundations and parts that has none yet, its foundations first and then its parts in the order `proof/parts.json` lists them. It opens them one at a time, waiting for the bot to put each under the game's issue, so it takes a few minutes, and a second run for the same game waits for the first to end rather than opening each task again. To take a free task, comment `/claim` on its issue. The first claim wins: the bot assigns the issue to whoever claimed first, and anyone after is told who has it and what's still free. `/release` gives a task back. On a New Dreamport issue, the same two words take and give back the lead.

### What a task needs

A game's tasks aren't one long line. Some can't be finished before another is, and most can, so a game's `proof/parts.json` says which:

```json
{
  "foundations": [
    { "name": "The fighting", "what": "A fighter moving and attacking against another in an arena." }
  ],
  "parts": [
    { "name": "The main menu" },
    { "name": "Battle mode", "needs": ["The fighting"] }
  ]
}
```

A **foundation** is what many parts build on but no player would call a part, such as a game's fighting. It gets a task of its own, of the kind Foundation, so it can be seen, taken and finished before what needs it, and it doesn't count towards [gameplay proven](STANDARD.md#how-progress-is-measured). `what` says what it is, and an optional `done` says what finishes it. **Needs**, on a foundation or a part, lists what it can't be finished without. A task goes by the same name as what it's for. The tools, the site and `npm run check` stop if a name in `needs` isn't in the file, or if needs go round in a circle.

A task is **free** when it's open, nobody has claimed it, and everything it needs is finished: its issue is closed, or for a part with no issue, the file names its recording. `find` also counts a piece the team build holds as finished, as members start from the team build. It lists what's free, foundations first, as they hold other pieces up, and each waiting task with what it needs. The Make pages count only what's free, and the bot lists only what's free. `/dreamport <game>` takes the first free task, and `/dreamport <game> <piece>` takes the piece named when it's free. Anyone can still `/claim` a waiting task, to prepare it, and the bot says what it needs.

A game's [version in another language](../games/README.md#versions-in-other-languages) has tasks of its own, under the same game's issue: `npm run dp -- tasks <game>/c` opens one for every foundation and part the version hasn't proven, each named after it with the language after it, as *Task: Title screen in C*. A task in C needs what its part needs, in C, and in a game with a JavaScript version, the same part in JavaScript first, as the C is written from the JavaScript. A game that started in C, with no JavaScript version, has its tasks in C alone, written from the original, which wait on nothing in another language, and a part with no issue is finished once the file names its recording, as in JavaScript. A JavaScript version added to it later waits for each part in C instead. Its issue keeps the game's own folder, and the Task form says to end its title with the language. `npm run dp -- find <game>` lists the free tasks of each language apart, C's first, as C is the default language, and `/dreamport` takes a task in C unless none is free or they ask for JavaScript.

What comes before a part in the game isn't something it needs. A late level can start from a [start point](../tools/README.md#start-points), so `needs` lists only what a piece can't be finished without, and the rest can go in any order.

Whoever an issue is assigned to has it. The Dreamports team can also assign and unassign issues by hand, and the bot leaves those as they are. Either way, the game's page in the Make tab on dreamports.net shows how many pieces are still free a few minutes later ([The Make pages](MAKE.md)).

## Going quiet

A claim with no activity for 14 days is released, with a friendly note on its issue. A claim on a foundation is released after 7, as other pieces wait on it. Activity is anything its holder does on the game's issues and pull requests in this repository, such as a comment or a pull request that mentions the task. Nothing done so far is lost: the work and its preview stay where they are, and anyone can claim it again, the same person included.

A lead's claim is released the same way. The team build stays in their fork, so the next lead starts from it.

## Team builds

The team build is a branch of the lead's fork, `team/<game>`, that gathers the team's finished pieces. Members start from it, so each one's preview shows the team's game with their own piece. A finished piece goes to the lead as a pull request from the member's fork to the lead's: GitHub allows one between any two forks of this repository. The lead's tools prove each piece before adding it, and the team preview updates once it's in.

| Who | Command | What it does |
| :--- | :--- | :--- |
| The lead | `npm run dp -- team <game> start` | Makes the team build in the lead's fork, from the commit they're on |
| A member | `npm run dp -- team <game> join <branch>` | Starts a branch of their own from the team build as it is now |
| A member | `npm run dp -- team <game> send --task <number>` | Pushes their branch to their fork and opens a pull request to the team build, with the task, the two numbers and, with `--as <preview>`, their preview. The task is one of the pieces under the game's issue, and without `--task` it's the one piece they have. `--draft` opens it as a draft, for a piece that isn't finished |
| The lead | `npm run dp -- team <game> add <number>` | Takes the piece in, as below |

`add` runs on the lead's computer, so it stops before a piece that changes anything outside its game's folder, the kits in `kit/`, the table in `docs/STATUS.md` and the game's progress map, and lists those files. Once the lead has read them, `--all` takes them too. It also stops on a piece with a note that breaks [the rules for notes](NOTES.md#what-a-note-cant-hold), and shows the lead the title of each note a piece brings, since the team's agents read them from then on and the Dreamports bot only sees them when the team build reaches a pull request here. Then it merges the piece into the team build. When the piece and the team build both changed the game's proof files, the table in `docs/STATUS.md` or the progress map, it keeps the team build's, since the next step writes them again. Then it runs `portmap` and `prove`, and only if no frame that matched the original before differs now, no part stops being proven and code ported doesn't drop, it commits the merge and pushes the team build, which shows the pull request as merged. Last, `share` updates the team preview, at `https://<lead>.github.io/<fork>/<game>/`, which the game's entry links as `preview`. If anything got worse, the team build stays as it was, and the pull request is where to say why.

`send` and `add` ask before they push or open anything, and `--yes` answers yes, once the person has said yes. When the team build lives in a fork that isn't the lead's own, such as one of an organisation's, `--team <owner/name>` names it.

When part of the game is ready, the lead sends the team build to this repository as a pull request, which the Dreamports team reviews before it goes live. The repository never builds anyone's unreviewed code: previews and team previews live on contributors' own GitHub Pages.

## How the bot works

The bot is a workflow, [`claims.yml`](../.github/workflows/claims.yml). It answers new New Dreamport and Task issues and every comment that starts with `/claim` or `/release`, and once a day, at 05:23 UTC, it answers anything a run missed and releases the quiet claims. It reads a game's `proof/parts.json` from `main`, to list only what's free, and it counts only closed issues as finished, as it doesn't look in team builds. It puts each new Task issue under its game's issue: the New Dreamport issue the game's entry names, or for a game with no entry yet, its open New Dreamport issue. A task that's already under another issue stays there, and an issue someone moves under a game's issue by hand is one of its pieces too, which `/claim` takes. It only reads the issues' text and the repository's files, through GitHub's API, and never runs anything from them. Its answers end with a hidden note of what they answer and what they did, so nothing is answered twice, and the daily run only releases claims the bot itself made.

A game's label is named after its folder, and its description says so, such as *Sonic Battle Dreamport, in games/sonic-battle/*, so a game can't take the name of another label, such as `bug`. A game's issues go in the milestone its issues already use, which for Sonic Advance Dreamport is M4, or else one named after the game, which the bot makes. [Project tracking](TRACKING.md#metadata-only-automation) leaves them to it.

To try a shorter release period, run the workflow by hand from the repository's Actions tab, with *days* set to a fraction of a day.

A second workflow, [`issue-maps.yml`](../.github/workflows/issue-maps.yml), keeps each game's [progress map](STANDARD.md#how-progress-is-measured) at the top of its game's issue. An issue opens before its game has a map, so the picture appears when the game's first map reaches `main`, and changes with it. The proof tools draw the map and `npm run check` holds it to the game's `proof/` folder, so this workflow draws nothing and asks no model anything: it only puts the finished picture in the issue, and edits the issue only when the picture changed. An issue shows a game's map only when the game's entry names that issue, so opening another issue for the game doesn't get one. It runs after each push that changes a map, and once an hour, for a merge made by another workflow, as a first entry's is, which starts no run by itself.
