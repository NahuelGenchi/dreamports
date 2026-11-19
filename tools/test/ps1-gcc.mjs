// npm run test:ps1-gcc: builds GCC 2.7.2, the compiler PlayStation games were built with, from GNU's own source into
// WebAssembly (../ps1/gcc.mjs), and compiles a C file of the project's own with it, written here, so it needs nobody's
// copy of any game. Each function has to come out as the console's compiler writes it for its processor: the sum in
// the delay slot of the return, a loop whose branch comes back with the step in its delay slot, a table read through a
// half of its address, a switch, and 0x80000000, held as the console's compiler holds it, in a 32-bit word. The same
// C gives the same assembly every time, and C that isn't C says why.

import { spawnSync } from 'node:child_process';
import { REPO } from '../lib/paths.mjs';
import { compileC, ensureGcc } from '../ps1/gcc.mjs';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

const C = `int sum(int a, int b) { return a + b; }
extern unsigned values[];
unsigned lookup(int index) { return values[index]; }
void fill(unsigned char *to, int count, int value) { while (count != 0) { *to++ = value; count--; } }
int pick(unsigned n) { switch (n) { case 0: return 10; case 1: return 20; case 2: return 30; } return 0; }
unsigned big(void) { return 0x80000000u + *(volatile unsigned *)0x800D8408; }
`;
// a function's instructions, as cc1 writes them: every line from its label to its .end that isn't a directive
const body = (assembly, name) => {
  const from = assembly.indexOf(`\n${name}:\n`), to = assembly.indexOf(`.end\t${name}`, from);
  return assembly.slice(from, to).split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('.') && !line.endsWith(':'));
};

console.log('GCC 2.7.2 for the PlayStation, built as WebAssembly:');
const started = Date.now();
await ensureGcc('2.7.2');
console.log(`  (ready in ${Math.round((Date.now() - started) / 1000)} seconds)`);
const first = await compileC(C, { flags: ['-O2', '-G0'] });
check(!first.error && /GNU C 2\.7\.2/.test(first.assembly), `it compiles C to the processor's assembly${first.error ? `: ${first.error}` : ''}`);
const a = first.assembly ?? '';
check(body(a, 'sum').join('|') === 'j\t$31|addu\t$2,$4,$5', `the sum is in the return's delay slot: ${body(a, 'sum').join(' ; ')}`);
check(body(a, 'lookup').join('|') === 'sll\t$4,$4,2|lw\t$2,values($4)|j\t$31', `a table is read through its name, which the linker fills in: ${body(a, 'lookup').join(' ; ')}`);
check(body(a, 'fill').includes('bne\t$5,$0,$L6') && body(a, 'fill').includes('addu\t$4,$4,1'), `a loop comes back with its step in the delay slot: ${body(a, 'fill').join(' ; ')}`);
check(body(a, 'pick').filter(line => line.startsWith('li\t$2,')).length === 5, 'a small switch is a few comparisons');
check(body(a, 'big').some(line => /^li\t\$2,-2147483648\t+# 0x80000000$/.test(line)) && body(a, 'big').includes('ori\t$2,$2,0x8408'), `0x80000000 is held as the console's compiler holds it: ${body(a, 'big').join(' ; ')}`);
const again = await compileC(C, { flags: ['-O2', '-G0'] });
check(again.assembly === first.assembly, 'the same C gives the same assembly again');
const small = await compileC(C, { flags: ['-O2'] });
check(!small.error && body(small.assembly, 'lookup').length > 0, `with small values reached through gp, as -G 8 has them, the data waits in a temporary file and comes out${small.error ? `: ${small.error}` : ''}`);
const wrong = await compileC('int broken(void) { return ; ', { flags: ['-O2'] });
check(wrong.error && /parse error/.test(wrong.error), `C that isn't C says why: ${wrong.error?.split('\n')[0]}`);

check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nGCC 2.7.2 compiles for the PlayStation as WebAssembly, the same each time.');
