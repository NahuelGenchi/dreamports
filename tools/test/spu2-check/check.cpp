// Replays what a program gave the sound chip, as the tools' emulator kept it (DP_SOUND_DUMP, DP_SOUND_DATA), through
// the kit's chip (kit/ps2/c/spu2.c) and through PCSX2's own SPU2 mixer, and compares every sample the two mix.
// The chip's memory as the IOP fills it (the data port, DMA and sound input blocks) is the kit's, copied to PCSX2's:
// what is compared is the mixing.
#include "SPU2/defs.h"
#include "SPU2/regs.h"
#include "R3000A.h"
#include "IopHw.h"
#include <vector>

extern "C" {
void spu2_write(uint32_t address, uint32_t value);
uint32_t spu2_read(uint32_t address);
uint32_t spu2_dma(int core, uint8_t* buffer, uint32_t block_size, uint32_t blocks, uint32_t direction);
void spu2_block(void);
void spu2_list_start(void);
const int16_t* spu2_heard(uint32_t* pairs);
void spu2_power(uint8_t* ram);
}
extern void SPU2_FastWrite(u32 rmem, u16 value);
extern void StartVoices(int core, u32 value);
extern void StopVoices(int core, u32 value);
extern u32 Cycles;

psxRegsStub psxRegs;
psxCounterStub psxCounters[8];
u32 psxNextStartCounter;
s32 psxNextDeltaCounter;
u32 HW_DMA4_MADR, HW_DMA4_TADR, HW_DMA7_MADR, HW_DMA7_TADR, HW_DMA4_BCR, HW_DMA7_BCR, HW_DMA4_CHCR, HW_DMA7_CHCR;
static unsigned long interrupts;
void spu2Irq() { interrupts++; }
void spu2DMA4Irq() {}
void spu2DMA7Irq() {}
static StereoOut32 theirs;
void spu2Output(StereoOut32 out) { theirs = out; }

static std::vector<u8> readAll(const char* path)
{
	std::vector<u8> bytes;
	FILE* f = fopen(path, "rb");
	if (!f) { fprintf(stderr, "can't read %s\n", path); exit(2); }
	u8 buffer[65536];
	for (size_t n; (n = fread(buffer, 1, sizeof buffer, f)) > 0;) bytes.insert(bytes.end(), buffer, buffer + n);
	fclose(f);
	return bytes;
}
static u32 word(const std::vector<u8>& b, size_t at) { u32 v; memcpy(&v, b.data() + at, 4); return v; }

int main(int argc, char** argv)
{
	if (argc < 3) { fprintf(stderr, "usage: xcheck <sound dump> <sound data>\n"); return 2; }
	const auto dump = readAll(argv[1]), data = readAll(argv[2]);
	static u8 ram[0x200000];
	spu2_power(ram);
	// the chip's memory as PCSX2 starts it (its SPU2reset)
	memset(_spu2mem, 0, 0x200000);
	memset(_spu2mem + 0x2800, 7, 0x10);
	memset(_spu2mem + 0xe870, 7, 0x10);
	Cores[0].Init(0);
	Cores[1].Init(1);
	spu2Mix = isa::spu2Mix;
	ReverbUpsample = isa::ReverbUpsample;
	ReverbDownsample = isa::ReverbDownsample;
	size_t dataAt = 0;
	unsigned long frame = 0, block = 0, samples = 0, apart = 0, loud = 0;
	long worst = 0;
	bool said = false;
	for (size_t i = 0; i < dump.size();)
	{
		const char kind = (char)dump[i++];
		if (kind == 'F') { frame++; continue; }
		if (kind == 'W')
		{
			const u32 address = word(dump, i), value = word(dump, i + 4);
			i += 8;
			const u32 at = address - 0x1F900000;
			const u32 reg = at < 0x760 ? (at & ~0x400u) : at;
			const int core = at < 0x760 && (at & 0x400) ? 1 : 0;
			if (address >= 0x1F900000 && at < 0x800 && reg == 0x1AC)
			{
				// the data port: the kit's chip says where the word went
				const u32 to = (spu2_read(0x1F9001A8 + core * 0x400) << 17 | spu2_read(0x1F9001AA + core * 0x400) << 1) & 0x1FFFFE;
				spu2_write(address, value);
				spu2M_Write(to >> 1, (u16)value);
				continue;
			}
			spu2_write(address, value);
			if (address >= 0x1F900000 && at < 0x800 && reg != 0x1A8 && reg != 0x1AA && reg != 0x1B0) SPU2_FastWrite(address, (u16)value);
			continue;
		}
		if (kind == 'D')
		{
			const u32 core = word(dump, i), mode = word(dump, i + 4), control = word(dump, i + 8), size = word(dump, i + 12);
			i += 16;
			if (size == 0) continue;
			if (dump[i] != 'd') { fprintf(stderr, "a transfer with no data in the dump\n"); return 2; }
			i += 9;
			if (dataAt + size > data.size()) { fprintf(stderr, "the data file is short\n"); return 2; }
			std::vector<u8> moved(data.begin() + dataAt, data.begin() + dataAt + size);
			dataAt += size;
			const u32 to = (spu2_read(0x1F9001A8 + core * 0x400) << 17 | spu2_read(0x1F9001AA + core * 0x400) << 1) & 0x1FFFFE;
			const u32 most = mode == 0 && control == 0x30 ? 0x10 : 0x100;
			for (u32 done = 0; done < size;)
			{
				u32 blocks = (size - done) / 4;
				if (blocks > most) blocks = most;
				const u32 taken = spu2_dma((int)core, moved.data() + done, 4, blocks, 0);
				if (taken == 0) { fprintf(stderr, "the kit's chip took none of a transfer the emulator's took\n"); return 2; }
				done += taken * 4;
			}
			// sound data written to the chip's memory goes to PCSX2's too, a word at a time, as its own writes go
			if (mode == 0 && control != 0x30)
				for (u32 k = 0; k < size; k += 2) { u16 v; memcpy(&v, ram + ((to + k) & 0x1FFFFE), 2); spu2M_Write(((to + k) & 0x1FFFFE) >> 1, v); }
			continue;
		}
		if (kind == 'd') { i += 8; continue; }
		if (kind != 'B') { fprintf(stderr, "the dump has a thing of a kind it can't: %c\n", kind); return 2; }
		spu2_list_start();
		spu2_block();
		u32 pairs = 0;
		const int16_t* mine = spu2_heard(&pairs);
		for (u32 n = 0; n < pairs; n++, samples++)
		{
			Cycles++;
			for (int c = 0; c < 2; c++)
			{
				if (Cores[c].KeyOff) { StopVoices(c, Cores[c].KeyOff); Cores[c].KeyOff = 0; }
				if (Cores[c].KeyOn) { StartVoices(c, Cores[c].KeyOn); Cores[c].KeyOn = 0; }
			}
			spu2Mix();
			const long left = (long)mine[n * 2] - theirs.Left, right = (long)mine[n * 2 + 1] - theirs.Right;
			if (mine[n * 2] || mine[n * 2 + 1] || theirs.Left || theirs.Right) loud++;
			if (left || right)
			{
				apart++;
				worst = std::max(worst, std::max(labs(left), labs(right)));
				if (!said)
				{
					said = true;
					printf("first apart: frame %lu, block %lu, sample %u: the kit's %d %d, PCSX2's %d %d\n", frame, block, n, mine[n * 2], mine[n * 2 + 1], theirs.Left, theirs.Right);
				}
			}
		}
		block++;
		// the sound input the cores read comes from the kit's chip's memory, as the IOP's side of it is the kit's
		memcpy(GetMemPtr(0x2000), ram + 0x4000, 0x1000);
	}
	// and what the two left in the chip's memory: what they wrote back as they mixed, and the reverb's work
	unsigned long wordsApart = 0, firstApart = 0;
	for (u32 w = 0; w < 0x100000; w++)
	{
		s16 a; memcpy(&a, ram + w * 2, 2);
		if (a != *GetMemPtr(w)) { if (!wordsApart) firstApart = w; wordsApart++; }
	}
	printf("%lu frames, %lu blocks, %lu samples, %lu of them not silent: %lu apart, the furthest by %ld; %lu words of the chip's memory apart", frame, block, samples, loud, apart, worst, wordsApart);
	if (wordsApart) printf(", the first at 0x%lX", firstApart);
	printf("; PCSX2 raised %lu interrupts\n", interrupts);
	return apart || wordsApart ? 1 : 0;
}

const StereoOut32 StereoOut32::Empty(0, 0);
void V_Core::AutoDMAReadBuffer(int) {}
u64 lClocks = 0;
void V_Core::FinishDMAread() {}
void V_Core::FinishDMAwrite() {}
