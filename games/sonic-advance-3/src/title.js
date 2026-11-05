// Where Start leaves the logos and the intro for: the title screen (sub_808ADF0), which isn't ported yet, so for now the game
// goes straight to Route 99's overworld.

import { REG } from '../../../kit/gba/video.js';
import { startStage } from './stage/stage.js';

export function leaveForTheTitle(c) {
  c.lineScroll = null;
  c.lineScrollNext = null;
  c.lineSize = 1;
  c.lineRegister = REG.BG0HOFS + 12;
  c.dispCnt = 0x80;
  c.bgCnt.fill(0);
  c.bgScroll.fill(0);
  c.winRegs.fill(0);
  c.bldCnt = 0;
  c.bldY = 0;
  startStage(c, 2);
}
