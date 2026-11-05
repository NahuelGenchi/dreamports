---
# Sonic Advance Dreamport's entry. games/README.md explains every field, and its % comes from proof/.
title: Sonic Advance Dreamport
platform: Game Boy Advance
year: 2001
added: 2026-10-27
summary: Plays in your browser. No emulator, nothing to install.
needs: A Sonic Advance (USA) ROM (.gba)
controls: [keyboard, controller, touch]
issue: 146
lead: NahuelGenchi
kit: gba
sources:
  - name: SAT-R’s decompilations of Sonic Advance and Sonic Advance 2
    href: https://github.com/SAT-R/sa2
    license: none
    use: guide
  - name: mGBA’s window drawing, by Jeffrey Pfau
    href: https://github.com/mgba-emu/mgba/blob/0.10.5/src/gba/renderers/video-software.c
    license: MPL-2.0
    use: code
ownCopy:
  confirm: I own Sonic Advance
  links:
    - label: Play
      href: https://dreamports.net/play/sonic-advance/
      icon: play
extras:
  - name: Widescreen
    icon: aspect-ratio
    text: See more of each act, up to 368 × 208, with every pixel still sharp.
    screen:
      clip: /media/sonic-widescreen
      still: /media/sonic-widescreen-still.webp
  - name: Rush boost
    icon: zap
    text: Hold a button and Sonic blasts ahead in Sonic Rush’s blue aura and trail.
    needs: Sonic Rush
    screen:
      clip: /media/sonic-rush-boost
      still: /media/sonic-rush-boost-still.webp
  - name: Boost Mode
    icon: speed-fast
    text: Keep running flat out and Sonic breaks into an even faster run, as in Sonic Advance 2.
    needs: Sonic Advance 2
    screen:
      clip: /media/sonic-boost-mode
      still: /media/sonic-boost-mode-still.webp
  - name: Mid-air tricks
    icon: sparkles
    text: "Four tricks from Sonic Advance 2: the Back Star, the Hop Jump, the Humming Top and the Bound."
    needs: Sonic Advance 2
    screen:
      clip: /media/sonic-tricks
      still: /media/sonic-tricks-still.webp
  - name: Bug fixes
    icon: sparkles
    text: The bugs the original game shipped with, fixed. Off, it plays exactly like the cartridge, bugs included.
facts:
  - label: Article
    href: https://nahuelgenchi.com/gaming/onsoku-advance/
screen:
  clip: /media/sonic-advance-dreamport
  still: /media/sonic-advance-dreamport-still.webp
share: /media/sonic-advance-dreamport-share.png
glow: '#8fd1ff'
---

## Credits

Made by [Nahuel Genchi](https://nahuelgenchi.com/).
