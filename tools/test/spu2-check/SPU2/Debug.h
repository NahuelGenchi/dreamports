// A stand-in for one of PCSX2's headers, with only what its SPU2's mixing needs of it, for the check of the kit's sound chip
// against PCSX2's (tools/test/ps2-spu2.mjs). Nothing here is PCSX2's own text.
#pragma once
#include "common/Pcsx2Types.h"
namespace SPU2 {
inline bool MsgToConsole() { return false; } inline bool MsgKeyOnOff() { return false; } inline bool MsgVoiceOff() { return false; }
inline bool MsgDMA() { return false; } inline bool MsgAutoDMA() { return false; } inline bool MsgCache() { return false; } inline bool MsgOverruns() { return false; }
inline bool AccessLog() { return false; } inline bool DMALog() { return false; } inline bool WaveLog() { return false; } inline bool CoresDump() { return false; } inline bool MemDump() { return false; } inline bool RegDump() { return false; } inline bool VisualDebug() { return false; }
template <typename... A> inline void ConLog(A...) {} template <typename... A> inline void FileLog(A...) {} template <typename... A> inline void WriteRegLog(A...) {}
inline bool IsRunningPSXMode() { return false; }
}
