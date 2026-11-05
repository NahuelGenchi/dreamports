# The original switches the sound's V-blank work off around a save write, and the music stops with it.

About: vs-mode-select

Proof: #562; vs-mode-select

The original calls m4aSoundVSyncOff before it writes the save to the cartridge and m4aSoundVSyncOn after: the first empties the mixing buffer and locks the sound engine, so no song runs and the speakers hold silence until the second unlocks it. A Dreamport that only waits out the write plays a short blip of the song's last mix in that frame (4.6 steps near 1,000 Hz at frame 2063 of `vs-mode-select`). The kit's sound has `vsyncOff` and `vsyncOn` for this, and the name input's close calls them around its stall. Two frames of the recording (2267 and 2672) then differ by 1.3 steps near 16,000 Hz on the left, where the Dreamport is silent; their cause isn't known.
