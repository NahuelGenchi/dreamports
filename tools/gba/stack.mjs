// The console's stack in a Game Boy Advance Dreamport made the stricter way (kit/gba/c/stack.h, tools/README.md, The
// console's stack). A function proven by the same bytes is, in agbcc's assembly of its C, the original's own code, so
// that assembly says what the original leaves on the stack: what each function's start pushes, where its locals are,
// and, at each call, what the registers it saves for its caller hold, as the C's own constants, names' addresses and
// parameters. This reads that assembly (stack-map.mjs) and writes a copy of each of the game's C files for the build,
// with the kit's stack calls added: each such function's start and return, each call's return address and registers,
// and its stack locals at the console's own addresses. Nothing comes from the game: what the C can't give is a gap,
// and each is listed.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { preprocess } from './match.mjs';
import { compilerPath } from './agbcc.mjs';
import { stackMap } from './stack-map.mjs';

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

/**
 * `text`, a game's C file at `file`, with the console's stack: for each function `map` has and `matched` holds, its
 * start and return, its calls' return addresses and registers, and its stack locals at the console's addresses.
 * `addressOf(name)` is where the original has a function, odd in Thumb code, or null. Gives { text, gaps }.
 */
export function withStack({ file, text, tree, map, matched, addressOf }) {
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
  }
  const edits = [], gaps = [], header = ['#include "stack.h"'];
  const value = (v, where) => {
    if (v.const !== undefined) return hex(v.const);
    if (v.symbol !== undefined) {
      const add = v.add ? ` + ${hex(v.add)}` : '';
      const code = addressOf(v.symbol);
      return code !== null ? `(${hex(code)}${add})` : `((uint32_t)(uintptr_t)&${v.symbol}${add})`;
    }
    if (v.param !== undefined) return `((uint32_t)(uintptr_t)(${v.param}))`;
    if (v.sp !== undefined) return `(gba_stack_sp() + ${hex(v.sp)})`;
    gaps.push(`${where}: ${v.unknown ?? 'a value the C doesn\'t give'}`);
    return null;
  };
  for (const fn of kids(tree).filter(node => node.kind === 'FunctionDecl' && node.place?.file === file)) {
    const body = kids(fn).find(node => node.kind === 'CompoundStmt');
    const info = map.functions[fn.name];
    if (!body?.place || !info || !matched.has(fn.name)) continue;
    const address = addressOf(fn.name);
    if (address === null) continue;
    // its start: the pushes and the frame, and a variable whose end is the function's return
    const pushes = info.pushes.map(p => `{ ${REGISTER[p.reg]}, ${p.slot} }`).join(', ');
    header.push(`static const gba_push gba_pushes_${fn.name}[] = { ${pushes || '{ 0, 0 }'} };`);
    header.push(`static const gba_frame gba_frame_${fn.name} = { ${info.pushes.length}, gba_pushes_${fn.name}, ${info.frame} };`);
    edits.push({ at: body.place.begin + 1, cut: 0, put: ` uint32_t gba_stack_in_ __attribute__((cleanup(gba_stack_leave))) = gba_stack_enter(&gba_frame_${fn.name});` });
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
      if (call.kind !== 'CallExpr' || !call.place) continue;
      const name = calleeName(call), line = lineOf(text, call.place.begin);
      const sites = info.calls.filter(c => c.callee === name && c.line === line);
      if (!name || !info.calls.some(c => c.callee === name)) continue;
      // a call whose arguments a macro wrote has no place in the file to take them from
      if (kids(call).some(part => !part.written || part.written.file !== file)) {
        gaps.push(`${fn.name} line ${line}: its call of ${name} is written by a macro`);
        continue;
      }
      if (sites.length !== 1) {
        gaps.push(`${fn.name} line ${line}: ${sites.length ? 'more than one call of' : 'no call found of'} ${name}`);
        continue;
      }
      const site = sites[0], hooks = [`gba_stack_call(${hex((address & ~1) + site.returnOffset + 1)});`];
      for (const [reg, v] of Object.entries(site.regs ?? {})) {
        const c = value(v, `${fn.name} line ${line}, ${reg} at its call of ${name}`);
        hooks.push(c === null ? `gba_stack_unknown(${REGISTER[reg]});` : `gba_stack_reg(${REGISTER[reg]}, ${c});`);
      }
      for (const store of (info.stores ?? []).filter(s => s.line === line)) {
        const c = value(store.value, `${fn.name} line ${line}, its store at frame ${store.fbreg}`);
        if (c !== null) hooks.push(`gba_stack_store(${store.fbreg}, ${c}, ${store.bytes});`);
      }
      edits.push({ call, hooks: hooks.join(' ') });
    }
  }
  return { text: render(text, edits), header: header.join('\n'), gaps };
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

/**
 * The game's own C files with the console's stack, for a version made the stricter way (`game`, such as
 * 'sonic-advance/strict', whose folder is `folder`): each file with a function proven by the same bytes is written
 * again under .dreamports/c/stack/, the rest kept. `args` are the build's own flags and folders and `filesTree` its files, both as from `repo`, for clang's tree.
 * Gives { sources, gaps }: the files to build, and what the stack can't hold, each as a line.
 */
export async function stackSources({ game, folder, own, args, filesTree, out, repo }) {
  const { readOriginal } = await import('../lib/proof-files.mjs');
  const { readProofs } = await import('../lib/proofs.mjs');
  const { versionTwins } = await import('../lib/twins.mjs');
  const { readCompiler, compilerAt } = await import('./match.mjs');
  const original = readOriginal(game), proofs = readProofs(game);
  const compiler = readCompiler(original, `games/${game.split('/')[0]}/proof/original.json`);
  const bytes = new Set([...(proofs?.functions ?? new Map())].filter(([, p]) => p.kind === 'bytes').map(([key]) => key.slice(0, 8)));
  const { twinsOf, twins } = versionTwins(game);
  const addressOf = name => (twins.get(name)?.size === 1 ? [...twins.get(name)][0] | 1 : null);
  const sources = [], gaps = [];
  mkdirSync(out, { recursive: true });
  for (const file of own) {
    const defined = (twinsOf.get(file) ?? []).filter(t => t.address !== null);
    const matched = new Set(defined.filter(t => bytes.has(t.address.toString(16).toUpperCase().padStart(8, '0'))).map(t => t.name));
    if (!matched.size) {
      sources.push(file);
      continue;
    }
    const map = await stackOfFile({ file, root: folder, includes: [dirname(file), join(folder, 'src')], compiler: compilerAt(compiler, defined[0].address), work: join(out, 'work', basename(file, '.c')) });
    if (map.error) {
      gaps.push(`${basename(file)}: ${map.error}`);
      sources.push(file);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const tree = await syntaxOf(file, repo, args, filesTree);
    const made = withStack({ file: relative(repo, file).split('\\').join('/'), text, tree, map, matched, addressOf });
    const copy = join(out, basename(file));
    writeFileSync(copy, `${made.header}\n#line 1 "${basename(file)}"\n${made.text}`);
    sources.push(copy);
    gaps.push(...made.gaps.map(g => `${basename(file)}: ${g}`));
  }
  writeFileSync(join(out, 'gaps.txt'), gaps.length ? `${gaps.join('\n')}\n` : '');
  return { sources, gaps };
}
