// A stand-in for one of PCSX2's headers, with only what its SPU2's mixing needs of it, for the check of the kit's sound chip
// against PCSX2's (tools/test/ps2-spu2.mjs). Nothing here is PCSX2's own text.
#pragma once
#include "common/Pcsx2Types.h"
enum class FreezeAction { Load, Save, Size };
struct freezeData { int size; u8* data; };
struct StateWrapper;
