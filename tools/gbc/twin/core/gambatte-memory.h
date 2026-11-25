// The function check on the Game Boy (../../twin.mjs): what stands in for the rest of Gambatte under its processor.
// The build compiles the emulator's cpu.cpp as its makers wrote it, from the source the proof tools fetch for the
// reference emulator, with the tools' change that tells of each instruction (../../../libretro/gambatte.patch), and
// that file asks its memory for every byte it reads and writes. This is that memory, with the same names, and nothing
// behind them but the check's own (../original.cpp): no screen, no sound, no timer, no interrupts. It ends the
// processor's run after each instruction, so the check sees where every one went.

#ifndef DREAMPORTS_TWIN_GAMBATTE_MEMORY_H
#define DREAMPORTS_TWIN_GAMBATTE_MEMORY_H

#include <stdint.h>
#include <cstddef>
#include <string>
#include "gambatte.h"

unsigned dp_read(unsigned address);
void dp_write(unsigned address, unsigned value);
extern bool dp_colour;

namespace gambatte {

struct SaveState;

// what takes an interrupt in the emulator: nothing asks for one here
class Interrupter {
public:
	Interrupter(unsigned short &, unsigned short &) {}
};

class Memory {
public:
	explicit Memory(Interrupter const &) : end_(0), active_(false), ime_(false), halted_(false), stopped_(false) {}

	bool isCgb() const { return dp_colour; }
	bool ime() const { return ime_; }
	bool halted() const { return halted_; }
	bool stopped() const { return stopped_; }
	void calm() { ime_ = halted_ = stopped_ = false; }
	unsigned long nextEventTime() const { return end_; }
	bool isActive() const { return active_; }
	long cyclesSinceBlit(unsigned long) const { return -1; }

	// where an address is in the cartridge's program, which the tools' change asks only when it's to tell of each
	// instruction, and the check never asks it to
	unsigned long dreamportsPlace(unsigned) const { return 0xFFFFFFFFul; }

	void halt() { halted_ = true; }
	void ei(unsigned long) { ime_ = true; }
	void di() { ime_ = false; }

	unsigned ff_read(unsigned p, unsigned long) { return dp_read(0xFF00 | (p & 0xFF)); }
	unsigned read(unsigned p, unsigned long) { return dp_read(p & 0xFFFF); }
	void write(unsigned p, unsigned data, unsigned long) { dp_write(p & 0xFFFF, data & 0xFF); }
	void ff_write(unsigned p, unsigned data, unsigned long) { dp_write(0xFF00 | (p & 0xFF), data & 0xFF); }

	// one instruction a run: the run ends at the first event, a cycle after it starts
	void setEndtime(unsigned long cc, unsigned long) { active_ = true; end_ = cc + 1; }
	unsigned long event(unsigned long cc) { active_ = false; return cc; }
	unsigned long resetCounters(unsigned long cc) { return cc; }
	unsigned long stop(unsigned long cc) { stopped_ = true; return cc + 4; }
	void updateInput() {}

	void loadState(SaveState const &) {}
	unsigned long saveState(SaveState &, unsigned long cc) { return cc; }
	void setStatePtrs(SaveState &) {}
	void setVideoBuffer(video_pixel_t *, std::ptrdiff_t) {}
	void setInputGetter(InputGetter *) {}
	void setSaveDir(std::string const &) {}
	std::string const saveBasePath() const { return std::string(); }
	int loadROM(const void *, unsigned, unsigned, bool) { return 0; }
	void setSoundBuffer(uint_least32_t *, std::size_t) {}
	std::size_t fillSoundBuffer(unsigned long) { return 0; }
	void setDmgPaletteColor(int, int, unsigned long) {}
	void setGameGenie(std::string const &) {}
	void setGameShark(std::string const &) {}

private:
	unsigned long end_;
	bool active_, ime_, halted_, stopped_;
};

}

#endif
