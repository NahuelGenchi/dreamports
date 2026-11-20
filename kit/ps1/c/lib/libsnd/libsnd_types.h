// The types libsnd's twins are written with, and the layouts of Sony's libspu that libsnd passes to it, as Sony's
// library has them: written here, after Xeeynamo/sotn-decomp's include/types.h and include/psxsdk/libspu.h.
#ifndef LIBSND_TYPES_H
#define LIBSND_TYPES_H

typedef signed char s8;
typedef signed short s16;
typedef signed int s32;
typedef signed long long s64;
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long long u64;
typedef unsigned char u_char;
typedef unsigned short u_short;
typedef unsigned int u_int;
typedef unsigned long u_long;
typedef unsigned int size_t;

#define NULL 0
#define LEN(x) ((s32)(sizeof(x) / sizeof(*(x))))

// libspu's settings that libsnd passes on: which parts of a setting are meant, a bit each
#define SPU_COMMON_MVOLL (1 << 0)
#define SPU_COMMON_MVOLR (1 << 1)
#define SPU_COMMON_MVOLMODEL (1 << 2)
#define SPU_COMMON_MVOLMODER (1 << 3)
#define SPU_COMMON_CDREV (1 << 8)
#define SPU_COMMON_CDMIX (1 << 9)
#define SPU_COMMON_EXTREV (1 << 12)
#define SPU_COMMON_EXTMIX (1 << 13)
#define SPU_REV_MODE (1 << 0)
#define SPU_REV_DEPTHL (1 << 1)
#define SPU_REV_DEPTHR (1 << 2)
#define SPU_REV_DELAYTIME (1 << 3)
#define SPU_REV_FEEDBACK (1 << 4)
#define SPU_OFF 0
#define SPU_ON 1

// a volume for each side
typedef struct {
    unsigned short left;
    unsigned short right;
} SpuVolume;

// one voice's setting, 62 bytes: which voices and which parts, then its volumes, pitch, note, start and loop
// addresses, and its envelope's modes, rates and level
typedef struct {
    unsigned long voice;
    unsigned long mask;
    SpuVolume volume;
    SpuVolume volmode;
    SpuVolume volumex;
    unsigned short pitch;
    unsigned short note;
    unsigned short sample_note;
    short envx;
    unsigned long addr;
    unsigned long loop_addr;
    long a_mode;
    long s_mode;
    long r_mode;
    unsigned short ar;
    unsigned short dr;
    unsigned short sr;
    unsigned short rr;
    unsigned short sl;
    unsigned short adsr1;
    unsigned short adsr2;
} SpuVoiceAttr;

// the reverb's setting: which parts, its mode, depth, delay and feedback
typedef struct {
    unsigned long mask;
    long mode;
    SpuVolume depth;
    long delay;
    long feedback;
} SpuReverbAttr;

// an input's setting, the CD's or the external one's: its volume, and whether it's reverbed and mixed in
typedef struct {
    SpuVolume volume;
    long reverb;
    long mix;
} SpuExtAttr;

// the sound chip's own setting: which parts, the main volume, its mode and what it is now, and the two inputs
typedef struct {
    unsigned long mask;
    SpuVolume mvol;
    SpuVolume mvolmode;
    SpuVolume mvolx;
    SpuExtAttr cd;
    SpuExtAttr ext;
} SpuCommonAttr;

long SpuSetTransferMode(long mode);
unsigned long SpuWrite(unsigned char* addr, unsigned long size);
long SpuSetReverbModeParam(SpuReverbAttr* attr);
void SpuSetVoiceAttr(SpuVoiceAttr* arg);
void SpuSetKey(long on_off, unsigned long voice_bit);
void SpuSetCommonAttr(SpuCommonAttr* attr);

#endif
