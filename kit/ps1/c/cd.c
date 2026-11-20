// The PlayStation's CD drive, as a game reaches it: its four registers from CD_BASE, a byte each, whose meaning the
// index in the first one's low two bits picks; its commands, their answers and its interrupts; the sectors it reads
// from the player's disc; and what a game takes of a sector, a byte at a time or by DMA's channel 3. The drive is PCSX
// ReARMed's own, its libpcsxcore/cdrom.c with its XA decoder, carried in kit/ps1/c/cdrom/, so every answer, every
// interrupt and every sector comes at the cycle that emulator, which `prove` compares a Dreamport with, gives it
// (kit/ps1/c/README.md, The CD drive).
//
// What cdrom.c takes from the rest of the emulator (cdrom/pcsx.h), the kit gives it here: the processor's cycle and
// events from the kit's clock (clock.c), the sectors from the player's disc (kit/c/disc.h), as the emulator's disc
// reader (its cdriso.c and cdrom-async.c) gives them, and the drive and the disc as the emulator leaves them when it
// starts a game (its misc.c, CheckCdrom and LoadCdromMainExe, and psxbios.c).

#include "ps1-kit.h"
#include "disc.h"

EMULATOR_CODE
#include "cdrom/decode_xa.c"
#include "cdrom/cdrom.c"
END_EMULATOR_CODE

// The emulator's settings, as tools/consoles.mjs sets them: its own BIOS (HLE), no boot logo (SlowBoot), the drive at
// its own speed (TurboCD), the CD's XA sound and audio on (Xa and Cdda are 0), and its region found from the disc.
// The emulator's settings for single games (its database.c), such as cdr_read_timing, aren't followed yet.
PcsxConfig Config;
char CdromId[10];
psxRegisters psxRegs;
PcsxCounter rcnts[4];
// the code the emulator's processor keeps compiled, which a transfer into memory makes it forget, and a Dreamport,
// whose code is C, doesn't have
static void forget_code(u32 address, u32 words) { (void)address, (void)words; }
static const PcsxCpu cpu = { forget_code };
const PcsxCpu *psxCpu = &cpu;

// The hardware words cdrom.c writes: the interrupts it raises, which reach the interrupt controller as each call into
// it ends, DMA channel 3's address, block control and channel control, and DMA's interrupt register, as the BIOS
// leaves it (psxbios.c, psxBiosSetupBootState): channels 2 and 3 let in, their flags set, and its interrupt sent, so a
// transfer's end raises nothing until a game clears them, which a Dreamport can't do yet.
u8 cd_hardware_bytes[4];
static u32 raised, dma3_address, dma3_block, dma3_control, dma_interrupts, other_word;
u32 *cd_hardware_word(u32 address) {
  switch (address) {
    case 0x1070: return &raised;
    case 0x10B0: return &dma3_address;
    case 0x10B4: return &dma3_block;
    case 0x10B8: return &dma3_control;
    case 0x10F4: return &dma_interrupts;
  }
  return &other_word;
}

// A call into the drive runs at the kit's cycle. After it, what it raised reaches the interrupt controller, and the
// processor's time goes on as far as a DMA transfer held it (cdrom.c, psxDma3).
static void enter(void) { psxRegs.cycle = clock_now(); }
static void leave(void) {
  int32_t held = (int32_t)(psxRegs.cycle - clock_now());
  if (held > 0) clock_spend((uint32_t)held);
  if (raised) {
    uint32_t bits = raised;
    raised = 0;
    clock_interrupt(bits);
  }
}

// The drive's events on the kit's clock: each runs if the drive still has it set, as the emulator runs its due events
// (psxevents.c, irq_test), and the drive stops one by clearing its bit, as on the emulator
static void due(int which, void (*run)(void)) {
  if (!(psxRegs.interrupt & 1u << which)) return;
  psxRegs.interrupt &= ~(1u << which);
  enter();
  run();
  leave();
}
static void due_command(void) { due(PSXINT_CDR, cdrInterrupt); }
static void due_read(void) { due(PSXINT_CDREAD, cdrPlayReadInterrupt); }
static void due_dma(void) { due(PSXINT_CDRDMA, cdrDmaInterrupt); }
static void due_lid(void) { due(PSXINT_CDRLID, cdrLidSeekInterrupt); }

void cd_event_at(int which, u32 at) {
  psxRegs.event_cycles[which] = at;
  switch (which) {
    case PSXINT_CDR: clock_event_at(CLOCK_CD, at, due_command); break;
    case PSXINT_CDREAD: clock_event_at(CLOCK_CD_READ, at, due_read); break;
    case PSXINT_CDRDMA: clock_event_at(CLOCK_CD_DMA, at, due_dma); break;
    case PSXINT_CDRLID: clock_event_at(CLOCK_CD_LID, at, due_lid); break;
  }
}

// ----------------------------------------------------------------------------------------------------------------
// The disc, as the emulator's disc reader gives it from a BIN, its .cue or a CHD (cdriso.c): each sector whole, 2,352
// bytes, at its time on the disc, which counts from 00:02:00 where the kit's sectors count from 0; the tracks' times;
// and no subchannel, so the drive makes its subchannel Q from the tracks, as the emulator does.

// the last sector read whole, which the drive takes its bytes from (cdriso.c, cdbuffer)
static u8 sector[2352];

static int32_t lba_at(const unsigned char *time) { return (time[0] * 60 + time[1]) * 75 + time[2] - 150; }
static void time_of(uint32_t frames, unsigned char *time) {
  time[0] = (unsigned char)(frames / 4500);
  time[1] = (unsigned char)(frames / 75 % 60);
  time[2] = (unsigned char)(frames % 75);
}

int cdra_readTrack(const unsigned char *time) {
  int32_t lba = lba_at(time);
  return lba >= 0 && kit_disc_read((uint32_t)lba, 1, 0, sizeof sector, sector) == 1 ? 0 : -1;
}
void *cdra_getBuffer(void) { return sector + 12; }
int cdra_readCDDA(const unsigned char *time, void *buffer) {
  int32_t lba = lba_at(time);
  return lba >= 0 && kit_disc_read((uint32_t)lba, 1, 0, 2352, buffer) == 1 ? 0 : -1;
}
// a BIN keeps no subchannel, so the emulator's reader gives none (cdriso.c, ISOreadSub)
int cdra_readSub(const unsigned char *time, void *buffer) { return (void)time, (void)buffer, -1; }
// only reached with a subchannel read, which never comes
unsigned short calcCrc(const unsigned char *bytes, int count) { return (void)bytes, (void)count, 0; }
// the drive told to go to a sector: the page fetches what it will read while the console's drive would be seeking
int cdra_prefetch(unsigned char m, unsigned char s, unsigned char f, int is_cdda) {
  const unsigned char time[3] = { m, s, f };
  int32_t lba = lba_at(time);
  if (lba >= 0) kit_disc_ahead((uint32_t)lba, 64);
  return (void)is_cdda, 1;
}
int cdra_getTN(unsigned char *tn) {
  int count = kit_disc_track_count();
  tn[0] = 1;
  tn[1] = (unsigned char)(count > 0 ? count : 1);
  return 0;
}
// track 0 is the disc's end, its lead-out; past the last, 00:02:00 (cdriso.c, ISOgetTD)
int cdra_getTD(int track, unsigned char *rt) {
  const kit_track *found = track ? kit_disc_track(track) : 0;
  if (track == 0) time_of(kit_disc_kind() ? kit_disc_sectors() + 150 : 0, rt);
  else if (found) time_of(found->first + 150, rt);
  else time_of(150, rt);
  return 0;
}
// a closed drive; the first track's kind; and a disc whose sectors are whole, as a PlayStation's are on the disc. The
// emulator says an ISO's sectors are Mode 1, as it makes them without their subheaders, where the kit makes each as
// the disc holds it (cdriso.c, ISOgetStatus; kit/c/disc.h)
int cdra_getStatus(struct CdrStat *stat) {
  const kit_track *first = kit_disc_track(1);
  stat->Status = 0;
  stat->Type = !kit_disc_kind() || !first ? 0 : first->type == KIT_TRACK_AUDIO ? CDRT_CDDA : CDRT_DATA;
  stat->nodisk = !kit_disc_kind();
  stat->mode1 = 0;
  return 0;
}

// The CD's own sound, its XA sound and its tracks of audio, which the drive gives the sound chip as each sector comes,
// and the volumes it mixes them with (sound.c)
void SPU_playADPCMchannel(xa_decode_t *xa, unsigned int cycle, int is_start) { spu_cd_xa(xa, cycle, is_start); }
int SPU_playCDDAchannel(short *pcm, int bytes, unsigned int cycle, int is_start) { return (void)is_start, spu_cd_audio(pcm, bytes, cycle); }
void SPU_setCDvol(unsigned char ll, unsigned char lr, unsigned char rl, unsigned char rr, unsigned int cycle) { spu_cd_volume(ll, lr, rl, rr, cycle); }

// ----------------------------------------------------------------------------------------------------------------
// The disc as the emulator reads it before a game starts (misc.c, CheckCdrom and LoadCdromMainExe): its region, from
// the licence in sector 4, its name, from the program SYSTEM.CNF boots, as the drive gives it to a game that asks for
// the disc's ID, and the BIOS's tables, which SYSTEM.CNF can ask for more or fewer of. The drive's last sector read
// is the boot program's last, as the emulator's reader leaves it.

static int lower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }
static int same_start(const char *a, const char *b, size_t length) {
  for (size_t i = 0; i < length; i++) {
    if (lower((unsigned char)a[i]) != lower((unsigned char)b[i])) return 1;
    if (!a[i]) return 0;
  }
  return 0;
}
static int is_space(int c) { return c == ' ' || (c >= '\t' && c <= '\r'); }
static int is_alnum(int c) { return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }
static int hex_digit(int c) { return c >= '0' && c <= '9' ? c - '0' : (c = lower(c)) >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; }
// the C library's strlen, strncmp's equal, strchr and strstr, which a Dreamport's page has no library for
static size_t length(const char *text) {
  size_t n = 0;
  while (text[n]) n++;
  return n;
}
static int same(const char *a, const char *b, size_t n) {
  for (size_t i = 0; i < n; i++) {
    if (a[i] != b[i]) return 0;
    if (!a[i]) return 1;
  }
  return 1;
}
static const char *find_char(const char *text, char c) {
  for (; *text; text++) if (*text == c) return text;
  return 0;
}
static const char *find(const char *text, const char *what) {
  for (size_t n = length(what); *text; text++) if (same(text, what, n)) return text;
  return 0;
}

static int read_at(unsigned char *time, const u8 **buf) {
  if (cdra_readTrack(time)) return -1;
  *buf = cdra_getBuffer();
  return 0;
}
static void next_time(unsigned char *time) {
  if (++time[2] == 75) {
    time[2] = 0;
    if (++time[1] == 60) {
      time[1] = 0;
      time[0]++;
    }
  }
}
// a folder's two sectors, as the emulator reads one
static int read_folder(unsigned char *time, u8 *folder) {
  const u8 *buf;
  if (read_at(time, &buf)) return -1;
  memcpy(folder, buf + 12, 2048);
  next_time(time);
  if (read_at(time, &buf)) return -1;
  memcpy(folder + 2048, buf + 12, 2048);
  return 0;
}
// an entry's sector, as a time (misc.c, mmssdd)
static void entry_time(const u8 *entry, unsigned char *time) { time_of((uint32_t)(entry[2] | entry[3] << 8 | entry[4] << 16 | entry[5] << 24) + 150, time); }
// a file by its name, the start of an entry's whatever its case, through the folders its name has before it, from
// the folder `top`, its time in `time`, as the emulator finds it (misc.c, GetCdromFile)
static int find_file(u8 *top, unsigned char *time, const char *name) {
  static u8 below[4096];
  u8 *folder = top;
  if (!name[0]) return -1;
  for (int i = 0; i < 4096;) {
    const u8 *entry = folder + i;
    if (!entry[0]) return -1;
    i += entry[0];
    const char *its = (const char *)entry + 33;
    if (entry[25] & 2) {
      if (!same_start(its, name, entry[32])) {
        if (name[entry[32]] != '\\') continue;
        name += entry[32] + 1;
        entry_time(entry, time);
        if (read_folder(time, below)) return -1;
        i = 0;
        folder = below;
      }
    } else if (!same_start(its, name, length(name))) {
      entry_time(entry, time);
      return 0;
    }
  }
  return -1;
}
// what `sscanf(text, "BOOT = cdrom:\\%255s", name)` finds, with `backslash`, or "BOOT = cdrom:%255s"
static void boot_name(const char *text, int backslash, char *name) {
  const char *pattern = backslash ? "BOOT = cdrom:\\" : "BOOT = cdrom:";
  for (; *pattern; pattern++) {
    if (*pattern == ' ') {
      while (is_space((unsigned char)*text)) text++;
    } else if (*text++ != *pattern) {
      return;
    }
  }
  while (is_space((unsigned char)*text)) text++;
  if (!*text) return;
  int n = 0;
  while (*text && !is_space((unsigned char)*text) && n < 255) name[n++] = *text++;
  name[n] = 0;
}
// the program SYSTEM.CNF boots, found as the emulator finds it, or -1
static int boot_program(u8 *root, unsigned char *time, const char *cnf, char *name) {
  boot_name(cnf, 1, name);
  if (!find_file(root, time, name)) return 0;
  boot_name(cnf, 0, name);
  if (!find_file(root, time, name)) return 0;
  const char *at = find(cnf, "cdrom:");
  if (!at) return -1;
  at += 6;
  while (*at == '\\' || *at == '/') at++;
  int n = 0;
  while (at[n] && at[n] != '\r' && at[n] != '\n' && n < 255) n++;
  memcpy(name, at, n);
  name[n] = 0;
  return find_file(root, time, name);
}
// a number SYSTEM.CNF gives, in hex, after its key and an '=', as `strtoul(text, NULL, 16)` reads it (misc.c,
// getFromCnf)
static void cnf_number(const char *cnf, const char *key, u32 *value) {
  const char *at = find(cnf, key);
  if (at) at = find_char(at, '=');
  if (!at) return;
  at++;
  while (is_space((unsigned char)*at)) at++;
  int negative = *at == '-';
  if (*at == '+' || *at == '-') at++;
  if (at[0] == '0' && lower((unsigned char)at[1]) == 'x' && hex_digit((unsigned char)at[2]) >= 0) at += 2;
  u64 number = 0;
  for (; *at; at++) {
    int digit = hex_digit((unsigned char)*at);
    if (digit < 0) break;
    number = number * 16 + (u64)digit;
  }
  *value = (u32)(negative ? 0 - number : number);
}

// What the emulator's BIOS charges, two cycles each, to set its tables up again when SYSTEM.CNF asks for other counts
// than its own, 4 threads and 16 events (psxbios.c, psxBiosCnfLoaded), the same as at power (clock.c, BIOS_HANDOFF):
// setup_tt's SysEnqIntRP_, 9; EnqueueCdIntr_, 49; five OpenEvents, each looking for a free event, 19 and 8 an event
// looked at; and DeliverEvent of the CD's first event over every one, 8 each, 4 and 4 more for each open one of its
// class, 6 for the one of its spec, and 29.
static uint32_t tables_again(u32 events) {
  if (events > 1024) events = 1024;
  uint32_t cycles = 9 + 49, open = 0;
  for (u32 i = 0; i < 5; i++) {
    cycles += 19 + 8 * (i < events ? i + 1 : events);
    if (i < events) open++;
  }
  cycles += 8 * events + 8 * open + (open ? 6 : 0) + 29;
  return 2 * cycles;
}

static int boot_disc(uint32_t *loading) {
  static const struct { int region; const char *text; } LICENCES[] = {
    { PSX_TYPE_NTSC, "Inc." }, { PSX_TYPE_NTSC, "Amer  ica" }, { PSX_TYPE_NTSC, "of America" }, { PSX_TYPE_PAL, "Euro pe" },
  };
  static u8 root[4096];
  static char cnf[2048];
  char name[256] = { 0 };
  unsigned char time[3] = { 0, 2, 4 };
  const u8 *buf;
  int from_licence = -1;
  // CheckCdrom: the licence, where the BIOS reads its region
  if (read_at(time, &buf)) return -1;
  for (size_t i = 0; i < sizeof LICENCES / sizeof LICENCES[0]; i++) {
    if (same((const char *)buf + 12 + 60, LICENCES[i].text, length(LICENCES[i].text))) {
      from_licence = LICENCES[i].region;
      break;
    }
  }
  // the volume's top folder, and the program SYSTEM.CNF boots, or PSX.EXE
  time[2] = 0x10;
  if (read_at(time, &buf)) return -1;
  entry_time(buf + 12 + 156, time);
  if (read_folder(time, root)) return -1;
  unsigned char at[3];
  memcpy(at, time, 3);
  u32 events = 16, threads = 4, stack = 0;
  if (!find_file(root, at, "SYSTEM.CNF;1")) {
    if (read_at(at, &buf)) return -1;
    memcpy(cnf, buf + 12, sizeof cnf - 1);
    if (boot_program(root, at, cnf, name)) return -1;
    // LoadCdromMainExe reads the counts in the first 1,011 bytes
    cnf[1011] = 0;
    cnf_number(cnf, "TCB", &threads);
    cnf_number(cnf, "EVENT", &events);
    cnf_number(cnf, "STACK", &stack);
    // the Wild Arms workaround
    if (same(name, "EXE\\", 4)) memmove(name, name + 4, length(name) - 3);
  } else if (!find_file(root, at, "PSX.EXE;1")) {
    memcpy(CdromId, "SLUS99999", 10);
  } else {
    return -1;
  }
  // the disc's name: the letters and digits of the program's, up to its ';'
  if (!CdromId[0]) {
    for (int i = 0, c = 0; name[i] && name[i] != ';' && c < 9; i++) {
      if (is_alnum((unsigned char)name[i])) CdromId[c++] = name[i];
    }
  }
  if (!CdromId[0]) memcpy(CdromId, "SLUS99999", 10);
  if (from_licence >= 0) Config.PsxType = (u8)from_licence;
  else if (((CdromId[0] == 's' || CdromId[0] == 'S') && (CdromId[2] == 'e' || CdromId[2] == 'E')) || same(CdromId, "DTLS3035", 8)
           || same(CdromId, "PBPX95001", 9) || same(CdromId, "PBPX95007", 9) || same(CdromId, "PBPX95008", 9)) Config.PsxType = PSX_TYPE_PAL;
  else Config.PsxType = PSX_TYPE_NTSC;
  // LoadCdromMainExe: the BIOS's tables again, and the program's header and then its last sector, read last
  if (threads != 4 || events != 16) *loading = tables_again(events);
  if (read_at(at, &buf)) return -1;
  u32 size = (u32)(buf[12 + 0x1C] | buf[12 + 0x1D] << 8 | buf[12 + 0x1E] << 16 | (u32)buf[12 + 0x1F] << 24);
  for (u32 n = 0; n < size / 2048; n++) next_time(at);
  if (size >= 2048 && read_at(at, &buf)) return -1;
  return 0;
}

// the lid closed on a disc, which a Dreamport's drive, whose lid never opens, doesn't come to
int CheckCdrom(void) {
  uint32_t loading = 0;
  return boot_disc(&loading);
}

uint32_t cd_power(void) {
  memset(&psxRegs, 0, sizeof psxRegs);
  memset(rcnts, 0, sizeof rcnts);
  memset(sector, 0, sizeof sector);
  memset(CdromId, 0, sizeof CdromId);
  Config = (PcsxConfig){ .HLE = 1, .PsxType = PSX_TYPE_NTSC };
  raised = dma3_address = dma3_block = dma3_control = 0;
  dma_interrupts = 0x8C8C0000;
  uint32_t loading = 0;
  if (kit_disc_kind() == KIT_DISC_CD) boot_disc(&loading);
  cdrReset();
  return loading;
}

// ----------------------------------------------------------------------------------------------------------------
// What a game does

uint8_t cd_read(uint32_t address) {
  enter();
  uint8_t value;
  switch (address & 3) {
    case 0: value = cdrRead0(); break;
    case 1: value = cdrRead1(); break;
    case 2: value = cdrRead2(); break;
    default: value = cdrRead3(); break;
  }
  leave();
  return value;
}

void cd_write(uint32_t address, uint8_t value) {
  enter();
  switch (address & 3) {
    case 0: cdrWrite0(value); break;
    case 1: cdrWrite1(value); break;
    case 2: cdrWrite2(value); break;
    default: cdrWrite3(value); break;
  }
  leave();
}

// where a transfer goes, and how many words fit there: the game's own memory
static u8 *dma_to;
static u32 dma_words;
u8 *getDmaRam(u32 address, u32 *max_words) {
  (void)address;
  *max_words = dma_words;
  return dma_to ? dma_to : INVALID_PTR;
}

// DMA channel 3's control written, as the emulator takes it (psxhw.c, make_dma_func): a transfer starts as its start
// bit is set, and DMA's control register lets channel 3 in, as the BIOS leaves it
void cd_dma_read(void *to, uint32_t block, uint32_t control) {
  enter();
  u32 old = dma3_control;
  control &= 0x71770703;
  dma3_block = block;
  if (control != old) {
    dma3_control = control;
    if ((control ^ old) & 0x01000000 && control & 0x01000000) {
      dma_to = to;
      dma_words = ((block - 1) & 0xFFFF) + 1;
      psxDma3(dma3_address, block, control);
      dma_to = 0;
    }
  }
  leave();
}

uint32_t cd_dma_status(void) { return dma3_control; }
