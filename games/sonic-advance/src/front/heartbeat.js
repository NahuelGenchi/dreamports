// LINK_HEARTBEAT (SAT-R decompilation, the VS screens' tasks): a GBA of the round not heard from for 181 frames in a row is a
// lost link, which ends the screen with the link error. Every connected GBA is counted, up to the first that isn't one.

const PLAYERS_MAX = 4, LIMIT = 0xB5;

/** True when the link was lost, with every task of the screen gone and the link error started. */
export function linkLost(ctx) {
  const e = ctx.engine, view = ctx.link.view(ctx.id), connections = ctx.vsLink?.connections ?? 1;
  for (let i = 0; i < PLAYERS_MAX && connections >> i & 1; i++) {
    if (!(view.flags & (1 << i))) {
      if (ctx.missing[i]++ >= LIMIT) {
        e.destroyTasks();
        e.clearQueues();
        ctx.linkError();
        return true;
      }
    } else ctx.missing[i] = 0;
  }
  return false;
}
