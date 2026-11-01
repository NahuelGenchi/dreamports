# Previews

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](STANDARD.md) · [The proof tools](../tools/README.md) · [Written in: #78](https://github.com/NahuelGenchi/dreamports/issues/78) · [Posts left out in: #144](https://github.com/NahuelGenchi/dreamports/issues/144)

## In plain words

Nobody has to wait for the Dreamports team to see new work on a Dreamport. Whoever made it can put a **preview** online themselves: the game as it is on their branch, playable in a browser, on GitHub Pages from their own fork of this repository. It's free, online in a minute or two, and needs nobody's approval. One command does it, `npm run dp -- share`, and it asks before it publishes anything. It posts nothing: each step's pull request links its preview and shows its clip, and the game's page in the Make tab on [dreamports.net](https://dreamports.net/make/) lists its steps.

Pull requests from forks get no preview on dreamports.net's own hosting, so previews on contributors' own GitHub Pages are how everyone tries work in progress.

## For players: what a preview is

A preview is someone's work in progress, at an address like `https://<name>.github.io/dreamports/<preview>/`. It plays like a game on dreamports.net: you give it your own copy of the game, made from your own cartridge or disc. A preview holds only code, never anything from the game. Its first page and a notice at the top of the game say who made it.

**A preview hasn't been reviewed.** The Dreamports team checks every change before it reaches dreamports.net, but nobody has checked a preview. Its author can put any code in it, and change it at any time, even after you've looked. Like any web page, it can do whatever it wants with the copy you give it, including sending it somewhere else. Play previews only from people you trust.

**What it keeps belongs to its author's address.** Your saves, settings and achievements in a preview, and your copy if you let it remember it, are kept in your browser for `<name>.github.io`, and every page that person publishes on GitHub Pages can read them. To keep your copy to yourself, untick *Remember on this device* before you play, or use *Forget the saved ROMs* afterwards. Clearing the site's data in your browser's settings removes everything a preview kept.

**It can't touch your profile.** A preview never runs on dreamports.net. Your sign-in belongs to dreamports.net, your browser doesn't send it to other addresses, and dreamports.net only accepts changes from its own pages. So a preview can't see or change your profile, and the achievements you earn in it stay in that browser. dreamports.net never asks you to sign in on a preview: if one does, don't, and say so on the game's issue.

## For contributors: sharing a preview

You need your own fork of this repository, with your work committed on a branch of it, and the [GitHub CLI](https://cli.github.com) signed in with `gh auth login`. If you cloned this repository rather than your fork, `gh repo fork --remote` makes your fork and adds it. With a coding agent, [`/dreamport-share`](../README.md#make-a-dreamport) does all of this for you, and asks before each step.

```sh
npm run dp -- share sonic-advance
```

That publishes a preview of `games/sonic-advance/` as it is in your last commit, at `https://<you>.github.io/dreamports/sonic-advance/`. `--as <name>` gives it another name, such as `sonic-advance-springs`, so you can keep several. A preview of the same name replaces the last one.

`--about "Springs bounce Sonic as high as in the original."` puts a sentence of what changed on the preview's first page.

Before anything goes online, `share` shows what it will publish and where, and asks. The first time, it also asks to switch GitHub Pages on for your fork. `--yes` answers yes to every question, for when you've already said yes, for example to an agent working for you. Once the preview is published, `share` waits until GitHub has built it and the address shows it, which usually takes a minute or two, and gives you the link and the lines that show the clip in your pull request.

**What goes in a preview.** Only what's in your last commit: the game's folder, the kits, and the site's own files the game's pages load, such as its icon. Changes you haven't committed stay out, and `share` lists them. It refuses anything the repository's ignore rules keep out, such as ROMs and saves, and any file that is a copy of a game. It adds a stand-in for the site's `/dreamports.js`, which saves no achievements to a profile and shows the notice, a first page with the warning above, and a page listing all your previews. Previews are kept out of search engines.

**The clip.** `npm run dp -- prove` makes a clip of the original and the Dreamport side by side, `clip.mp4`, and one of the Dreamport on its own, `dreamport.mp4`. `share` takes the newest side-by-side one, since it shows the match, and `--clip <file>` takes another MP4 or PNG instead, under 2 MB, such as `dreamport.mp4`. A clip of the original may appear in pull requests, and nowhere else, as [Clips](STANDARD.md#clips) says. GitHub can't attach a video to a pull request from the command line, so the clip goes on your previews site, in `clips/`, apart from the preview, which never shows it, and `share` prints the lines for the pull request: one of its frames, which opens the clip. Clips stay there when a preview is replaced, so older pull requests keep theirs.

**Where it all lives.** Your previews are on a branch of your fork called `dreamports-previews`, one folder each, which GitHub Pages serves. GitHub builds it with its own *pages build and deployment*, which runs even though a new fork's own workflows stay off until you allow them, so you don't need to allow them. `share` makes its commits with git alone, so your own branch, folder and staged changes stay as they are. To take a preview down, delete its folder from that branch on GitHub. To take them all down, switch Pages off in your fork's settings, under Pages.

**Free.** GitHub Pages is free for public repositories. A Pages site can hold up to 1 GB, which is about a hundred previews of a game the size of Sonic Advance Dreamport, and GitHub builds it up to about ten times an hour.

## For the Dreamports team: keeping it tidy

The Dreamports bot moderates what people write on GitHub on its own, as [Moderation](MODERATION.md) explains, previews' links included: it checks a link to a preview like any other, and leaves its author's own previews alone. Clips of the original are welcome in pull requests, as [Clips](STANDARD.md#clips) says, so the bot leaves them there and hides them anywhere else.

What the bot leaves to GitHub, such as blocking someone or reporting a preview to GitHub, is listed in [What the bot leaves to GitHub](MODERATION.md#what-the-bot-leaves-to-github).

## Words used here

**Fork.** Your own copy of this repository on GitHub, where you can push branches without asking anyone.

**GitHub Pages.** GitHub's free hosting for a repository's web pages, at `<owner>.github.io/<repository>/`.

**Preview.** A game as it is on someone's branch, published on their own GitHub Pages, not reviewed.
