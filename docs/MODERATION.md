# Moderation

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [Previews](PREVIEWS.md) · [Written in: #129](https://github.com/NahuelGenchi/dreamports/issues/129)

## In plain words

Everything people write on this repository's GitHub is checked by the Dreamports bot against the project's rules: issues, pull requests, comments, reviews, and the threads and posts in Discussions. When a post breaks a rule, the bot acts on its own, straight away: it deletes, hides or closes the post, and tells its author why, without quoting it. By the Dreamports team's decision of 31 October 2026, moderation here is done by the bot, never by people: the bot decides, and keeps a log the team can read when it wants to.

The bot only adds friction. The one thing it deletes is a comment that the plain rules find sharing a game file or a site that shares them. It never edits anyone's words or code, approves or merges anything, or takes or releases a claim. It runs on GitHub Actions and on free models, so it costs nothing.

## What it checks

Each new or edited issue, pull request title and description, the [notes](NOTES.md) a pull request adds or changes, which it reads again at each push, comment on an issue or a pull request, and thread or comment in Discussions, as soon as it's written. Reviews and comments on a pull request's code come with a read-only token when the pull request is from a fork, so the bot checks those once an hour instead, along with whatever it couldn't judge yet. It leaves alone posts by bots, its own and the other workflows' included.

## How it decides

**The plain rules come first.** They're code, in [`.github/moderation/rules.mjs`](../.github/moderation/rules.mjs), and settle what they can without a model:

- keys, tokens and passwords in a known format, such as GitHub's, the cloud and chat services' and private keys;
- game files: links and attachments ending in `.gba`, `.gb`, `.gbc`, `.nds`, `.sfc`, `.smc`, `.iso` and the other endings of ROMs, disc images and saves, and archives named like ROMs, such as `Sonic Battle (USA).zip`;
- sites that share game files, listed one per line in [`.github/moderation/rom-sites.txt`](../.github/moderation/rom-sites.txt), linked or written out, even disguised as `site[.]com`;
- obvious spam, from phrases only spam uses;
- private email addresses and phone numbers. GitHub's noreply addresses and the project's own, such as hello@dreamports.net, are fine.

A post the rules find nothing in, with no links outside a short list of known sites, no attachments and none of the words that hint at a broken rule, is allowed without a model.

**A pull request's notes** count as part of it, and they also have to keep [the rules for notes](NOTES.md#what-a-note-cant-hold), in [`.github/moderation/notes.mjs`](../.github/moderation/notes.mjs). A file in a notes folder that can't be read as a note, such as a link or a file with another kind of name, breaks them, and so does a pull request's thirty-first note, or a pull request with more files than GitHub lists. Whatever else the rules find in a pull request's text, its notes get their own verdict, and the spam rule only reads its text, since a game's notes can well talk about a casino. Since other people's coding agents read notes before they work, a model always reads the notes that keep the rules, each after its file's path, as many at a time as it reads whole, unless they're from the repository's own people or the rules already gave the pull request a verdict.

**A model gets the rest**, with what the rules noticed: a link to a site they don't know, an attached file, words about getting games, piracy, insults, private details or takedowns, or words that talk to the bot. Its instructions, in [`.github/moderation/prompt.md`](../.github/moderation/prompt.md), sum up the project's rules from the [standard](STANDARD.md), [Clips](STANDARD.md#clips), [Previews](PREVIEWS.md) and [Notices from rights holders](RIGHTS.md). It gets the post as data, never as instructions, and answers with one key from a fixed list, alone: `allow`, `game-files`, `rom-site`, `asks-for-games`, `clip-of-original`, `personal-data`, `credential`, `abuse`, `spam`, `rights-notice` or `bad-note`. Anything else counts as no answer, and nothing the model writes is ever posted. When it's unsure, it allows the post.

## What it does

Each verdict has a fixed plan, written in code, for each kind of post:

| Verdict | A comment or review | An issue or a thread | A pull request |
| :--- | :--- | :--- | :--- |
| Game files, or a site that shares them | Deleted, and a reply; hidden as off-topic instead when a model decided, for a review, or for a comment in Discussions with replies | A reply, then closed and locked | A reply asking to edit it out |
| Asks for a game | A reply | A reply, then closed | A reply |
| Clip of the original | Hidden as off-topic, and a reply | A reply, then closed and locked | Nothing: it's allowed there |
| Private details, or a key, token or password | Hidden as off-topic, and a reply | A reply asking to edit it out | A reply asking to edit it out |
| Abuse | Hidden as abuse | Closed and locked as too heated | Closed and locked as too heated |
| Spam | Hidden as spam | Labelled `spam`, closed and locked | Labelled `spam`, closed and locked |
| Notice from a rights holder | Its issue, pull request or thread labelled `rights-notice`, and a reply | Labelled `rights-notice`, and a reply | Labelled `rights-notice`, and a reply |
| A note that breaks the rules for notes | Nothing: only a pull request has notes | Nothing: only a pull request has notes | A reply asking for a fix, once for each push while it stands |

A deleted comment is gone for everyone. The bot deletes only when the plain rules found a game file or a site that shares them, which they rarely get wrong, since a deletion can't be undone; a review can't be deleted, and a comment in Discussions that has replies is only hidden, so the replies stay. A hidden comment shows GitHub's reason, such as off-topic, spam or abuse, and stays readable for whoever opens it. A post the bot closes and locks can't get more comments. A reply names the post's author, links the post, unless it was deleted, and the rule, never quotes the post, and ends with a line saying it comes from the Dreamports bot. In Discussions it goes under the comment it answers, or at the end of the thread when that comment is deleted or hidden, since GitHub takes no replies under a hidden comment. A reply to a key, token or password asks its owner to revoke it, since anyone may have copied it already.

**Clips of the original** are welcome in pull requests, as [Clips](STANDARD.md#clips) says. Comments and reviews on a pull request count as the pull request's, so the bot only acts on clips of the original anywhere else, Discussions included.

**The repository's own people**, its owner, members and collaborators, are never hidden or closed: when the plain rules find something in one of their posts, the bot only flags it in the log, once for each reason, and it never sends their posts to a model. The same goes for comments starting with `/claim` or `/release`, which the [claims workflow](TEAMS.md) answers: the bot never hides them, answers them or sends them to a model. One gap: in a repository that belongs to an organization, GitHub only tells the workflow about the members whose membership is public, so the bot treats a member whose membership is private like anyone else.

**What it never does.** The bot only deletes and hides comments, replies with its fixed texts, closes and locks issues, pull requests and threads, and adds its labels: `spam`, `rights-notice` and `moderation-waiting`. It never deletes anything else, unhides or reopens anything, edits anyone's post or code, approves, merges or pushes, assigns anyone, or takes or releases a claim.

## The log

The bot opens one issue, *Moderation log*, labelled `moderation-log`, the first time it needs it, and locks it. It adds a comment there for each thing it does and each post it flags: what it did, a link to the post, its author's name written as code, so nobody is notified, the reason, and whether the plain rules or which model decided. It never quotes a post. A link to a comment it deleted leads nowhere, but the entry still says what the comment was and why it went. Its links leave out `https://github.com`, since GitHub notes a full link to an issue in that issue's own timeline, as "mentioned this", which would mark every post the bot checks.

Each run of the [workflow](../.github/workflows/moderation.yml) also has a summary, on its page in the repository's Actions tab, with every post it checked, its verdict, and what decided it.

## The model

The bot treats the model like the post it reads: as something that could try anything, and so gets nothing it could misuse.

- **OpenCode's free models first.** The workflow runs the [OpenCode](https://opencode.ai) program, version 2.0.29, downloaded from npm and checked against its SHA-256 before it runs. It runs without a screen, in an empty folder with an empty home of its own, with no account and no key, in a step of the workflow whose environment holds no token at all. Its config refuses every tool. Its `read` tool is set to ask rather than refused, since OpenCode's free models refuse a request that offers no tool at all, and a run with nobody to ask refuses each read before it happens, so the model can't open a file.
- **Which models.** The repository variable `MODERATION_MODELS` lists them in order. When it isn't set, they're `deepseek-v4.1-flash-free` and `glm-5.3-flash-free`, OpenCode's free models whose provider keeps nothing and doesn't train on what it gets. The bot asks the first one OpenCode lists at that moment, and refuses any model whose id doesn't end in `-free`, so it can never reach a paid plan.
- **No other model.** OpenCode's free models can be down, and OpenCode publishes no limit on how much they answer. None was reached in testing; the only "Free usage limit reached" seen came from runs that offered no tool at all, as above. The bot has no other model to ask: GitHub Models' free tier, which it was meant to fall back on, was [retired](https://docs.github.com/en/github-models) on 30 July 2026, and every other service needs an account and a key. So when neither model answers, the post waits, as the next part says.

## When no model answers

Nothing happens to the post: it waits. Its issue, pull request or thread gets the `moderation-waiting` label, and the bot opens one issue labelled `moderation-alert`, which says its models stopped answering and lists each post that waits. The hourly run asks again, notes the time on that issue, and closes it once nothing waits. A post that still waits after a week is left as it is, and the log says so.

## What the bot leaves to GitHub

These stay with GitHub's own tools, for the account that owns the repository:

- **Deleting other posts.** The bot deletes only comments in which the plain rules find a game file or a site that shares them, as the Dreamports team decided in [#129](https://github.com/NahuelGenchi/dreamports/issues/129). What else it hides or closes stays readable, and deleting that is up to the account that owns the repository: GitHub only lets admins delete an issue, and a pull request can't be deleted.
- **Blocking someone** who keeps breaking the rules, which keeps them out of the repository's issues, pull requests and Discussions, and reporting them to GitHub.
- **Limiting interactions** during a wave of spam, from 24 hours to 6 months, in the repository's settings under *Moderation options*: to accounts older than a day, to people who have contributed before, or to collaborators.
- **Reporting a preview** that misbehaves to GitHub, which can take a Pages site down.

## How it's built

The [workflow](../.github/workflows/moderation.yml) has two jobs. The judging job can only read. It reads each post through GitHub's API, applies the plain rules, asks a model about what they leave, and writes its verdicts as JSON, with no text from any post in them. The acting job has the write permissions. It takes the verdicts only if they fit a fixed schema, reads each post again from GitHub rather than from the verdict, and carries out the fixed plan for its verdict. A verdict that doesn't fit is dropped, so it does nothing.

Both jobs check out only `.github/moderation/`, from the default branch, or for a pull request from the branch it would merge into. A pull request's own code is never checked out or run, not even for a pull request from a fork, whose text and notes the bot reads through the API. Runs about one post wait for each other, so a post edited twice is judged as it ends up.

| File | What it holds |
| :--- | :--- |
| `.github/workflows/moderation.yml` | The workflow: when it runs, its two jobs and their permissions |
| `.github/moderation/rules.mjs` | The plain rules |
| `.github/moderation/notes.mjs` | What a note is and the rules for notes, which the build and the proof tools use too |
| `.github/moderation/rom-sites.txt` | The sites that share game files |
| `.github/moderation/prompt.md` | The model's instructions |
| `.github/moderation/model.mjs` | How OpenCode is installed, locked down and asked |
| `.github/moderation/verdicts.mjs` | The keys, the schema of verdicts, the plans, the replies and the log's entries |
| `.github/moderation/judge.mjs`, `act.mjs`, `github.mjs` | The two jobs, and the calls to GitHub's API |
| `.github/moderation/test.mjs` | The unit tests of the rules and verdicts, which `npm run check` runs |

## For the Dreamports team

- **A site the bot missed**: add its domain to `.github/moderation/rom-sites.txt`, in a pull request of its own.
- **The repository variables**, in the repository's settings under *Secrets and variables*, *Actions*, *Variables*: `MODERATION_MODELS`, above, and `MODERATION_TREAT_AS_PUBLIC`, only for tests. It lists accounts whose posts the bot judges like anyone else's, even if they're the repository's own people, so their test posts can be hidden. Leave it unset otherwise.
- **To check everything at once**, run the workflow from the Actions tab: it does what the hourly run does.
