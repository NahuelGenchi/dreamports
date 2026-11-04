// The setting that fixes the original game's bugs (#88), an extra like the others: off unless chosen, so that with it
// off the game keeps every one of them, as the proof compares it with the original on every frame. Each fix asks
// `fixes.on` where the bug is, and the setting (main.js) sets it. A proof tool's run keeps it off, unless its address
// asks for it to make a clip of a fix, the original's bug on one side and the fix on the other.

export const fixes = { on: false };

// a life more, which the original wraps from 255 to 0 as it keeps them in a byte
export const lifeMore = lives => (fixes.on ? Math.min(lives + 1, 255) : (lives + 1) & 0xFF);
