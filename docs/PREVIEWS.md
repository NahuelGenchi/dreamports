# Previews and progress threads

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](STANDARD.md) · [The proof tools](../tools/README.md) · [Written in: #78](https://github.com/NahuelGenchi/dreamports/issues/78)

## In plain words

Nobody has to wait for the Dreamports team to see new work on a Dreamport. Whoever made it can put a **preview** online themselves: the game as it is on their branch, playable in a browser, on GitHub Pages from their own fork of this repository. It's free, online in a minute or two, and needs nobody's approval. They can also post in the game's **progress thread**, in this repository's [Discussions](https://github.com/NahuelGenchi/dreamports/discussions/categories/progress): what changed, a short clip, the game's [%](STANDARD.md#how-progress-is-measured) and the preview's link. One command does both, `npm run dp -- share`, and it asks before it publishes or posts anything.

Pull requests from forks get no preview on dreamports.net's own hosting, so previews on contributors' own GitHub Pages are how everyone tries work in progress.

## For players: what a preview is

A preview is someone's work in progress, at an address like `https://<name>.github.io/dreamports/<preview>/`. It plays like a game on dreamports.net: you give it your own copy of the game, made from your own cartridge or disc. A preview holds only code, never anything from the game. Its first page and a notice at the top of the game say who made it.

**A preview hasn't been reviewed.** The Dreamports team checks every change before it reaches dreamports.net, but nobody has checked a preview. Its author can put any code in it, and change it at any time, even after you've looked. Like any web page, it can do whatever it wants with the copy you give it, including sending it somewhere else. Play previews only from people you trust.

**What it keeps belongs to its author's address.** Your saves, settings and achievements in a preview, and your copy if you let it remember it, are kept in your browser for `<name>.github.io`, and every page that person publishes on GitHub Pages can read them. To keep your copy to yourself, untick *Remember on this device* before you play, or use *Forget the saved ROMs* afterwards. Clearing the site's data in your browser's settings removes everything a preview kept.

**It can't touch your profile.** A preview never runs on dreamports.net. Your sign-in belongs to dreamports.net, your browser doesn't send it to other addresses, and dreamports.net only accepts changes from its own pages. So a preview can't see or change your profile, and the achievements you earn in it stay in that browser. dreamports.net never asks you to sign in on a preview: if one does, don't, and say so in its thread.

## For contributors: sharing a preview

You need your own fork of this repository, with your work committed on a branch of it, and the [GitHub CLI](https://cli.github.com) signed in with `gh auth login`. If you cloned this repository rather than your fork, `gh repo fork --remote` makes your fork and adds it. With a coding agent, [`/dreamport-share`](../README.md#make-a-dreamport) does all of this for you, and asks before each step.

```sh
npm run dp -- share sonic-advance
```

That publishes a preview of `games/sonic-advance/` as it is in your last commit, at `https://<you>.github.io/dreamports/sonic-advance/`. `--as <name>` gives it another name, such as `sonic-advance-springs`, so you can keep several. A preview of the same name replaces the last one.

```sh
npm run dp -- share sonic-advance --post --about "Springs bounce Sonic as high as in the original."
```

That does the same, then posts in the game's progress thread from your account: what changed, the clip, the game's two numbers from its `proof/` folder, code ported and gameplay proven, and the preview's link. The first time anyone shares a game, `share` opens its thread, and says to add its link to the game's [entry](../games/README.md#the-entry) as `thread`, so the game's page links it.

Before anything goes online, `share` shows what it will publish and where, and asks. The first time, it also asks to switch GitHub Pages on for your fork. Then it shows the post and asks again. `--yes` answers yes to every question, for when you've already said yes, for example to an agent working for you. Once the preview is published, `share` waits until GitHub has built it and the address shows it, which usually takes a minute or two, and gives you the link.

**What goes in a preview.** Only what's in your last commit: the game's folder, the kits, and the site's own files the game's pages load, such as its icon. Changes you haven't committed stay out, and `share` lists them. It refuses anything the repository's ignore rules keep out, such as ROMs and saves, and any file that is a copy of a game. It adds a stand-in for the site's `/dreamports.js`, which saves no achievements to a profile and shows the notice, a first page with the warning above, and a page listing all your previews. Previews are kept out of search engines.

**The clip.** `npm run dp -- prove` makes a clip of the original and the Dreamport side by side, `clip.mp4`, and one of the Dreamport on its own, `dreamport.mp4`, and `--post` posts the newest side-by-side one, since it shows the match. `--clip <file>` posts another MP4 or PNG instead, under 2 MB, such as `dreamport.mp4`. A clip of the original may appear in progress posts and pull requests, and nowhere else, as [Clips](STANDARD.md#clips) says. GitHub can't attach a video to a post made this way, so the clip goes on your previews site, in `clips/`, and the post shows one of its frames, which opens the clip. Clips stay there when a preview is replaced, so old posts keep theirs.

**Where it all lives.** Your previews are on a branch of your fork called `dreamports-previews`, one folder each, which GitHub Pages serves. GitHub builds it with its own *pages build and deployment*, which runs even though a new fork's own workflows stay off until you allow them, so you don't need to allow them. `share` makes its commits with git alone, so your own branch, folder and staged changes stay as they are. To take a preview down, delete its folder from that branch on GitHub. To take them all down, switch Pages off in your fork's settings, under Pages.

**Free.** GitHub Pages and Discussions are free for public repositories. A Pages site can hold up to 1 GB, which is about a hundred previews of a game the size of Sonic Advance Dreamport, and GitHub builds it up to about ten times an hour.

## Progress threads

Each game has one thread in the Progress category of Discussions, where everyone working on it posts each step. A post made by `share` has the same parts every time: what changed, a frame of the clip that opens the clip, the two numbers, the preview's link with a reminder that it hasn't been reviewed, and the commit it was made from.

A thread names its game in its first post, under *Game folder*, such as `sonic-advance`. `share` writes it, and so does the category's form for anyone who opens a thread by hand. Anyone can open a game's thread, and a [workflow](../.github/workflows/progress-threads.yml) keeps one open thread per game: a thread that names no game, or a game that already has an open thread, gets a reply pointing to the right place, and is closed and locked.

## For the Dreamports team: keeping the threads tidy

The workflow handles duplicate threads and threads without a game. The rest is moderation, with GitHub's own tools:

- **A post that breaks the rules**, such as one with game files or a clip of the original, or one that links someone else's preview: hide it from its *…* menu with a reason, or delete it. Hidden posts stay readable for whoever opens them, so delete anything with game files in it.
- **A thread that misuses a game's name**: close it. The next `share` for that game opens a new one, since closed threads don't count.
- **A preview that misbehaves**: hide the posts that link it, say why in the thread, and report it to GitHub, which can take a Pages site down.
- **Someone who keeps breaking the rules**: block them from the account that owns the repository, which keeps them out of its issues, pull requests and Discussions, and report them to GitHub.
- **A wave of spam**: limit interactions for a while, from 24 hours to 6 months, in the repository's settings under *Moderation options*: to accounts older than a day, to people who have contributed before, or to collaborators.

## Words used here

**Fork.** Your own copy of this repository on GitHub, where you can push branches without asking anyone.

**GitHub Pages.** GitHub's free hosting for a repository's web pages, at `<owner>.github.io/<repository>/`.

**Preview.** A game as it is on someone's branch, published on their own GitHub Pages, not reviewed.

**Progress thread.** A game's thread in the Progress category of this repository's Discussions, with one post per step.
