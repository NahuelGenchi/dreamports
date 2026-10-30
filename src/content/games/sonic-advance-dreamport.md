---
title: Sonic Advance Dreamport
kind: dreamport
platform: Game Boy Advance
year: 2001
added: 2026-10-27
summary: Sonic Advance, rebuilt to play in your web browser. No emulator, nothing to install.
ownCopy:
  confirm: I own Sonic Advance
  links:
    - label: Play
      href: https://dreamports.net/play/sonic-advance/
      icon: play
  note: Your copy stays on your device.
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
facts:
  - label: Original
    value: Game Boy Advance, 2001
  - label: You need
    value: A Sonic Advance (USA) ROM (.gba)
  - label: Controls
    controls: [keyboard, controller, touch]
  - label: Status
    parts:
      - name: Maps
        percent: 100
      - name: Physics
        percent: 100
      - name: Mechanics
        percent: 100
      - name: Sound
        percent: 100
      - name: Options
        percent: 85
      - name: Modes
        percent: 30
      - name: Characters
        percent: 25
  - label: Source code
    value: On GitHub
    href: https://github.com/NahuelGenchi/dreamports/tree/main/games/sonic-advance
  - label: Article
    value: On nahuelgenchi.com
    href: https://nahuelgenchi.com/gaming/onsoku-advance/
screen:
  clip: /media/sonic-advance-dreamport
  still: /media/sonic-advance-dreamport-still.webp
share: /media/sonic-advance-dreamport-share.png
glow: '#8fd1ff'
---

## Credits

Made by [Nahuel Genchi](https://nahuelgenchi.com/). The game’s rules come from [SAT-R](https://github.com/SAT-R), the community project that turned Sonic Advance’s program back into readable code.
