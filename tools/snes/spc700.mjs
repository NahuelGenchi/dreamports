// The SPC700's instructions, the Super Nintendo's sound processor, a table of the tools' own: each opcode as its
// assembler writes it, with what its bytes after the first are. Unlike the 65816, every opcode has one length. The
// sound processor runs a program each game sends it, which is part of the game's code (docs/CONSOLES.md), and `read
// --spc` prints it with this table (read.mjs).
//
// What each opcode's template holds, in the order its bytes come:
//   {d}   a direct page byte, $12           {a}   an absolute address, $1234     {i}  an immediate, #$12
//   {r}   a branch, written as where it goes {s}   a direct page byte read, the first of two, before the one written
//   {mb}  a 13-bit address and a bit, $0123.4 {u}  PCALL's page byte, which calls $FF00 and up

const ROWS = [
  'NOP;TCALL 0;SET1 {d}.0;BBS {d}.0,{r};OR A,{d};OR A,{a};OR A,(X);OR A,[{d}+X];OR A,{i};OR {d},{s};OR1 C,{mb};ASL {d};ASL {a};PUSH PSW;TSET1 {a};BRK',
  'BPL {r};TCALL 1;CLR1 {d}.0;BBC {d}.0,{r};OR A,{d}+X;OR A,{a}+X;OR A,{a}+Y;OR A,[{d}]+Y;OR {d},{i};OR (X),(Y);DECW {d};ASL {d}+X;ASL A;DEC X;CMP X,{a};JMP [{a}+X]',
  'CLRP;TCALL 2;SET1 {d}.1;BBS {d}.1,{r};AND A,{d};AND A,{a};AND A,(X);AND A,[{d}+X];AND A,{i};AND {d},{s};OR1 C,/{mb};ROL {d};ROL {a};PUSH A;CBNE {d},{r};BRA {r}',
  'BMI {r};TCALL 3;CLR1 {d}.1;BBC {d}.1,{r};AND A,{d}+X;AND A,{a}+X;AND A,{a}+Y;AND A,[{d}]+Y;AND {d},{i};AND (X),(Y);INCW {d};ROL {d}+X;ROL A;INC X;CMP X,{d};CALL {a}',
  'SETP;TCALL 4;SET1 {d}.2;BBS {d}.2,{r};EOR A,{d};EOR A,{a};EOR A,(X);EOR A,[{d}+X];EOR A,{i};EOR {d},{s};AND1 C,{mb};LSR {d};LSR {a};PUSH X;TCLR1 {a};PCALL {u}',
  'BVC {r};TCALL 5;CLR1 {d}.2;BBC {d}.2,{r};EOR A,{d}+X;EOR A,{a}+X;EOR A,{a}+Y;EOR A,[{d}]+Y;EOR {d},{i};EOR (X),(Y);CMPW YA,{d};LSR {d}+X;LSR A;MOV X,A;CMP Y,{a};JMP {a}',
  'CLRC;TCALL 6;SET1 {d}.3;BBS {d}.3,{r};CMP A,{d};CMP A,{a};CMP A,(X);CMP A,[{d}+X];CMP A,{i};CMP {d},{s};AND1 C,/{mb};ROR {d};ROR {a};PUSH Y;DBNZ {d},{r};RET',
  'BVS {r};TCALL 7;CLR1 {d}.3;BBC {d}.3,{r};CMP A,{d}+X;CMP A,{a}+X;CMP A,{a}+Y;CMP A,[{d}]+Y;CMP {d},{i};CMP (X),(Y);ADDW YA,{d};ROR {d}+X;ROR A;MOV A,X;CMP Y,{d};RETI',
  'SETC;TCALL 8;SET1 {d}.4;BBS {d}.4,{r};ADC A,{d};ADC A,{a};ADC A,(X);ADC A,[{d}+X];ADC A,{i};ADC {d},{s};EOR1 C,{mb};DEC {d};DEC {a};MOV Y,{i};POP PSW;MOV {d},{i}',
  'BCC {r};TCALL 9;CLR1 {d}.4;BBC {d}.4,{r};ADC A,{d}+X;ADC A,{a}+X;ADC A,{a}+Y;ADC A,[{d}]+Y;ADC {d},{i};ADC (X),(Y);SUBW YA,{d};DEC {d}+X;DEC A;MOV X,SP;DIV YA,X;XCN A',
  'EI;TCALL 10;SET1 {d}.5;BBS {d}.5,{r};SBC A,{d};SBC A,{a};SBC A,(X);SBC A,[{d}+X];SBC A,{i};SBC {d},{s};MOV1 C,{mb};INC {d};INC {a};CMP Y,{i};POP A;MOV (X)+,A',
  'BCS {r};TCALL 11;CLR1 {d}.5;BBC {d}.5,{r};SBC A,{d}+X;SBC A,{a}+X;SBC A,{a}+Y;SBC A,[{d}]+Y;SBC {d},{i};SBC (X),(Y);MOVW YA,{d};INC {d}+X;INC A;MOV SP,X;DAS A;MOV A,(X)+',
  'DI;TCALL 12;SET1 {d}.6;BBS {d}.6,{r};MOV {d},A;MOV {a},A;MOV (X),A;MOV [{d}+X],A;CMP X,{i};MOV {a},X;MOV1 {mb},C;MOV {d},Y;MOV {a},Y;MOV X,{i};POP X;MUL YA',
  'BNE {r};TCALL 13;CLR1 {d}.6;BBC {d}.6,{r};MOV {d}+X,A;MOV {a}+X,A;MOV {a}+Y,A;MOV [{d}]+Y,A;MOV {d},X;MOV {d}+Y,X;MOVW {d},YA;MOV {d}+X,Y;DEC Y;MOV A,Y;CBNE {d}+X,{r};DAA A',
  'CLRV;TCALL 14;SET1 {d}.7;BBS {d}.7,{r};MOV A,{d};MOV A,{a};MOV A,(X);MOV A,[{d}+X];MOV A,{i};MOV X,{a};NOT1 {mb};MOV Y,{d};MOV Y,{a};NOTC;POP Y;SLEEP',
  'BEQ {r};TCALL 15;CLR1 {d}.7;BBC {d}.7,{r};MOV A,{d}+X;MOV A,{a}+X;MOV A,{a}+Y;MOV A,[{d}]+Y;MOV X,{d};MOV X,{d}+Y;MOV {d},{s};MOV Y,{d}+X;INC Y;MOV Y,A;DBNZ Y,{r};STOP',
];

/** Each opcode's template, by its byte. */
export const TEMPLATES = ROWS.flatMap(row => row.split(';'));

const BYTES = { d: 1, a: 2, i: 1, r: 1, s: 1, mb: 2, u: 1 };

/** How many bytes the instruction `op` takes. */
export const lengthOf = op => 1 + [...TEMPLATES[op].matchAll(/\{(\w+)\}/g)].reduce((sum, [, kind]) => sum + BYTES[kind], 0);

/** The instruction's name, such as MOV. */
export const nameOf = op => TEMPLATES[op].split(' ')[0];

const two = n => n.toString(16).toUpperCase().padStart(2, '0');
const four = n => n.toString(16).toUpperCase().padStart(4, '0');

/**
 * The instruction at `address` of `bytes` (the sound processor's 64 KB, or what of it there is, from `base`): { op,
 * length, text, target }, `target` where a branch, a jump or a call goes, when it's known.
 */
export function decode(bytes, address, base = 0) {
  const byte = n => bytes[(address + n - base) & 0xFFFF] ?? 0;
  const op = byte(0), template = TEMPLATES[op], length = lengthOf(op);
  // the operands' bytes in order; a {s} comes first in the bytes and is written last, and {i} of `MOV {d},{i}` too
  const kinds = [...template.matchAll(/\{(\w+)\}/g)].map(([, kind]) => kind);
  const order = kinds.includes('s') || (kinds.length === 2 && kinds[1] === 'i' && kinds[0] === 'd') ? [...kinds].reverse() : kinds;
  const values = {};
  let at = 1, target = null;
  for (const kind of order) {
    const value = BYTES[kind] === 2 ? byte(at) | byte(at + 1) << 8 : byte(at);
    at += BYTES[kind];
    values[kind] = value;
  }
  const text = template.replace(/\{(\w+)\}/g, (_, kind) => {
    const value = values[kind];
    if (kind === 'd' || kind === 's') return `$${two(value)}`;
    if (kind === 'a') return `$${four(value)}`;
    if (kind === 'i') return `#$${two(value)}`;
    if (kind === 'u') return `$${two(value)}`;
    if (kind === 'mb') return `$${four(value & 0x1FFF)}.${value >> 13}`;
    target = (address + length + (value << 24 >> 24)) & 0xFFFF;
    return `$${four(target)}`;
  });
  const name = nameOf(op);
  if (['CALL', 'JMP'].includes(name) && kinds[0] === 'a' && !template.includes('[')) target = values.a;
  if (name === 'PCALL') target = 0xFF00 | values.u;
  if (name === 'TCALL') target = null;
  return { op, length, text, target };
}
