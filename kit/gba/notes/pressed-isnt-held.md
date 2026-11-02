# A button stays in pressed until the game reads it, so pressed doesn't mean held.

About: recordings

Proof: #115; #182

The kit keeps a button's `Pressed` value set until the game reads it, as a layout's `edges` do, so on a screen that never reads it the value stays set long after the button is let go. `play` once counted that as held, which hid every later difference. Since #182 a button counts as held for a frame when the game read it held, or at the first frame it shows as just pressed. A recording played by hand before then may hold a button too long.
