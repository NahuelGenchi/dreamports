# The title screen waits for good when left alone, and its first layer's lines move by a DMA of their own.

About: The title screen; title-screen; 0x08001C04; 0x08002158; 0x0800C494; 0x08036D2C

Proof: #317; title-screen; title-screen-a

0x08001C04 keeps a position and a speed for each of the 160 lines of the first layer, 0x08001B18 moves them each frame, and a DMA on the horizontal blank copies them to the scroll register, so a line shows the position of the line before it. 0x08002158 has that layer draw a column beyond each side of the screen, or the lines would show what video memory held. In 6,000 frames left alone the original runs the same code all along, with no demo. A and Start both move it on, and on the frame of the press its picture already differs from a screen that stays. Once the fade has started the name stands where it is, with no more of its sounds, which only a press while it is still arriving shows, as `title-screen-a` does.
