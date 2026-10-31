# Claims and teams

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Previews and progress threads](PREVIEWS.md) · [Issues](https://github.com/NahuelGenchi/dreamports/issues)

Every Dreamport has one lead, and each of its tasks one person at a time, so nobody does the same work twice. Claims are issues in this repository, and the Dreamports bot answers them within seconds. When several people work on one game, the lead's **team build** gathers their finished pieces, and its preview, the **team preview**, shows everyone's work together before the Dreamports team reviews it. With a coding agent, [`/dreamport-claim`](../README.md#make-a-dreamport) takes a game or a task for you, and `/dreamport-send` sends a finished piece to the lead.

## Where a game stands

```sh
npm run dp -- find sonic battle
```

`find` takes a game's folder or a few words of its name. It shows the game's lead, its two numbers, code ported and gameplay proven, its progress thread, its team build and team preview, who has claimed which task, and the tasks that are still free. If nobody makes a Dreamport of the game yet, it says so, and it also finds the site's other games, such as a port made elsewhere. With no game, it lists every Dreamport and every game claimed so far.

## Start a Dreamport

Open a [New Dreamport](https://github.com/NahuelGenchi/dreamports/issues/new?template=new-dreamport.yml) issue. It names the game, its folder in `games/`, such as `sonic-battle`, its console, and where it starts, usually where a player starts. Opening it claims the whole game: you're its lead. The bot assigns the issue to you, gives the game a label, which is its folder's name, and a milestone named after it, such as *Sonic Battle Dreamport*. If the game already has a Dreamport, or an earlier New Dreamport issue claimed it, the bot closes yours instead, and says who leads it and what's still free.

The lead builds the first playable piece, then splits what's left into tasks.

## Tasks

A task is one piece of a game: a character, a level, a mode, an achievement, an extra, or a difference from the original. Anyone can suggest one with the [Task](https://github.com/NahuelGenchi/dreamports/issues/new?template=task.yml) form, and ticking *I'm taking this task myself* claims it at once. A game's older issues count as its tasks too, since they carry its label, such as Sonic Advance Dreamport's.

To take a free task, comment `/claim` on its issue. The first claim wins: the bot assigns the issue to whoever claimed first, and anyone after is told who has it and what's still free. `/release` gives a task back. On a New Dreamport issue, the same two words take and give back the lead.

Whoever an issue is assigned to has it. The Dreamports team can also assign and unassign issues by hand, and the bot leaves those as they are.

## Going quiet

A claim with no activity for 14 days is released, with a friendly note on its issue. Activity is anything its holder does on the game's issues and pull requests in this repository, such as a comment or a pull request that mentions the task, or in its progress thread, such as a post `share` makes. Nothing done so far is lost: the work and its preview stay where they are, and anyone can claim it again, the same person included.

A lead's claim is released the same way. The team build stays in their fork, so the next lead starts from it.

## Team builds

The team build is a branch of the lead's fork, `team/<game>`, that gathers the team's finished pieces. Members start from it, so each one's preview shows the team's game with their own piece. A finished piece goes to the lead as a pull request from the member's fork to the lead's: GitHub allows one between any two forks of this repository. The lead's tools prove each piece before adding it, and the team preview updates once it's in.

| Who | Command | What it does |
| :--- | :--- | :--- |
| The lead | `npm run dp -- team <game> start` | Makes the team build in the lead's fork, from the commit they're on |
| A member | `npm run dp -- team <game> join <branch>` | Starts a branch of their own from the team build as it is now |
| A member | `npm run dp -- team <game> send --task <number>` | Pushes their branch to their fork and opens a pull request to the team build, with the task, the two numbers and, with `--as <preview>`, their preview |
| The lead | `npm run dp -- team <game> add <number>` | Takes the piece in, as below |

`add` runs on the lead's computer, so it stops before a piece that changes anything outside its game's folder, the kits in `kit/` and the README's table, and lists those files. Once the lead has read them, `--all` takes them too. Then it merges the piece into the team build. When the piece and the team build both changed the game's proof files or the README's table, it keeps the team build's, since the next step writes them again. Then it runs `portmap` and `prove`, and only if no frame that matched the original before differs now, no part stops being proven and code ported doesn't drop, it commits the merge and pushes the team build, which shows the pull request as merged. Last, `share` updates the team preview, at `https://<lead>.github.io/<fork>/<game>/`, which the game's entry links as `preview`. If anything got worse, the team build stays as it was, and the pull request is where to say why.

`send` and `add` ask before they push or open anything, and `--yes` answers yes, once the person has said yes. When the team build lives in a fork that isn't the lead's own, such as one of an organisation's, `--team <owner/name>` names it.

When part of the game is ready, the lead sends the team build to this repository as a pull request, which the Dreamports team reviews before it goes live. The repository never builds anyone's unreviewed code: previews and team previews live on contributors' own GitHub Pages.

## How the bot works

The bot is a workflow, [`claims.yml`](../.github/workflows/claims.yml). It answers new New Dreamport and Task issues and every comment that starts with `/claim` or `/release`, and once a day, at 05:23 UTC, it answers anything a run missed and releases the quiet claims. It only reads the issues' text and the repository's files, through GitHub's API, and never runs anything from them. Its answers end with a hidden note of what they answer and what they did, so nothing is answered twice, and the daily run only releases claims the bot itself made.

A game's label is named after its folder, and its description says so, such as *Sonic Battle Dreamport, in games/sonic-battle/*, so a game can't take the name of another label, such as `bug`. A game's issues go in the milestone its issues already use, which for Sonic Advance Dreamport is M4, or else one named after the game, which the bot makes. [Project tracking](TRACKING.md#metadata-only-automation) leaves them to it.

To try a shorter release period, run the workflow by hand from the repository's Actions tab, with *days* set to a fraction of a day.
