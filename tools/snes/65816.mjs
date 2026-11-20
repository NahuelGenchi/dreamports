// The 65816's instructions, the Super Nintendo's processor, a table of the tools' own: each opcode's name and how it
// reaches what it works on. How long an instruction is depends on two of the processor's flags as it runs, M, which
// makes A and memory 8 bits or 16, and X, which does the same for X and Y, so a length is of an opcode with a mode,
// the two flags and the 6502's mode, which keeps both at 8 bits.
//
// The ways of reaching a value, `mode`, by their assembler's look:
//   imp     nothing                 acc     A                       imm     #$12 or #$1234, as M says
//   immx    #$12 or #$1234, as X    imm8    #$12                    imm16   $1234, as PEA pushes it
//   dp      $12                     dpx     $12,X                   dpy     $12,Y
//   dpi     ($12)                   dpxi    ($12,X)                 dpiy    ($12),Y
//   dpl     [$12]                   dply    [$12],Y                 sr      $12,S
//   sriy    ($12,S),Y               abs     $1234                   absx    $1234,X
//   absy    $1234,Y                 absi    ($1234)                 absxi   ($1234,X)
//   absl    [$1234]                 long    $123456                 longx   $123456,X
//   rel     a branch of -128 to 127 rell    a branch of 16 bits     move    MVN and MVP's two banks

const ROWS = [
  'BRK imm8,ORA dpxi,COP imm8,ORA sr,TSB dp,ORA dp,ASL dp,ORA dpl,PHP imp,ORA imm,ASL acc,PHD imp,TSB abs,ORA abs,ASL abs,ORA long',
  'BPL rel,ORA dpiy,ORA dpi,ORA sriy,TRB dp,ORA dpx,ASL dpx,ORA dply,CLC imp,ORA absy,INC acc,TCS imp,TRB abs,ORA absx,ASL absx,ORA longx',
  'JSR abs,AND dpxi,JSL long,AND sr,BIT dp,AND dp,ROL dp,AND dpl,PLP imp,AND imm,ROL acc,PLD imp,BIT abs,AND abs,ROL abs,AND long',
  'BMI rel,AND dpiy,AND dpi,AND sriy,BIT dpx,AND dpx,ROL dpx,AND dply,SEC imp,AND absy,DEC acc,TSC imp,BIT absx,AND absx,ROL absx,AND longx',
  'RTI imp,EOR dpxi,WDM imm8,EOR sr,MVP move,EOR dp,LSR dp,EOR dpl,PHA imp,EOR imm,LSR acc,PHK imp,JMP abs,EOR abs,LSR abs,EOR long',
  'BVC rel,EOR dpiy,EOR dpi,EOR sriy,MVN move,EOR dpx,LSR dpx,EOR dply,CLI imp,EOR absy,PHY imp,TCD imp,JML long,EOR absx,LSR absx,EOR longx',
  'RTS imp,ADC dpxi,PER rell,ADC sr,STZ dp,ADC dp,ROR dp,ADC dpl,PLA imp,ADC imm,ROR acc,RTL imp,JMP absi,ADC abs,ROR abs,ADC long',
  'BVS rel,ADC dpiy,ADC dpi,ADC sriy,STZ dpx,ADC dpx,ROR dpx,ADC dply,SEI imp,ADC absy,PLY imp,TDC imp,JMP absxi,ADC absx,ROR absx,ADC longx',
  'BRA rel,STA dpxi,BRL rell,STA sr,STY dp,STA dp,STX dp,STA dpl,DEY imp,BIT imm,TXA imp,PHB imp,STY abs,STA abs,STX abs,STA long',
  'BCC rel,STA dpiy,STA dpi,STA sriy,STY dpx,STA dpx,STX dpy,STA dply,TYA imp,STA absy,TXS imp,TXY imp,STZ abs,STA absx,STZ absx,STA longx',
  'LDY immx,LDA dpxi,LDX immx,LDA sr,LDY dp,LDA dp,LDX dp,LDA dpl,TAY imp,LDA imm,TAX imp,PLB imp,LDY abs,LDA abs,LDX abs,LDA long',
  'BCS rel,LDA dpiy,LDA dpi,LDA sriy,LDY dpx,LDA dpx,LDX dpy,LDA dply,CLV imp,LDA absy,TSX imp,TYX imp,LDY absx,LDA absx,LDX absy,LDA longx',
  'CPY immx,CMP dpxi,REP imm8,CMP sr,CPY dp,CMP dp,DEC dp,CMP dpl,INY imp,CMP imm,DEX imp,WAI imp,CPY abs,CMP abs,DEC abs,CMP long',
  'BNE rel,CMP dpiy,CMP dpi,CMP sriy,PEI dpi,CMP dpx,DEC dpx,CMP dply,CLD imp,CMP absy,PHX imp,STP imp,JML absl,CMP absx,DEC absx,CMP longx',
  'CPX immx,SBC dpxi,SEP imm8,SBC sr,CPX dp,SBC dp,INC dp,SBC dpl,INX imp,SBC imm,NOP imp,XBA imp,CPX abs,SBC abs,INC abs,SBC long',
  'BEQ rel,SBC dpiy,SBC dpi,SBC sriy,PEA imm16,SBC dpx,INC dpx,SBC dply,SED imp,SBC absy,PLX imp,XCE imp,JSR absxi,SBC absx,INC absx,SBC longx',
];

/** Each opcode's { name, mode }, by its byte. */
export const INSTRUCTIONS = ROWS.flatMap(row => row.split(',').map(cell => {
  const [name, mode] = cell.split(' ');
  return { name, mode };
}));

const FIXED = { imp: 1, acc: 1, imm8: 2, dp: 2, dpx: 2, dpy: 2, dpi: 2, dpxi: 2, dpiy: 2, dpl: 2, dply: 2, sr: 2, sriy: 2, rel: 2, abs: 3, absx: 3, absy: 3, absi: 3, absxi: 3, absl: 3, imm16: 3, rell: 3, move: 3, long: 4, longx: 4 };

/** The processor's mode as the tools write it: A and memory of 8 bits or 16, X and Y of 8 bits or 16, or the 6502's
 *  mode, which has both at 8. As a number, the bits of a byte of call.cpp's `ran`. */
export const MODES = ['a8i8', 'a8i16', 'a16i8', 'a16i16', 'e'];
/** A mode from the flags register P and the 6502's mode E. */
export const modeOf = (p, e = 0) => (e ? 'e' : `a${p & 0x20 ? 8 : 16}i${p & 0x10 ? 8 : 16}`);
/** Whether a mode's A, and its X and Y, are of 8 bits. */
export const narrowA = mode => mode === 'e' || mode.startsWith('a8');
export const narrowXY = mode => mode === 'e' || mode.endsWith('i8');
/** A mode as three bits, as Snes9x's change to the tools tells it (libretro/ran.h): X of 8 bits, A of 8 bits, the
 *  6502's mode. And back. */
export const modeBits = mode => (mode === 'e' ? 7 : (narrowA(mode) ? 2 : 0) | (narrowXY(mode) ? 1 : 0));
export const modeFromBits = bits => (bits & 4 ? 'e' : `a${bits & 2 ? 8 : 16}i${bits & 1 ? 8 : 16}`);

/** How many bytes the instruction `op` takes in `mode`. */
export function lengthOf(op, mode) {
  const { mode: way } = INSTRUCTIONS[op];
  if (way === 'imm') return narrowA(mode) ? 2 : 3;
  if (way === 'immx') return narrowXY(mode) ? 2 : 3;
  return FIXED[way];
}

/** The mode after the instruction `op`, with its operand `operand`, runs in `mode`, when it changes the flags M and X
 *  in a way reading can follow: REP and SEP. `carry` is what C is before XCE, when it's known, or undefined. Null when
 *  the flags after it can't be known by reading, as after PLP or an XCE with a carry not known. */
export function modeAfter(op, operand, mode, carry) {
  const { name } = INSTRUCTIONS[op];
  if (mode === 'e') {
    if (name === 'XCE') return carry === undefined ? null : carry ? 'e' : 'a8i8';
    if (name === 'PLP' || name === 'RTI') return 'e';
    return mode;
  }
  let p = (narrowA(mode) ? 0x20 : 0) | (narrowXY(mode) ? 0x10 : 0);
  if (name === 'REP') p &= ~operand;
  else if (name === 'SEP') p |= operand;
  else if (name === 'XCE') return carry === undefined ? null : carry ? 'e' : mode;
  else if (name === 'PLP' || name === 'RTI') return null;
  return modeOf(p);
}

/** The eight branches that go one way or the other, as a flag says. */
export const isConditional = op => (op & 0x1F) === 0x10;
