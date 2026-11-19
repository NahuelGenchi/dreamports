// The stack map (gba/stack-map.mjs), on small functions written here by hand as agbcc writes them. npm run test:stack
// tries it on a program the console's compiler builds. Nothing here is from any game.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stackMap } from '../gba/stack-map.mjs';


// A function in the assembly agbcc writes, with nothing else around it.
const one = (name, body) => `\t.code\t16\n.text\n\t.align\t2, 0\n\t.globl\t${name}\n\t.type\t ${name},function\n\t.thumb_func\n${name}:\n${body}\n.Lfe_${name}:\n\t.size\t ${name},.Lfe_${name}-${name}\n`;

test('two paths that bring different values to a register give unknown, and agreeing ones keep it', () => {
  const branches = (first, second) => one('f', `\tpush\t{r4, lr}\n\tcmp\tr0, #0\n\tbeq\t.L2\n\tmov\tr4, #${first}\n\tb\t.L3\n.L2:\n\tmov\tr4, #${second}\n.L3:\n\tbl\tg\n\tpop\t{r4}\n\tpop\t{r0}\n\tbx\tr0`);
  const differ = stackMap(branches('0x1', '0x2')).functions.f.calls[0];
  assert.equal(differ.callee, 'g');
  assert.ok(differ.regs.r4.unknown, 'r4 is unknown');
  const agree = stackMap(branches('0x5', '0x5')).functions.f.calls[0];
  assert.deepEqual(agree.regs.r4, { const: 5 });
});

test('a loop that changes a register makes it unknown after, and one it leaves keeps its value', () => {
  const fn = stackMap(one('f', `\tpush\t{r4, r5, lr}\n\tldr\tr5, .L9\n\tmov\tr4, #0x3\n.L2:\n\tsub\tr4, r4, #0x1\n\tcmp\tr4, #0\n\tbne\t.L2\n\tbl\tg\n\tpop\t{r4, r5}\n\tpop\t{r0}\n\tbx\tr0\n\t.align\t2, 0\n.L9:\n\t.word\tgThing+0x8`)).functions.f;
  assert.ok(fn.calls[0].regs.r4.unknown);
  assert.deepEqual(fn.calls[0].regs.r5, { symbol: 'gThing', add: 8 });
});

test('a high register saved through a low one is pushed as itself, and the frame is what comes after', () => {
  const fn = stackMap(one('f', `\tpush\t{r7, lr}\n\tmov\tr7, r8\n\tpush\t{r7}\n\tsub\tsp, sp, #0x8\n\tmov\tr8, r0\n\tadd\tr1, sp, #0x4\n\tstr\tr1, [sp]\n\tbl\tg\n\tadd\tsp, sp, #0x8\n\tpop\t{r3}\n\tmov\tr8, r3\n\tpop\t{r7}\n\tpop\t{r0}\n\tbx\tr0`)).functions.f;
  assert.deepEqual(fn.pushes, [{ reg: 'r7', slot: -8 }, { reg: 'lr', slot: -4 }, { reg: 'r8', slot: -12 }]);
  assert.equal(fn.frame, 8);
  assert.deepEqual(fn.stores.map(s => [s.fbreg, s.value]), [[0, { sp: 4 }]]);
  // r7 holds the caller's r8, which no C gives; r8 holds an unnamed r0
  assert.equal(fn.calls[0].regs.r7.caller, 'r8');
  assert.ok(fn.calls[0].regs.r8.unknown);
});
