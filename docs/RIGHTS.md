# Notices from rights holders

[Back to README](../README.md) · [Contribution workflow](../CONTRIBUTING.md) · [The Dreamport standard](STANDARD.md) · [Written in: #82](https://github.com/NahuelGenchi/dreamports/issues/82)

## In plain words

Dreamports never hosts games, but the games it rebuilds belong to the people who made them. If a game's rights holder asks for something to be taken down, the Dreamports team takes it down quickly, quietly and completely. Each game lives in a folder of its own, so one change removes it from dreamports.net and from the source code, usually within one business day.

## Where notices arrive

**By email**, at [hello@dreamports.net](mailto:hello@dreamports.net?subject=Rights%20notice), ideally with "Rights notice" in the subject. The [About page](https://dreamports.net/about/#rights) asks for the game, what to remove, who sends it or whom they act for, and how to reach them. The address forwards to the Dreamports team.

**Through GitHub**, which keeps the source code. GitHub passes a notice about this repository to its owner and usually gives about one business day to remove what it names, as its [takedown policy](https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy) explains. A notice there can also name forks of the repository, which GitHub handles itself.

**Through Cloudflare**, which serves dreamports.net, and passes reports about the site on to the Dreamports team.

## What the Dreamports team does

1. **Answers within a business day**, to say the notice has arrived, and asks for anything missing, such as which game it means.
2. **Opens an issue** to remove the game, which says only that a rights holder asked. It never names the sender or shares their message.
3. **Removes the game in one commit**, as [removing a game](../games/README.md#removing-a-game) explains: its folder in `games/`, with its entry, code and proof files; its lines in `src/lib/players.ts` and `public/dreamports.js` if it keeps achievements; its recordings in `public/media/`, if it has any; and its row in the README's table, written again by `npm run dp -- readme`. A port listed in the Mash-ups row goes the same way: its file in `src/content/games/` and its recordings.
4. **Merges it at once.** dreamports.net shows the change about a minute later, and the game's address stops working.
5. **Closes the game's work.** Its open issues are closed as not planned, and its progress thread gets a short note and is locked. The note asks its lead and team to take down their previews of it, which [Previews and progress threads](PREVIEWS.md#for-contributors-sharing-a-preview) explains how to do, since those live on their own forks.
6. **Answers the sender**, with the commit that removed the game.

All of it should take less than a business day. If a notice asks for less than a whole game, such as one extra or one clip, the team removes just that, the same way.

## What a removal doesn't do

The game stays in the repository's history, as every change does. If a notice asks for it to leave the history too, the Dreamports team works out with the rights holder what's possible: taking it out of the history means rewriting it, with GitHub's help, and every fork keeps its own copy. Contributors' own forks and previews belong to them: the team asks them to take the game down, and GitHub can disable forks a notice names.

A game that was removed doesn't come back unless its rights holder agrees, or GitHub's own process for a counter-notice decides it can. Nobody argues a notice in public.

## Why it's quick

Every Dreamport lives in its own folder in `games/` since [#74](https://github.com/NahuelGenchi/dreamports/issues/74), with nothing of it elsewhere but the few lines listed above, so removing one never touches another. The repository never holds anything from a game, such as its files, graphics or sounds, as the [standard](STANDARD.md#nothing-from-the-game-is-ever-shared) asks, so there's nothing else to find and remove.

Clips that show the original game appear only in pull requests and progress posts, as [Clips](STANDARD.md#clips) says, never on dreamports.net. A rights holder who wants one removed can say so on it, or write to the address above, and the team takes it down, or asks its author to.
