// The cartridge's own way to wait for the screen: it watches the line the console is drawing.
#include "cart.h"

/** WaitFrame, 0x08000680 */
void WaitFrame(void) {
  while (*(volatile u16 *)0x04000006 >= 160) {}
  while (*(volatile u16 *)0x04000006 < 160) {}
}
