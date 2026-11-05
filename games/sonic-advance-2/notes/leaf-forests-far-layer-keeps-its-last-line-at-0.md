# Leaf Forest's far layer has its scroll at 0 on the screen's last line, which shows only where nothing covers that line.

About: Springs; leaf-forest-spring; 0x0801C068

Proof: #500; leaf-forest-spring

Line 159's scroll isn't written by the code that scrolls the far layer line by line, and it stays at 0 in play. High in the stage, with no ground across the bottom of the screen, the sky on that line differed by about 20 pixels until the Dreamport kept it at 0. The register report at that frame gives 224 and 214 for the far layer's scroll, which is its value after the last line, and using those as line 159's scroll still differed.
