// The stack map (gba/stack-map.mjs), on small functions written here by hand as agbcc writes them. npm run test:stack
// tries it on a program the console's compiler builds. Nothing here is from any game.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routineMap, stackMap } from '../gba/stack-map.mjs';


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

test('a routine in assembly from a table: its pushes and stores from where it started, its calls and what pairs them', () => {
  const table = [
    '\t.syntax unified',
    '@ dp:fixed 0x3000000 + 0x7FF0',
    '\t.text',
    '\t.thumb_func',
    '\t.type r, function',
    '@ dp:args r0=thing',
    'r:',
    '\tpush {r0, lr}',
    '\tldr r1, kept',
    '\tldr r1, [r1]',
    '\tpush {r1}',
    '\tbl g @ dp:call thing->go @ dp:value r4=count',
    '\tpop {r1}',
    '\tpop {r0}',
    '\tpush {r4-r7}',
    '\tstr r2, [sp] @ dp:value total',
    '\tbl local @ dp:call other',
    '\tadd sp, 16',
    '\tpop {r3}',
    'local:',
    '\tbx r3 @ dp:return',
    '\t.align 2, 0',
    'kept: .word 0x3000000 + 0x7FF0',
    '\t.size r, .-r',
  ].join('\n');
  const r = routineMap(table).routines.r;
  assert.deepEqual(r.args, { r0: 'thing' });
  const writes = r.instrs.flatMap(ins => ins.writes);
  // the parameter and the way back, a word nothing writes, the caller's r4 to r7 after the pops, and the C's total
  assert.deepEqual(writes.map(w => [w.slot, w.value.param ?? w.value.caller ?? w.value.load ?? w.value.c]), [[-8, 'thing'], [-4, 'lr'], [-12, 0x03007FF0], [-20, 'r4'], [-16, 'r5'], [-12, 'r6'], [-8, 'r7'], [-20, 'total']]);
  const calls = r.instrs.filter(ins => ins.anchor?.kind === 'call');
  // a bl to a label of its own the table pairs with a call is one, made where its stack pointer is then
  assert.deepEqual(calls.map(ins => [ins.anchor.text, ins.sp]), [['thing->go', -12], ['other', -20]]);
  assert.deepEqual(calls[0].regs.r4, { c: 'count', pointer: false });
  // what the pop gives back is what was pushed, as nothing else reaches the routine's frame
  assert.deepEqual(calls[1].regs.r0, { param: 'thing' });
  assert.equal(r.instrs.at(-1).anchor.kind, 'return');
});
