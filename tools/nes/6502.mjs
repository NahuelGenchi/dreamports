// The 6502's instructions, the NES's processor: what each of the 256 opcodes is, how its operand is read and how the
// instruction is written, for `npm run dp -- read` (nes/read.mjs) and the function finder (nes/functions.mjs). The
// instruction set is fixed and small, so it's a table here and nothing is built: an opcode is one byte, and its
// addressing mode alone says how many bytes follow. The NES's processor has no decimal mode, which changes what ADC
// and SBC work out after SED, and nothing of how an instruction is read.
//
// 151 opcodes are the documented instructions. The other 105 do something on the real processor too, which nobody
// designed: they're named here as assemblers name them, and marked `undocumented`. A game's own code rarely has one,
// so data read as code soon meets one.

// each row is sixteen opcodes, as NAME.mode, with * before an undocumented one
const TABLE = `
BRK.imp ORA.izx *JAM.imp *SLO.izx *NOP.zp  ORA.zp  ASL.zp  *SLO.zp  PHP.imp ORA.imm ASL.acc *ANC.imm *NOP.abs ORA.abs ASL.abs *SLO.abs
BPL.rel ORA.izy *JAM.imp *SLO.izy *NOP.zpx ORA.zpx ASL.zpx *SLO.zpx CLC.imp ORA.aby *NOP.imp *SLO.aby *NOP.abx ORA.abx ASL.abx *SLO.abx
JSR.abs AND.izx *JAM.imp *RLA.izx BIT.zp   AND.zp  ROL.zp  *RLA.zp  PLP.imp AND.imm ROL.acc *ANC.imm BIT.abs  AND.abs ROL.abs *RLA.abs
BMI.rel AND.izy *JAM.imp *RLA.izy *NOP.zpx AND.zpx ROL.zpx *RLA.zpx SEC.imp AND.aby *NOP.imp *RLA.aby *NOP.abx AND.abx ROL.abx *RLA.abx
RTI.imp EOR.izx *JAM.imp *SRE.izx *NOP.zp  EOR.zp  LSR.zp  *SRE.zp  PHA.imp EOR.imm LSR.acc *ALR.imm JMP.abs  EOR.abs LSR.abs *SRE.abs
BVC.rel EOR.izy *JAM.imp *SRE.izy *NOP.zpx EOR.zpx LSR.zpx *SRE.zpx CLI.imp EOR.aby *NOP.imp *SRE.aby *NOP.abx EOR.abx LSR.abx *SRE.abx
RTS.imp ADC.izx *JAM.imp *RRA.izx *NOP.zp  ADC.zp  ROR.zp  *RRA.zp  PLA.imp ADC.imm ROR.acc *ARR.imm JMP.ind  ADC.abs ROR.abs *RRA.abs
BVS.rel ADC.izy *JAM.imp *RRA.izy *NOP.zpx ADC.zpx ROR.zpx *RRA.zpx SEI.imp ADC.aby *NOP.imp *RRA.aby *NOP.abx ADC.abx ROR.abx *RRA.abx
*NOP.imm STA.izx *NOP.imm *SAX.izx STY.zp  STA.zp  STX.zp  *SAX.zp  DEY.imp *NOP.imm TXA.imp *ANE.imm STY.abs  STA.abs STX.abs *SAX.abs
BCC.rel STA.izy *JAM.imp *SHA.izy STY.zpx  STA.zpx STX.zpy *SAX.zpy TYA.imp STA.aby TXS.imp *TAS.aby *SHY.abx STA.abx *SHX.aby *SHA.aby
LDY.imm LDA.izx LDX.imm *LAX.izx LDY.zp   LDA.zp  LDX.zp  *LAX.zp  TAY.imp LDA.imm TAX.imp *LXA.imm LDY.abs  LDA.abs LDX.abs *LAX.abs
BCS.rel LDA.izy *JAM.imp *LAX.izy LDY.zpx  LDA.zpx LDX.zpy *LAX.zpy CLV.imp LDA.aby TSX.imp *LAS.aby LDY.abx  LDA.abx LDX.aby *LAX.aby
CPY.imm CMP.izx *NOP.imm *DCP.izx CPY.zp   CMP.zp  DEC.zp  *DCP.zp  INY.imp CMP.imm DEX.imp *SBX.imm CPY.abs  CMP.abs DEC.abs *DCP.abs
BNE.rel CMP.izy *JAM.imp *DCP.izy *NOP.zpx CMP.zpx DEC.zpx *DCP.zpx CLD.imp CMP.aby *NOP.imp *DCP.aby *NOP.abx CMP.abx DEC.abx *DCP.abx
CPX.imm SBC.izx *NOP.imm *ISC.izx CPX.zp   SBC.zp  INC.zp  *ISC.zp  INX.imp SBC.imm NOP.imp *SBC.imm CPX.abs  SBC.abs INC.abs *ISC.abs
BEQ.rel SBC.izy *JAM.imp *ISC.izy *NOP.zpx SBC.zpx INC.zpx *ISC.zpx SED.imp SBC.aby *NOP.imp *ISC.aby *NOP.abx SBC.abx INC.abx *ISC.abx
`;

/** How many bytes an instruction takes, by its addressing mode: the opcode and its operand. */
export const LENGTH = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };

/** Every opcode's instruction, by opcode: { name, mode, undocumented }. */
export const INSTRUCTIONS = TABLE.trim().split(/\s+/).map(text => {
  const undocumented = text.startsWith('*');
  const [name, mode] = text.slice(undocumented ? 1 : 0).split('.');
  return { name, mode, undocumented };
});

const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

// how each addressing mode's operand is written, as assemblers write it
const WRITTEN = {
  imp: () => '', acc: () => ' A', imm: n => ` #$${hex2(n)}`, zp: n => ` $${hex2(n)}`, zpx: n => ` $${hex2(n)},X`, zpy: n => ` $${hex2(n)},Y`,
  izx: n => ` ($${hex2(n)},X)`, izy: n => ` ($${hex2(n)}),Y`, rel: n => ` $${hex4(n)}`, abs: n => ` $${hex4(n)}`, abx: n => ` $${hex4(n)},X`,
  aby: n => ` $${hex4(n)},Y`, ind: n => ` ($${hex4(n)})`,
};

/**
 * The instruction at `at` in `bytes`, which the console sees at `address`: { name, mode, undocumented, length, operand,
 * text }, or null when its bytes run past the end. `operand` is the number after the opcode, or for a branch the
 * address it goes to, and `text` is the instruction as an assembler writes it, with a branch's address worked out.
 */
export function decode(bytes, at, address = at) {
  if (at >= bytes.length) return null;
  const { name, mode, undocumented } = INSTRUCTIONS[bytes[at]];
  const length = LENGTH[mode];
  if (at + length > bytes.length) return null;
  let operand = length === 3 ? bytes[at + 1] | bytes[at + 2] << 8 : length === 2 ? bytes[at + 1] : null;
  // a branch goes that many bytes on from the next instruction, or back, staying within the 64 KB the console sees
  if (mode === 'rel') operand = address + 2 + (operand << 24 >> 24) & 0xFFFF;
  return { name, mode, undocumented, length, operand, text: name + WRITTEN[mode](operand) };
}
