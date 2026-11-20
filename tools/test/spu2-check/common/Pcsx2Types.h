// A stand-in for one of PCSX2's headers, with only what its SPU2's mixing needs of it, for the check of the kit's sound chip
// against PCSX2's (tools/test/ps2-spu2.mjs). Nothing here is PCSX2's own text.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include <array>
#include <memory>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32; typedef uint64_t u64;
typedef int8_t s8; typedef int16_t s16; typedef int32_t s32; typedef int64_t s64;
typedef unsigned int uint;
typedef uintptr_t uptr; typedef intptr_t sptr;
#define __forceinline
#define __fastcall
#define __fi inline
#define pxAssume(x) ((void)0)
#define pxAssert(x) ((void)0)
#define pxAssertMsg(x, m) ((void)0)
#define pxAssertRel(x, m) ((void)0)
#define pxFailRel(m) ((void)0)
#define jNO_DEFAULT default: break;
static constexpr bool IsDevBuild = false;
static constexpr bool IsDebugBuild = false;
struct ConsoleStub { template <typename... A> void WriteLn(A...) {} template <typename... A> void Warning(A...) {} template <typename... A> void Error(A...) {} };
static ConsoleStub Console, DevCon;
#define MULTI_ISA_UNSHARED_START namespace isa {
#define MULTI_ISA_UNSHARED_END }
#define MULTI_ISA_COMPILE_ONCE 1
#define MULTI_ISA_DEF(...) namespace isa { __VA_ARGS__ }
#define MULTI_ISA_SELECT(x) x
