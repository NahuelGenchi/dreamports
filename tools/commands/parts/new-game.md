# A whole new game

The `/dreamport` command's step 8.

Write a New Dreamport issue's text to a file outside the repository, and run `gh issue create --repo NahuelGenchi/dreamports --title "Dreamport: <game>" --body-file <file>`. The bot reads it by its headings, so write them exactly like this, with the game's own console and the sources you found, and a folder of lowercase letters, numbers and single dashes:

```markdown
### Game

Sonic Battle

### Game folder

sonic-battle

### Console

Game Boy Advance

### Where it starts

Sonic moving in the first arena.

### Ports and sources

_No response_

### Your copy

- [X] I have my own legal copy of the game, and nothing from it, such as its files, saves or pictures, goes in the repository.
```

Wait half a minute and read the bot's answer. If someone was faster, go back to step 7. If it's theirs, make the branch of step 9, then map all of the game before any code (`docs/STANDARD.md`, How progress is measured): write `games/<game>/proof/original.json` from what `npm run dp -- rom <their copy>` says about it, its `console`, the id `rom` gives, such as `gba`, its `name`, such as `Sonic Battle (USA)`, the `title` and `code` in its header, and its `sha1`. Run `rom` on it again, then `npm run dp -- codemap <game>`, with `--from <list>` when a decompilation or a disassembler lists the game's functions. Commit nothing yet. Run `npm run dp -- new <version> --commit --yes`, which writes the game's first files, commits them with its map, and sends that commit as a pull request of its own, which merges by itself so the game's issue shows its map. Leave what it writes as it is, and carry on without waiting for that pull request: in C, its entry and license in `games/<game>/` and its only version in `games/<game>/c/`. Open the window for its card, as the end of step 9 says. Write `games/<game>/proof/parts.json`, every part of the game in the order a player meets them, then its other modes, with its `foundations`, what many parts build on but no player would call a part, such as a fighting game's fighting, and for each part what it `needs` of those, as `games/sonic-battle/proof/parts.json` does, commit it, and run `npm run dp -- tasks <version> --yes`.
