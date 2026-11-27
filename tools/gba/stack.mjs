// The console's stack in a Game Boy Advance Dreamport made the stricter way (kit/gba/c/stack.h, tools/README.md, The
// console's stack). A function proven by the same bytes is, in agbcc's assembly of its C, the original's own code, so
// that assembly says what the original leaves on the stack: what each function's start pushes, where its locals are,
// and, at each call, what the registers it saves for its caller hold, as the C's own constants, names' addresses and
// parameters. This reads that assembly (stack-map.mjs) and writes a copy of each of the game's C files for the build,
// with the kit's stack calls added: each such function's start and return, each call's return address and registers,
// and its stack locals at the console's own addresses. Nothing comes from the game: what the C can't give is a gap,
// and each is listed.
//
// Four rules say more than a register's own arithmetic does, each only where it's certain:
// - A call through a pointer, which the compiler writes as `bl _call_via_rN`, comes back to the instruction after
//   it like any call, with its registers as known, and the function it reaches enters as any does.
// - A value that is a pointer in the C (a name's address, a pointer parameter, a pointer local) goes on the stack
//   as gba_stack_address gives it, so a game that keeps some of the console's memory elsewhere says where the
//   console has it.
// - A register holds a local where the compiler's debugging records keep that local in it, the C assigns the local
//   in one place only and never takes its address, the local is used at the call or after it, so it's alive there,
//   and every instruction that can have written the register last before the call is on that assignment's lines,
//   with the call on another line. A local of one or two bytes is none of them: agbcc's debugging records give no
//   register for it.
// - A function that isn't proven by the same bytes but starts as the original's does (`match` keeps which, in
//   proofs.json's "starts") saves what the original's saves, so its pushes are written, and the registers it doesn't
//   save reach the functions it calls as its caller left them. Its own registers, its locals and where its calls go
//   back to are left out, as the code after its start isn't proven.
//
// A routine the original has in hand-written assembly, whose twin is C, has no compiler to give its frame back, also
// when the twin's assembly for the console's build is proven by the same bytes (#1726): a shared library keeps such routines in a table (library.json's "frames"), their assembly as a
// decompilation writes it, which stack-map.mjs reads (routineMap), and the twin's frame is the routine's
// (routineFrame): its stores to the stack written at the points of its C the table pairs with the routine's.
//
// A copy takes seconds to make, most of them clang writing the file's whole syntax tree, and a version has dozens of
// files, so each copy is kept from one run to the next (stackedCopy, #2070): it's made again only when something it's
// made from changes, and what that is, is all in its key. When in doubt it's made again.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesIn, preprocess } from './match.mjs';
import { compilerPath } from './agbcc.mjs';
import { routineMap, stackMap } from './stack-map.mjs';

const REGISTER = { r0: 0, r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, r7: 7, r8: 8, r9: 9, r10: 10, r11: 11, ip: 12, r12: 12, lr: 14 };
const hex = n => `0x${(n >>> 0).toString(16).toUpperCase()}u`;

/** agbcc's stack map of `file`'s C, as the console's compiler builds it, with debugging lines: { functions }, or
 *  { error }. `includes` are the folders it includes from, `work` where its files go. */
export async function stackOfFile({ file, root, includes, compiler, work }) {
  mkdirSync(dirname(work), { recursive: true });
  let preprocessed;
  try {
    preprocessed = await preprocess(file, root, includes, { lines: true });
  } catch (error) {
    return { error: error.message };
  }
  writeFileSync(`${work}.i`, preprocessed);
  const cc = spawnSync(compilerPath(compiler.name), [...compiler.flags, '-g', '-fhex-asm', '-o', `${work}.s`, `${work}.i`], { encoding: 'utf8' });
  if (cc.error || cc.status !== 0) return { error: `${compiler.name} didn't build ${basename(file)} with its debugging lines.` };
  return stackMap(readFileSync(`${work}.s`, 'utf8'));
}

// --- clang's syntax tree of a file, with every place in it as an offset in the file it's in

/** Clang's tree of `file` (a path inside `root`) as JSON, read with `args`, the build's own flags and folders. */
export async function syntaxOf(file, root, args, filesTree) {
  const { runClang, runLLVM } = await import('@yowasp/clang');
  await runLLVM(null, {}, { fetchProgress: () => {} });
  let out = '';
  const sink = bytes => { if (bytes) out += Buffer.from(bytes).toString('utf8'); };
  await runClang(['clang', ...args, '-fsyntax-only', '-Xclang', '-ast-dump=json', relative(root, file).split('\\').join('/')], filesTree, { stdout: sink, stderr: () => {} });
  return JSON.parse(out);
}

// Clang writes a place's file only where it differs from the last place written, in the order it writes them, so
// this walks the tree in that order and gives each node's range in the file it's in, or null where a macro made it.
function placed(tree) {
  let file = null;
  // a place as { file, offset, end, macro }: one a macro made is where its use is written, in the file that uses it
  const at = place => {
    if (!place) return null;
    if (place.spellingLoc || place.expansionLoc) {
      // clang writes the spelling first, then the use, each file only where it changes
      if (place.spellingLoc?.file) file = place.spellingLoc.file;
      if (place.expansionLoc?.file) file = place.expansionLoc.file;
      const use = place.expansionLoc;
      return use?.offset === undefined ? null : { file, offset: use.offset, end: use.offset + (use.tokLen ?? 0), macro: true };
    }
    if (place.file) file = place.file;
    return place.offset === undefined ? null : { file, offset: place.offset, end: place.offset + (place.tokLen ?? 0), macro: false };
  };
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    const loc = at(node.loc), begin = at(node.range?.begin), end = at(node.range?.end);
    // `place` is text the file itself holds; `written`, also text that holds a macro's whole use
    const both = begin && end && begin.file === end.file;
    node.place = both && !begin.macro && !end.macro ? { file: begin.file, begin: begin.offset, end: end.end } : null;
    node.written = both ? { file: begin.file, begin: begin.offset, end: end.end, endsInMacro: end.macro } : null;
    node.name_at = loc;
    for (const inner of node.inner ?? []) walk(inner);
  };
  walk(tree);
  return tree;
}

const kids = node => node.inner ?? [];
function* everything(node) {
  yield node;
  for (const inner of kids(node)) yield* everything(inner);
}

// the function a call names, through casts and brackets, or null for one through a value
function calleeName(call) {
  let node = kids(call)[0];
  while (node && (node.kind === 'ImplicitCastExpr' || node.kind === 'ParenExpr')) node = kids(node)[0];
  return node?.kind === 'DeclRefExpr' && node.referencedDecl?.kind === 'FunctionDecl' ? node.referencedDecl.name : null;
}

// the line `offset` is on in `text`
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

// whether a declaration's type is a pointer in C, an array among them, as a pointer is what its name gives
const isPointer = decl => /(\*|\])\s*(const|volatile|restrict|\s)*$|\(\*/.test(decl?.type?.desugaredQualType ?? decl?.type?.qualType ?? '');
const bare = node => {
  while (node && (node.kind === 'ParenExpr' || node.kind === 'ImplicitCastExpr')) node = kids(node)[0];
  return node;
};

// The locals of a function's body that a register can be taken to hold: for each register the debugging records keep
// a four-byte local in, the local's name, whether it's a pointer, the lines of the one place the C assigns it, the
// stretch of the file where its name is the local, from its declaration to the end of its block, and where it's used.
function heldLocals(body, info, text, file) {
  const held = new Map(), all = [...everything(body)];
  for (const { name, reg, bytes } of info.registers ?? []) {
    if (bytes !== 4 || info.registers.filter(r => r.name === name).length !== 1 || info.params.some(p => p.name === name)) continue;
    const decls = all.filter(node => node.kind === 'VarDecl' && node.name === name);
    if (decls.length !== 1) continue;
    const decl = decls[0];
    const declared = all.find(node => node.kind === 'DeclStmt' && kids(node).includes(decl));
    const block = all.find(node => node.kind === 'CompoundStmt' && kids(node).includes(declared));
    if (!declared?.written || declared.written.file !== file || !block?.written || block.written.file !== file) continue;
    const isIt = node => bare(node)?.kind === 'DeclRefExpr' && bare(node).referencedDecl?.id === decl.id;
    // every place that can change it: its declaration's own value, an assignment, and anything that takes its address
    const places = kids(decl).length ? [all.find(node => node.kind === 'DeclStmt' && kids(node).includes(decl))] : [];
    let certain = true;
    for (const node of all) {
      if (node.kind === 'BinaryOperator' && node.opcode === '=' && isIt(kids(node)[0])) places.push(node);
      else if (node.kind === 'CompoundAssignOperator' && isIt(kids(node)[0])) certain = false;
      else if (node.kind === 'UnaryOperator' && ['++', '--', '&'].includes(node.opcode) && isIt(kids(node)[0])) certain = false;
    }
    const at = places[0]?.written;
    // an assignment that ends in a macro's use counts where the use's closing bracket was found
    if (!certain || places.length !== 1 || !at || at.file !== file || (at.endsInMacro && !at.closed)) continue;
    if (!held.has(reg)) held.set(reg, []);
    const uses = all.filter(node => node.kind === 'DeclRefExpr' && node.referencedDecl?.id === decl.id).map(ref => ref.written?.begin ?? ref.name_at?.offset).filter(at => at !== undefined);
    held.get(reg).push({ name, pointer: isPointer(decl), from: lineOf(text, at.begin), to: lineOf(text, at.end), scope: { begin: declared.written.end, end: block.written.end }, uses });
  }
  return held;
}

/**
 * `text`, a game's C file at `file`, with the console's stack: for each function `map` has and `matched` holds, its
 * start and return, its calls' return addresses and registers, and its stack locals at the console's addresses.
 * `addressOf(name)` is where the original has a function, odd in Thumb code, or null. Gives { text, gaps }.
 */
export function withStack({ file, text, tree, map, matched, addressOf, starts = new Set(), without = new Set(), routines = null, valueOf = () => null }) {
  placed(tree);
  // a use of a function-like macro ends at its closing bracket, where clang names only the macro
  for (const node of everything(tree)) {
    const w = node.written;
    if (!w?.endsInMacro || w.file !== file) continue;
    let at = w.end;
    while (/\s/.test(text[at] ?? '')) at++;
    if (text[at] !== '(') continue;
    for (let depth = 0; at < text.length; at++) {
      if (text[at] === '(') depth++;
      else if (text[at] === ')' && --depth === 0) break;
    }
    w.end = at + 1;
    w.closed = true;
  }
  const edits = [], gaps = [], header = ['#include "stack.h"'];
  // a pointer of the C's goes on the stack as the console's address of what it points to
  const pointer = code => (without.has('pointers') ? code : `gba_stack_address(${code})`);
  const value = (v, where, pointers = new Set()) => {
    if (v.const !== undefined) return hex(v.const);
    if (v.symbol !== undefined) {
      const add = v.add ? ` + ${hex(v.add)}` : '';
      const code = addressOf(v.symbol);
      return code !== null ? `(${hex(code)}${add})` : pointer(`((uint32_t)(uintptr_t)&${v.symbol}${add})`);
    }
    if (v.param !== undefined) return pointers.has(v.param) ? pointer(`((uint32_t)(uintptr_t)(${v.param}))`) : `((uint32_t)(uintptr_t)(${v.param}))`;
    if (v.sp !== undefined) return `(gba_stack_sp() + ${hex(v.sp)})`;
    gaps.push(`${where}: ${v.unknown ?? 'a value the C doesn\'t give'}`);
    return null;
  };
  for (const fn of kids(tree).filter(node => node.kind === 'FunctionDecl' && node.place?.file === file)) {
    const body = kids(fn).find(node => node.kind === 'CompoundStmt');
    const info = map.functions[fn.name];
    // a routine the original has in assembly, which no compiler gives back from C: its frame is its table's, also
    // when its twin's assembly for the console's build is proven by the same bytes, as the C a Dreamport runs is still
    // what the stack's points are written in, and the console's compiler gives no frame for a routine written as
    // assembly (#1726)
    const routine = routines?.[fn.name];
    if (body?.place && routine && !without.has('routines') && addressOf(fn.name) !== null) {
      const made = routineFrame({ fn, body, text, file, tree, routine, address: addressOf(fn.name), addressOf, valueOf });
      header.push(...made.header);
      edits.push(...made.edits);
      gaps.push(...made.gaps);
      continue;
    }
    if (!body?.place || !info) continue;
    const address = addressOf(fn.name);
    if (address === null) continue;
    // its start: the pushes and the frame, and a variable whose end is the function's return. One not proven by the
    // same bytes takes its frame's room, as the console's compiler lays out its C, so the frames below it are in
    // their places, and nothing more: its pushes are gaps, and its calls say nothing
    const proven = matched.has(fn.name), started = !proven && starts.has(fn.name) && !without.has('starts');
    const pushes = info.pushes.map(p => `{ ${REGISTER[p.reg]}, ${p.slot} }`).join(', ');
    header.push(`static const gba_push gba_pushes_${fn.name}[] = { ${pushes || '{ 0, 0 }'} };`);
    header.push(`static const gba_frame gba_frame_${fn.name} = { ${info.pushes.length}, gba_pushes_${fn.name}, ${info.frame}, ${proven ? 'GBA_STACK_PROVEN' : started ? 'GBA_STACK_START_PROVEN' : 'GBA_STACK_UNPROVEN'} };`);
    edits.push({ at: body.place.begin + 1, cut: 0, put: ` uint32_t gba_stack_in_ __attribute__((cleanup(gba_stack_leave))) = gba_stack_enter(&gba_frame_${fn.name});` });
    if (started) {
      gaps.push(`${fn.name}: proven only at its start, so its ${info.pushes.length} pushes are kept, and its own registers, its locals and where its calls go back to are left out`);
      continue;
    }
    if (!proven) {
      gaps.push(`${fn.name}: not proven by the same bytes, so its frame takes its room and its ${info.pushes.length} pushes and its locals are left out`);
      continue;
    }
    const pointers = new Set(kids(fn).filter(node => node.kind === 'ParmVarDecl' && isPointer(node)).map(node => node.name));
    const held = without.has('locals') ? new Map() : heldLocals(body, info, text, file);
    // the calls through a pointer, each by its line, to tell one from another
    const through = [...everything(body)].filter(node => node.kind === 'CallExpr' && calleeName(node) === null);
    // its stack locals, kept where the console keeps them, with every use of each there
    const moved = new Map();
    for (const decl of everything(body)) {
      if (decl.kind !== 'VarDecl' || !decl.name_at || decl.name_at.file !== file) continue;
      const local = info.locals.find(l => l.name === decl.name);
      if (!local) continue;
      // every use of it has to be in the file's own text, not a macro's, to be moved with it
      const uses = [...everything(body)].filter(ref => ref.kind === 'DeclRefExpr' && ref.referencedDecl?.id === decl.id);
      if (uses.some(ref => !ref.place || ref.place.file !== file)) {
        gaps.push(`${fn.name}: its local ${decl.name} is used in a macro, so it stays off the console's stack`);
        continue;
      }
      moved.set(decl.id, decl.name);
      edits.push({ at: decl.name_at.offset, cut: decl.name.length, put: `gba_own_${decl.name}` });
    }
    for (const stmt of everything(body)) {
      if (stmt.kind !== 'DeclStmt' || !stmt.place) continue;
      for (const decl of kids(stmt).filter(d => moved.has(d.id))) {
        const local = info.locals.find(l => l.name === decl.name);
        const init = kids(decl).length ? ` __builtin_memcpy(gba_at_${decl.name}, &gba_own_${decl.name}, sizeof gba_own_${decl.name});` : '';
        // the same size as the console's compiler gives it, or the build stops here
        const size = local.bytes ? ` _Static_assert(sizeof gba_own_${decl.name} == ${local.bytes}, "${decl.name} isn't the size the console's compiler gives it");` : '';
        edits.push({ at: stmt.place.end, cut: 0, put: `${size} __typeof__(gba_own_${decl.name}) *const gba_at_${decl.name} = gba_stack_local(${local.fbreg});${init}` });
      }
    }
    for (const ref of everything(body)) {
      if (ref.kind === 'DeclRefExpr' && moved.has(ref.referencedDecl?.id) && ref.place) edits.push({ at: ref.place.begin, cut: ref.place.end - ref.place.begin, put: `(*gba_at_${moved.get(ref.referencedDecl.id)})` });
    }
    // its calls: each found among the original's by its line and the function it calls
    for (const call of everything(body)) {
      if (call.kind !== 'CallExpr') continue;
      // a call that starts with a macro's use, as one through a pointer a macro names, is where that use is written
      if (!call.place && call.written && call.written.file === file && !call.written.endsInMacro) call.place = { file, begin: call.written.begin, end: call.written.end };
      if (!call.place) continue;
      const name = calleeName(call), line = lineOf(text, call.place.begin);
      // one through a pointer is the original's `bl _call_via_rN` on its line
      const pointed = name === null;
      if (pointed && without.has('through')) continue;
      const sites = info.calls.filter(c => c.callee === name && c.line === line);
      if (!pointed && !info.calls.some(c => c.callee === name)) continue;
      const called = pointed ? 'a function through a pointer' : name;
      // a call whose arguments a macro wrote has no place in the file to take them from
      if (kids(call).some(part => !part.written || part.written.file !== file)) {
        gaps.push(`${fn.name} line ${line}: its call of ${called} is written by a macro`);
        continue;
      }
      if (sites.length !== 1 || (pointed && through.filter(other => other.place && lineOf(text, other.place.begin) === line).length !== 1)) {
        gaps.push(`${fn.name} line ${line}: ${sites.length ? 'more than one call of' : 'no call found of'} ${called}`);
        continue;
      }
      const site = sites[0], hooks = [`gba_stack_call(${hex((address & ~1) + site.returnOffset + 1)});`];
      for (const [reg, v] of Object.entries(site.regs ?? {})) {
        // a register the arithmetic can't follow may still be a local's own
        const writers = site.writers?.[reg] ?? [{ entry: true }];
        const local = v.unknown !== undefined && v.caller === undefined
          ? (held.get(reg) ?? []).filter(l => call.place.begin >= l.scope.begin && call.place.end <= l.scope.end && (line < l.from || line > l.to)
            && l.uses.some(at => at >= call.place.begin) && writers.every(w => !w.entry && w.line >= l.from && w.line <= l.to && (!w.file || w.file.split('/').pop() === file.split('/').pop())))
          : [];
        const c = local.length === 1
          ? (local[0].pointer ? pointer(`((uint32_t)(uintptr_t)(${local[0].name}))`) : `((uint32_t)(${local[0].name}))`)
          : value(v, `${fn.name} line ${line}, ${reg} at its call of ${called}`, pointers);
        hooks.push(c === null ? `gba_stack_unknown(${REGISTER[reg]});` : `gba_stack_reg(${REGISTER[reg]}, ${c});`);
      }
      for (const store of (info.stores ?? []).filter(s => s.line === line)) {
        const c = value(store.value, `${fn.name} line ${line}, its store at frame ${store.fbreg}`, pointers);
        if (c !== null) hooks.push(`gba_stack_store(${store.fbreg}, ${c}, ${store.bytes});`);
      }
      edits.push({ call, hooks: hooks.join(' ') });
    }
  }
  return { text: render(text, edits), header: header.join('\n'), gaps };
}

// --- a routine the original has in assembly

// a callee's text, with no spaces, as a table's notes name it
const tidy = written => written.replace(/\s+/g, '');
const NO_VALUE = 0xFF, NO_SP = 'GBA_STACK_NO_SP';

// the arguments of a macro's use that starts at `open`, its opening bracket in `text`: { args, end }, end after the ')'
function macroArguments(text, open) {
  const args = [];
  let depth = 0, from = open + 1;
  for (let at = open; at < text.length; at++) {
    const c = text[at];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (--depth === 0) {
        args.push(text.slice(from, at).trim());
        return { args, end: at + 1 };
      }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(from, at).trim());
      from = at + 1;
    }
  }
  return null;
}

// The ways from one point of a routine to another, as one step of its frame: where its execution can go from `leave`
// (the instructions after the last anchor) to `target`, not through another of its anchors, calls or exits. Gives null
// when there's no way, or the instructions every way passes, in their order, and those only some ways do.
function ways(routine, leave, target, stops) {
  const instrs = routine.instrs;
  // from `from`, within `within`, never through `without`: whether a way reaches the target, or comes back to `back`
  const walk = (from, within, { without = -1, back = -1 } = {}) => {
    const seen = new Set(), queue = from.filter(i => i !== without && within(i));
    while (queue.length) {
      const i = queue.shift();
      if (i === back) return true;
      if (seen.has(i)) continue;
      seen.add(i);
      if (i === target) {
        if (back < 0) return true;
        continue;
      }
      if (stops.has(i)) continue;
      queue.push(...instrs[i].next.filter(j => j !== without && within(j)));
    }
    return false;
  };
  // what a way from `leave` reaches, and of that, what reaches the target
  const reached = new Set(), queue = [...leave];
  while (queue.length) {
    const i = queue.shift();
    if (reached.has(i)) continue;
    reached.add(i);
    if (i !== target && !stops.has(i)) queue.push(...instrs[i].next);
  }
  if (!reached.has(target)) return null;
  const on = new Set([target]);
  for (let grew = true; grew;) {
    grew = false;
    for (const i of reached) if (!on.has(i) && !stops.has(i) && instrs[i].next.some(j => on.has(j))) { on.add(i); grew = true; }
  }
  const within = i => on.has(i);
  // an instruction every way passes is one without which the target can't be reached
  const every = [...on].filter(i => i !== target && !walk(leave, within, { without: i }));
  const some = [...on].filter(i => i !== target && !every.includes(i));
  // those every way passes, in the order a way passes them
  const order = [];
  const seen = new Set();
  for (let at = leave.find(within); at !== undefined && at !== target && !seen.has(at); at = instrs[at].next.find(j => within(j) && walk([j], within))) {
    seen.add(at);
    if (every.includes(at)) order.push(at);
  }
  // whether an instruction can run again before the target
  const again = i => walk(instrs[i].next, within, { back: i });
  return { every: order.length === every.length ? order : every.sort((a, b) => a - b), some, again };
}

/**
 * A twin of a routine its game's original has in assembly, with the routine's frame from a library's table
 * (stack-map.mjs, routineMap): its pushes and its stores to the stack written where its C reaches the points the table
 * pairs with the routine's (its calls, its returns and the runs it times), each with what the Dreamport holds as it
 * runs, and its calls made from where the routine makes them. Gives { header, edits, gaps }.
 */
function routineFrame({ fn, body, text, file, tree, routine, address, addressOf, valueOf }) {
  const name = fn.name, header = [], edits = [], gaps = [];
  const instrs = routine.instrs;
  const all = [...everything(body)];
  const params = kids(fn).filter(node => node.kind === 'ParmVarDecl');
  const hexOf = n => `0x${(n >>> 0).toString(16).toUpperCase()}u`;
  // the C of a value, or null for one nothing the Dreamport holds gives
  const cOf = v => {
    if (v.const !== undefined) return `(uint64_t)${hexOf(v.const)}`;
    if (v.symbol !== undefined) {
      const at = addressOf(v.symbol) ?? valueOf(v.symbol);
      return at === null ? null : `(uint64_t)${hexOf(at + (v.add ?? 0))}`;
    }
    if (v.param !== undefined) return params.some(p => p.name === v.param) ? `gba_arg_${v.param}_` : null;
    if (v.sp !== undefined) return `gba_stack_asm_sp(${v.sp})`;
    if (v.caller !== undefined) return `gba_stack_asm_caller(${v.caller === 'lr' ? 14 : Number(v.caller.slice(1))})`;
    if (v.load !== undefined) return `gba_stack_peek(${hexOf(v.load)}, ${v.bytes})`;
    if (v.c !== undefined) return v.pointer ? `(uint64_t)gba_stack_address((uint32_t)(uintptr_t)(${v.c}))` : `(uint64_t)(uint32_t)(uintptr_t)(${v.c})`;
    return null;
  };
  const why = v => v.unknown ?? (v.symbol !== undefined ? `the address of ${v.symbol}, which the version doesn't give` : v.param !== undefined ? `${v.param}, which isn't a parameter of the twin` : 'a value nothing gives');

  // the twin's points: its start, its calls, its returns, its end, and the runs it times of this routine
  const anchors = [{ kind: 'entry', arrive: null, leave: [0], sp: null }];
  const asmAnchors = instrs.map((ins, i) => (ins.anchor ? { ...ins.anchor, i } : null)).filter(Boolean);
  const callsInC = [];
  for (const call of all) {
    if (call.kind !== 'CallExpr') continue;
    if (!call.place && call.written && call.written.file === file && !call.written.endsInMacro) call.place = { file, begin: call.written.begin, end: call.written.end };
    if (!call.place) continue;
    const callee = kids(call)[0];
    if (!callee?.written || callee.written.file !== file) continue;
    callsInC.push({ call, text: tidy(text.slice(callee.written.begin, callee.written.end)) });
  }
  callsInC.sort((a, b) => a.call.place.begin - b.call.place.begin);
  const counted = new Map();
  for (const c of callsInC) {
    counted.set(c.text, (counted.get(c.text) ?? 0) + 1);
    c.n = counted.get(c.text);
    const asm = asmAnchors.find(a => (a.kind === 'call' || a.kind === 'jump') && tidy(a.text) === c.text && (a.n === null || a.n === c.n));
    if (!asm) {
      edits.push({ call: c.call, hooks: 'gba_stack_asm_unpaired();' });
      gaps.push(`${name} line ${lineOf(text, c.call.place.begin)}: its call of ${c.text} is none the routine's table pairs with one of its own`);
      continue;
    }
    asm.paired = true;
    const ins = instrs[asm.i];
    anchors.push({ kind: asm.kind, arrive: asm.i, leave: asm.kind === 'call' ? ins.next : [], sp: ins.sp, regs: ins.regs, call: c.call, at: asm.i });
  }
  const returns = all.filter(node => node.kind === 'ReturnStmt' && node.written?.file === file).sort((a, b) => a.written.begin - b.written.begin);
  returns.forEach((ret, k) => {
    const asm = asmAnchors.find(a => a.kind === 'return' && (a.n === null || a.n === k + 1));
    if (asm) asm.paired = true;
    anchors.push({ kind: 'return', arrive: asm ? asm.i : null, leave: [], sp: null, ret });
  });
  {
    const asm = asmAnchors.find(a => a.kind === 'end') ?? asmAnchors.find(a => a.kind === 'return' && a.n === null);
    if (asm) asm.paired = true;
    anchors.push({ kind: 'end', arrive: asm ? asm.i : null, leave: [], sp: null });
  }
  // the runs it times, by the routine's name or another it has, each a statement of its own
  const names = new Set([name, ...(routine.aliases ?? [])]);
  const bodyText = text.slice(body.place.begin, body.place.end).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, gone => ' '.repeat(gone.length));
  for (const m of bodyText.matchAll(/\bM4A_TIME(_WHEN)?\s*\(/g)) {
    const begin = body.place.begin + m.index, use = macroArguments(text, begin + m[0].length - 1);
    if (!use) continue;
    const [when, ...rest] = m[1] ? use.args : [null, ...use.args];
    const [own, from, to] = rest;
    if (!names.has(own)) continue;
    let end = use.end;
    while (/\s/.test(text[end] ?? '')) end++;
    if (text[end] !== ';') continue;
    const first = instrs.findIndex(ins => ins.offset === Number(from));
    const last = instrs.findIndex(ins => ins.offset <= Number(to) && Number(to) < ins.offset + ins.bytes);
    const straight = first >= 0 && last >= first && instrs.slice(first, last).every((ins, k) => ins.next.includes(first + k + 1));
    if (!straight) {
      gaps.push(`${name} line ${lineOf(text, begin)}: its timed run ${from} to ${to} isn't one of the routine's straight runs`);
      continue;
    }
    anchors.push({ kind: 'run', from: first, arrive: last, leave: instrs[last].next, sp: null, begin, end: end + 1, when });
  }
  for (const a of asmAnchors.filter(a => !a.paired)) gaps.push(`${name}: the table pairs its instruction at offset 0x${instrs[a.i].offset.toString(16)} with ${a.kind === 'call' || a.kind === 'jump' ? `a ${a.kind} of ${a.text}` : `a ${a.kind}`} its twin doesn't have`);

  // the steps from each anchor to each other one, with the stores on the way
  const stops = new Set(instrs.map((ins, i) => (ins.call || ins.anchor || !ins.next.length ? i : -1)).filter(i => i >= 0));
  const steps = [], writes = [], valuesOf = anchors.map(() => []);
  const covered = new Set();
  const valueIndex = (b, c) => {
    if (c === null) return NO_VALUE;
    let k = valuesOf[b].indexOf(c);
    if (k < 0) {
      k = valuesOf[b].length;
      valuesOf[b].push(c);
    }
    return k;
  };
  const unknownWhy = new Set();
  anchors.forEach((B, b) => {
    if (B.arrive === null) return;
    anchors.forEach((A, a) => {
      let list;
      // a run that ends with the call, jump or exit the next point is: nothing more on the way
      if (A.kind === 'run' && B.kind !== 'run' && A.arrive === B.arrive) list = [];
      else {
        const target = B.kind === 'run' ? B.from : B.arrive;
        const found = ways(routine, A.leave, target, stops);
        if (!found) return;
        list = [];
        for (const i of found.every) for (const w of instrs[i].writes) {
          const c = found.again(i) && w.value.c !== undefined ? null : cOf(w.value);
          if (c === null) unknownWhy.add(`its store at offset 0x${instrs[i].offset.toString(16)}: ${found.again(i) && w.value.c !== undefined ? 'one in a loop, whose last value its C doesn\'t keep' : why(w.value)}`);
          list.push({ slot: w.slot, bytes: w.bytes, c });
          covered.add(i);
        }
        for (const i of found.some) for (const w of instrs[i].writes) {
          // one the table says holds what a store every way makes there holds, as the C has it then, changes nothing
          if (w.value.c !== undefined && list.some(each => each.slot === w.slot && each.bytes === w.bytes && each.c === cOf(w.value))) continue;
          unknownWhy.add(`its store at offset 0x${instrs[i].offset.toString(16)}, on only some of the ways between two of its points`);
          list.push({ slot: w.slot, bytes: w.bytes, c: null });
        }
        if (B.kind === 'run') for (let i = B.from; i <= B.arrive; i++) for (const w of instrs[i].writes) {
          const c = cOf(w.value);
          if (c === null) unknownWhy.add(`its store at offset 0x${instrs[i].offset.toString(16)}: ${why(w.value)}`);
          list.push({ slot: w.slot, bytes: w.bytes, c });
          covered.add(i);
        }
      }
      if (list.some(w => w.slot === null)) unknownWhy.add('a store to the stack at a place it can\'t follow');
      steps.push({ from: a, to: b, first: writes.length, count: list.length });
      for (const w of list) writes.push({ slot: w.slot ?? 0, bytes: w.slot === null ? 0 : w.bytes, value: valueIndex(b, w.c) });
    });
  });
  for (const why_ of unknownWhy) gaps.push(`${name}: ${why_}`);
  instrs.forEach((ins, i) => { if (ins.writes.length && !covered.has(i) && ins.op !== 'arm') gaps.push(`${name}: its store at offset 0x${ins.offset.toString(16)} is on no way between two points its twin reaches`); });
  if (instrs.some(ins => ins.op === 'arm')) gaps.push(`${name}: its ARM code, which the tools' assembler doesn't read, so what it stores is left out`);

  const id = `gba_asm_${name}`;
  header.push(`static const gba_asm_write ${id}_writes[] = { ${writes.map(w => `{ ${w.slot}, ${w.bytes}, ${w.value} }`).join(', ') || '{ 0, 0, 0xFF }'} };`);
  header.push(`static const gba_asm_step ${id}_steps[] = { ${steps.map(s => `{ ${s.from}, ${s.to}, ${s.first}, ${s.count} }`).join(', ') || '{ 0xFF, 0xFF, 0, 0 }'} };`);
  header.push(`static const int16_t ${id}_sp[] = { ${anchors.map(a => ((a.kind === 'call' || a.kind === 'jump') && a.sp !== null ? a.sp : NO_SP)).join(', ')} };`);
  header.push(`static const gba_asm ${id} = { ${id}_steps, ${steps.length}, ${id}_writes, ${id}_sp };`);
  const values = b => (valuesOf[b].length ? `(const uint64_t[]){ ${valuesOf[b].join(', ')} }` : '0');
  const at = b => `gba_stack_asm_at(${b}, ${values(b)});`;
  // its start, with the parameters the routine's registers hold kept as they arrive
  const kept = Object.values(routine.args ?? {}).map(arg => params.find(p => p.name === arg)).filter(Boolean);
  for (const arg of Object.values(routine.args ?? {})) if (!params.some(p => p.name === arg)) gaps.push(`${name}: the table names ${arg}, which isn't a parameter of its twin`);
  const keep = kept.map(p => ` const uint64_t gba_arg_${p.name}_ __attribute__((unused)) = ${isPointer(p) ? `gba_stack_address((uint32_t)(uintptr_t)(${p.name}))` : `(uint32_t)(uintptr_t)(${p.name})`};`).join('');
  edits.push({ at: body.place.begin + 1, cut: 0, put: ` uint32_t gba_stack_in_ __attribute__((cleanup(gba_stack_leave))) = gba_stack_asm_enter(&${id});${keep}` });
  anchors.forEach((A, b) => {
    if (A.kind === 'call' || A.kind === 'jump') {
      const regs = Object.entries(A.regs ?? {}).map(([reg, v]) => `gba_stack_set(${Number(reg.slice(1))}, ${cOf(v) ?? 'GBA_STACK_NONE'});`).join(' ');
      const ret = A.kind === 'call' ? `gba_stack_call(${hexOf((address & ~1) + instrs[A.at].offset + 4 + 1)});` : 'gba_stack_jump();';
      edits.push({ call: A.call, hooks: `${at(b)} ${ret} ${regs}` });
    } else if (A.kind === 'return') {
      const ret = A.ret, begin = ret.written.begin;
      let semi = ret.written.end;
      while (semi < text.length && text[semi] !== ';') semi++;
      if (kids(ret).length) {
        edits.push({ at: begin, cut: 'return'.length, put: '{ __auto_type gba_returned_ = (' });
        edits.push({ at: semi, cut: 1, put: `); ${at(b)} return gba_returned_; }` });
      } else {
        edits.push({ at: begin, cut: 0, put: `{ ${at(b)} ` });
        edits.push({ at: semi + 1, cut: 0, put: ' }' });
      }
    } else if (A.kind === 'end') {
      edits.push({ at: body.place.end - 1, cut: 0, put: ` ${at(b)} ` });
    } else if (A.kind === 'run') {
      edits.push({ at: A.begin, cut: 0, put: '{ ' });
      edits.push({ at: A.end, cut: 0, put: ` ${A.when ? `if (${A.when}) ` : ''}${at(b)} }` });
    }
  });
  return { header, edits, gaps };
}

// The text with every edit made: a call's edit puts its arguments in variables first, so its hooks run after them and
// just before it, with the calls inside its arguments made the same way.
function render(text, edits) {
  const plain = edits.filter(e => !e.call), calls = edits.filter(e => e.call);
  const within = (from, to) => {
    const inside = [...plain.filter(e => e.at >= from && e.at + e.cut <= to), ...calls.filter(e => e.call.place.begin >= from && e.call.place.end <= to)];
    // only the outermost calls: those inside them are made with them
    const top = inside.filter(e => !e.call || !calls.some(o => o !== e && o.call.place.begin <= e.call.place.begin && o.call.place.end >= e.call.place.end && (o.call.place.begin < e.call.place.begin || o.call.place.end > e.call.place.end)));
    const topPlain = top.filter(e => !e.call).filter(e => !calls.some(o => top.includes(o) && o.call.place.begin <= e.at && e.at + e.cut <= o.call.place.end));
    const pieces = [...topPlain.map(e => ({ from: e.at, to: e.at + e.cut, put: e.put })), ...top.filter(e => e.call).map(e => ({ from: e.call.place.begin, to: e.call.place.end, put: callText(e) }))];
    pieces.sort((a, b) => a.from - b.from || a.to - b.to);
    let out = '', at = from;
    for (const piece of pieces) {
      out += text.slice(at, piece.from) + piece.put;
      at = piece.to;
    }
    return out + text.slice(at, to);
  };
  const callText = e => {
    const [callee, ...args] = kids(e.call);
    const names = args.map((_, i) => `gba_arg${i}_`);
    const set = args.map((arg, i) => `__auto_type ${names[i]} = (${within(arg.written.begin, arg.written.end)});`).join(' ');
    return `({ ${set} ${e.hooks} ${within(callee.written.begin, callee.written.end)}(${names.join(', ')}); })`;
  };
  return within(0, text.length);
}

// --- a copy kept from one run to the next

const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
// the tools a copy is made by: this file and what it reads the two compilers' work with
const TOOLS = ['stack.mjs', 'stack-map.mjs', 'thumb.mjs', 'match.mjs'].map(name => fileURLToPath(new URL(`./${name}`, import.meta.url)));

// A folder of names and bytes, as the compilers are given them, as a Map of each file's path to its bytes.
function flat(folder, under, into) {
  for (const [name, held] of Object.entries(folder)) {
    if (Buffer.isBuffer(held) || held instanceof Uint8Array) into.set(`${under}${name}`, Buffer.from(held));
    else flat(held, `${under}${name}/`, into);
  }
  return into;
}

/**
 * Every file of `files`, a Map of paths to bytes, that the file at `start` can take in: itself, and each file an
 * #include or an #embed names, or a __has_include asks after, in it or in one of those, sorted. A file is taken by its
 * name alone, wherever it is among them, so it's every file the compiler could find by that name and more, never
 * fewer, and a file asked after that isn't there yet is found once it is. All of them when a macro names one, as then
 * the text doesn't say which.
 */
export function reachedFrom(start, files) {
  const all = () => [...files.keys()].sort(), named = new Map();
  for (const path of files.keys()) {
    const name = path.split('/').pop();
    if (!named.has(name)) named.set(name, []);
    named.get(name).push(path);
  }
  const found = new Set([start]), queue = [start];
  while (queue.length) {
    // with each line that ends in a backslash joined to the next, as the compiler joins them first
    const text = files.get(queue.pop()).toString('latin1').replace(/\\\r?\n/g, '');
    const take = target => {
      for (const path of named.get((target[1] ?? target[2]).split(/[\\/]/).pop()) ?? []) {
        if (found.has(path)) continue;
        found.add(path);
        queue.push(path);
      }
    };
    // read twice: as it is, where only a name written out counts, since a comment may say anything, and with its
    // comments blanked, where a directive that names no file outright is one a macro names
    for (const [code, strict] of [[text, false], [text.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, ' '), true]]) {
      for (const [, rest] of code.matchAll(/(?:#|%:)[ \t]*(?:include_next|include|import|embed)\b([^\n]*)/g)) {
        const target = /^[ \t]*(?:"([^"\n]+)"|<([^>\n]+)>)/.exec(rest);
        if (target) take(target);
        else if (strict) return all();
      }
      // a file asked after: by its name, as an include's, and one that only asks whether the compiler has the
      // question, as defined(__has_include) does, asks after none
      for (const asked of code.matchAll(/__has_(?:include_next|include|embed)\b/g)) {
        const target = /^\s*\(\s*(?:"([^"\n]+)"|<([^>\n]+)>)/.exec(code.slice(asked.index + asked[0].length));
        if (target) take(target);
        else if (strict && !/(?:defined\s*\(?\s*|(?:#|%:)\s*ifn?def\s+)$/.test(code.slice(Math.max(0, asked.index - 40), asked.index))) return all();
      }
    }
  }
  return [...found].sort();
}

// Everything a file's copy is made from but the answers of addressOf and valueOf, as one hash, or null when it can't
// be said: the tools, the two compilers and what each is asked, the file and every file it can take in, of those
// clang's tree is read from (`filesTree`) and those the console's compiler's preprocessor is given (`root`), and what
// the version's proofs say of the functions the file defines. `seen` keeps what was read for the next file's key.
function copyKey({ file, repo, root, includes, compiler, args, filesTree, clang, defined, matched, same, routines, routinesFrom, seen }) {
  const inRepo = path => relative(repo, path).split('\\').join('/');
  const once = (what, make) => {
    if (!seen.has(what)) seen.set(what, make());
    return seen.get(what);
  };
  const marked = path => once(`mark ${path}`, () => (existsSync(path) ? sha1(readFileSync(path)) : null));
  const tools = TOOLS.map(marked), cc = marked(compilerPath(compiler.name));
  if (!clang || !cc || tools.includes(null) || (routines && routinesFrom === undefined)) return null;
  const tree = once('tree', () => flat(filesTree, '', new Map()));
  const under = once(`under ${root}`, () => flat(filesIn(root), inRepo(root) ? `${inRepo(root)}/` : '', new Map()));
  const files = new Map([...under, ...tree]), start = inRepo(file);
  if (!files.has(start)) return null;
  // a file the compiler is told to take in before the first line is one no text names: then every file there is
  const forced = args.some(arg => /^-(include|imacros)/.test(arg));
  const reached = (forced ? [...files.keys()].sort() : reachedFrom(start, files)).map(path => [path, once(`sha1 ${path}`, () => sha1(files.get(path)))]);
  return sha1(JSON.stringify([
    2070, tools, clang, compiler.name, compiler.flags, cc, args, start, inRepo(root), includes.map(inRepo), reached,
    defined.map(t => [t.name, t.address]), [...matched].sort(), defined.map(t => same.get(t.name) ?? 0), routinesFrom === undefined ? null : sha1(routinesFrom),
  ]));
}

/**
 * One file's copy with the console's stack's calls in, in `out`, made or kept from the run before (#2070).
 *   file, repo: the file, and the folder `args` and `filesTree` are from, the build's flags and files for clang's tree
 *   root, includes, compiler: what the console's compiler builds it from and with, as stackOfFile takes them
 *   defined: the twins it defines, each { name, address }; matched: the names of those proven by the same bytes;
 *     same: a Map of each one's name to how many of its first bytes `match` found the same
 *   routines, routinesFrom: a shared library's table of routines for it, and the text the table was read from
 *   addressOf(name), valueOf(name): where the original has a function, odd in Thumb code, and a value, or null
 *   clang: the version of the compiler that writes the tree, or null, with which nothing is kept
 * A copy kept is taken as it is when its key is the one it was made with (copyKey), every name it asked addressOf and
 * valueOf of still gets the answer it got, and the copy on the disk is still the one written. Answers { copy, gaps,
 * made }: the copy's path, what its stack can't hold, and whether it was made now; or { error }, when the console's
 * compiler didn't build the file.
 */
export async function stackedCopy({ file, repo, out, root, includes, compiler, args, filesTree, clang = null, defined, matched, same = new Map(), routines = null, routinesFrom, addressOf, valueOf = () => null, seen = new Map() }) {
  const name = basename(file), copy = join(out, name), record = join(out, 'kept', `${name}.json`);
  const key = copyKey({ file, repo, root, includes, compiler, args, filesTree, clang, defined, matched, same, routines, routinesFrom, seen });
  if (key && existsSync(record) && existsSync(copy)) {
    let kept = null;
    try {
      kept = JSON.parse(readFileSync(record, 'utf8'));
    } catch {}
    const asks = (list, ask) => Array.isArray(list) && list.every(([asked, answer]) => ask(asked) === answer);
    if (kept?.key === key && Array.isArray(kept.gaps) && asks(kept.address, addressOf) && asks(kept.value, valueOf) && sha1(readFileSync(copy)) === kept.copy) return { copy, gaps: kept.gaps, made: false };
  }
  const map = await stackOfFile({ file, root, includes, compiler, work: join(out, 'work', basename(file, '.c')) });
  if (map.error) return { error: map.error };
  const text = readFileSync(file, 'utf8');
  const tree = await syntaxOf(file, repo, args, filesTree);
  // a function that isn't proven but starts as the original's does: `match` found its first bytes the same, as
  // many as its start is long, or its first instruction where it has no start, with no word loaded from beside it
  const starts = new Set(defined.filter(t => {
    const start = map.functions[t.name]?.start;
    return !matched.has(t.name) && start && !start.loads && (same.get(t.name) ?? 0) >= Math.max(start.bytes, 2);
  }).map(t => t.name));
  // each name asked after, with its answer: what the copy depends on of every other file's twins and values
  const address = new Map(), value = new Map();
  const noting = (asked, ask) => what => {
    asked.set(what, ask(what));
    return asked.get(what);
  };
  const made = withStack({ file: relative(repo, file).split('\\').join('/'), text, tree, map, matched, addressOf: noting(address, addressOf), starts, routines, valueOf: noting(value, valueOf) });
  const written = `${made.header}\n#line 1 "${name}"\n${made.text}`;
  writeFileSync(copy, written);
  if (key) {
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, `${JSON.stringify({ key, copy: sha1(written), address: [...address], value: [...value], gaps: made.gaps })}\n`);
  }
  return { copy, gaps: made.gaps, made: true };
}

/**
 * The game's own C files, and the shared libraries' it takes, with the console's stack, for a version made the stricter way (`game`, such as
 * 'sonic-advance/c', whose folder is `folder`): each file with a function proven by the same bytes is written
 * again under .dreamports/c/stack/, the rest kept. `args` are the build's own flags and folders and `filesTree` its files, both as from `repo`, for clang's tree.
 * Each copy is kept from the run before when nothing it's made from changed (stackedCopy), with `clang` the version of
 * the compiler that writes the tree.
 * Gives { sources, gaps, made }: the files to build, what the stack can't hold, each as a line, and the files whose
 * copies were made in this run.
 */
export async function stackSources({ game, folder, own, args, filesTree, out, repo, clang = null }) {
  const { readOriginal } = await import('../lib/proof-files.mjs');
  const { readProofs } = await import('../lib/proofs.mjs');
  const { versionTwins } = await import('../lib/twins.mjs');
  const { readCompiler, compilerAt } = await import('./match.mjs');
  const original = readOriginal(game), proofs = readProofs(game);
  const bytes = new Set([...(proofs?.functions ?? new Map())].filter(([, p]) => p.kind === 'bytes').map(([key]) => key.slice(0, 8)));
  // with no function proven by the same bytes, or no compiler to build one with, there's nothing to read the stack from
  if (!bytes.size || !original.compiler) return { sources: own, gaps: [], made: [] };
  const compiler = readCompiler(original, `games/${game.split('/')[0]}/proof/original.json`);
  const { twinsOf, twins, named, libraries } = versionTwins(game);
  const addressOf = name => (twins.get(name)?.size === 1 ? [...twins.get(name)][0] | 1 : null);
  const valueOf = name => named.get(name) ?? null;
  // the routines of each library's table, for its files
  const routinesOf = new Map();
  for (const { library, files } of libraries) {
    if (!library.frames) continue;
    const table = readFileSync(library.frames, 'utf8'), { routines } = routineMap(table);
    for (const each of files) routinesOf.set(each, { routines, routinesFrom: table });
  }
  const sources = [], gaps = [], made = [], seen = new Map();
  mkdirSync(out, { recursive: true });
  for (const file of own) {
    const defined = (twinsOf.get(file) ?? []).filter(t => t.address !== null);
    const keyOf = t => t.address.toString(16).toUpperCase().padStart(8, '0');
    const matched = new Set(defined.filter(t => bytes.has(keyOf(t))).map(t => t.name));
    if (!defined.length) {
      sources.push(file);
      continue;
    }
    // a shared library's file is built from its own folder, as match builds it
    const inside = !relative(folder, file).startsWith('..');
    const copied = await stackedCopy({
      file, repo, out, root: inside ? folder : dirname(file), includes: inside ? [dirname(file), join(folder, 'src')] : [dirname(file)], compiler: compilerAt(compiler, defined[0].address),
      args, filesTree, clang, defined, matched, addressOf, valueOf, seen, ...(routinesOf.get(file) ?? {}),
      // how many of each function's first bytes `match` found the same
      same: new Map(defined.map(t => [t.name, proofs.starts?.get(keyOf(t))?.bytes ?? 0])),
    });
    if (copied.error) {
      gaps.push(`${basename(file)}: ${copied.error}`);
      sources.push(file);
      continue;
    }
    if (copied.made) made.push(file);
    sources.push(copied.copy);
    gaps.push(...copied.gaps.map(g => `${basename(file)}: ${g}`));
  }
  writeFileSync(join(out, 'gaps.txt'), gaps.length ? `${gaps.join('\n')}\n` : '');
  return { sources, gaps, made };
}
