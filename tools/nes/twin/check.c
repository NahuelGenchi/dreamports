// The function check on the NES (../twin.mjs): one function of the original and its twin, a function of the game's C
// built for this computer as it is, get the same registers and the same 2 KB of work memory, thousands of times, and
// what each leaves is compared: every byte of the work memory, what the twin's contract says it gives back, what
// reaches the hardware, and the time, when the twin counts it.
//   check <copy> <memories, or -> <calls> <seed> <which twin> <milliseconds a call may take> <bytes left out, or ->
// It writes one line of JSON, which ../twin.mjs reads. <memories> is a file of work memories, 2 KB each, taken from
// play of the original: the calls "as it was" start from those as they are, and the calls "changed" from one of them,
// or from random bytes when there are none, with a few of the bytes the function reads changed.

#include <setjmp.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <sys/time.h>
#endif
#include "nes.h"
#include "check.h"

// MOST_DRAWS: the registers tried for one call before its `if` is taken to say no, enough for an `if` that holds one
// stack pointer and one register in 25
// PER_MEMORY: how many of those with one memory, before another is taken
enum { MOST_DRAWS = 1 << 17, PER_MEMORY = 1 << 11, MOST_HANGS = 3, ROUNDS = 2, MOST_CHANGED = 6 };
// the stack pointer a call starts with when its twin isn't given it: below where a game's stack starts, at $01FF
enum { STACK_AT = 0xDE };

static uint32_t seed;
static uint32_t rnd(uint32_t n) {
  seed += 0x6D2B79F5;
  uint32_t t = seed;
  t = (t ^ t >> 15) * (t | 1);
  t ^= t + (t ^ t >> 7) * (t | 61);
  return (t ^ t >> 14) % n;
}
// a byte: any, or now and then one of those at an edge, where a sum wraps round or a sign changes
static uint8_t any_byte(void) {
  static const uint8_t EDGES[] = { 0x00, 0x01, 0x7F, 0x80, 0xFF };
  return rnd(4) ? (uint8_t)rnd(256) : EDGES[rnd(sizeof EDGES)];
}

// ---- a twin that falls over or never returns
#ifdef _WIN32
// no timer here: ../twin.mjs stops the whole check when a twin doesn't return. The C runtime puts a signal's handler
// back to the default each time it calls it, so a twin that falls over on every call would end the check at its
// second fall: the handler sets itself again first (#1957)
static jmp_buf back;
#define MARK() setjmp(back)
static void fell(int sig) { signal(sig, fell); longjmp(back, sig); }
static void limit_on(long ms) { (void)ms; }
static void limit_off(void) {}
static void watch(void) { signal(SIGSEGV, fell); signal(SIGFPE, fell); }
#define RAN_ON -1
#else
static sigjmp_buf back;
#define MARK() sigsetjmp(back, 1)
static void fell(int sig) { siglongjmp(back, sig); }
static void limit_on(long ms) { struct itimerval limit = { { 0, 0 }, { ms / 1000, (ms % 1000) * 1000 } }; setitimer(ITIMER_REAL, &limit, NULL); }
static void limit_off(void) { struct itimerval off = { { 0, 0 }, { 0, 0 } }; setitimer(ITIMER_REAL, &off, NULL); }
static void watch(void) { signal(SIGSEGV, fell); signal(SIGBUS, fell); signal(SIGFPE, fell); signal(SIGALRM, fell); }
#define RAN_ON SIGALRM
#endif

typedef struct {
  long calls, same, memory, gives, hardware, time, astray, bank_unknown, fell, ran_on, not_back, bytes;
  long least, most;      // the original's cycles less the twin's own, over the calls that were otherwise the same
  long differs[0x800];   // how often each byte of the memory came out different
  char first[320];
} tally;

static const twin_contract *twin;
static const uint8_t *memories;
static long memory_count;
static int banks, switches, own_bank;   // own_bank: the bank the function is in, when it's one the cartridge switches
static uint16_t address;
static uint8_t left_out[0x800];
// how each of the program's instructions went on, over every call that came out the same
static uint8_t *ran_ways;
static long limit_ms;

static uint8_t *reg_of(twin_regs *r, int n) { return n == 0 ? &r->A : n == 1 ? &r->X : &r->Y; }
static int *flag_of(twin_regs *r, int n) { return n == 3 ? &r->N : n == 4 ? &r->V : n == 5 ? &r->Z : &r->C; }

// whether the contract takes these registers with this memory: its `if`
static int is_given(const uint8_t *start, const twin_regs *r) {
  memcpy(nes_ram, start, sizeof nes_ram);
  return twin->given(r);
}

static int bank_for(const uint8_t *start) {
  if (!switches) return 0;
  if (own_bank >= 0) return own_bank;
  return twin_bank_at >= 0 ? start[twin_bank_at] % banks : -1;
}

// What the JSR that calls the function leaves above the stack pointer it starts with: the address it comes back to,
// less one, high byte first. It's in the memory both sides start with, as it is on the console when the call begins.
static void place_return(uint8_t *start, uint8_t s) {
  start[0x100 | (uint8_t)(s + 2)] = (TWIN_RETURN_TO - 1) >> 8;
  start[0x100 | (uint8_t)(s + 1)] = (TWIN_RETURN_TO - 1) & 0xFF;
}

// A memory and registers for one call: registers are drawn until the contract's `if` takes them, with another memory
// every so many tries, as an `if` can ask something of the memory too, such as the kind of the object in X. 0 when
// the `if` took none of them.
static int draw(uint8_t *start, twin_regs *r, int changed) {
  for (int tries = 0; ; tries++) {
    if (tries == MOST_DRAWS) return 0;
    if (tries % PER_MEMORY == 0) {
      if (memory_count) memcpy(start, memories + (long)rnd((uint32_t)memory_count) * 0x800, 0x800);
      else for (int i = 0; i < 0x800; i++) start[i] = (uint8_t)rnd(256);
      if (own_bank >= 0 && twin_bank_at >= 0) start[twin_bank_at] = (uint8_t)own_bank;
    }
    r->A = any_byte(); r->X = any_byte(); r->Y = any_byte();
    r->S = twin->stack ? any_byte() : STACK_AT;
    r->N = (int)rnd(2); r->V = (int)rnd(2); r->Z = (int)rnd(2); r->C = (int)rnd(2);
    place_return(start, r->S);
    if (is_given(start, r)) break;
  }
  // what the function reads, changed: the original runs to say what it reads, a few of those bytes get other values,
  // and it runs again, as other values lead it to read other bytes
  for (int round = 0; changed && round < ROUNDS; round++) {
    static uint8_t before[0x800];
    static int read[0x800];
    twin_regs tried = *r;
    long cycles;
    int count = 0;
    memcpy(orig_ram, start, 0x800);
    twin_reads_from(0);
    orig_call(address, bank_for(start), &tried, &cycles);
    for (int i = 0; i < 0x800; i++) if (orig_read[i] && !(own_bank >= 0 && i == twin_bank_at)) read[count++] = i;
    if (!count) break;
    memcpy(before, start, 0x800);
    for (int n = 1 + (int)rnd(MOST_CHANGED); n > 0; n--) start[read[rnd((uint32_t)count)]] = any_byte();
    place_return(start, r->S);
    if (!is_given(start, r)) memcpy(start, before, 0x800);
  }
  return 1;
}

static void run(tally *out, long calls, int changed) {
  static uint8_t start[0x800];
  memset(out, 0, sizeof *out);
  out->least = 1L << 30;
  out->most = -(1L << 30);
  for (long i = 0; i < calls && out->ran_on < MOST_HANGS; i++) {
    twin_regs entry;
    if (!draw(start, &entry, changed)) { out->calls = -1; return; }
    uint32_t reads = rnd(0xFFFFFFFFu);

    twin_regs left = entry;
    long cycles = 0;
    memcpy(orig_ram, start, 0x800);
    twin_reads_from(reads);
    int bank = bank_for(start);
    int how = orig_call(address, bank, &left, &cycles);
    // a call that reads where nothing answers, or a bank nothing says is there, isn't one the game makes
    if (orig_astray || orig_bank_reads) { out->astray++; if (orig_bank_reads) out->bank_unknown++; continue; }
    out->calls++;

    twin_regs given = entry;
    long gave = 0;
    memcpy(nes_ram, start, 0x800);
    kit_begin();
    twin_reads_from(reads);
    int sig = MARK();
    if (!sig) {
      limit_on(limit_ms);
      twin->call(&given, &gave);
      limit_off();
    } else if (sig == RAN_ON) out->ran_on++;
    else out->fell++;
    if (how) out->not_back++;

    // every byte of the work memory. In the stack's page, what the original pushed and left behind isn't the game's
    // memory, so a byte there counts only if the original stored to it or the twin changed it. And the bytes from
    // where the call came back to down to the lowest its stack went are where its calls' return addresses were, free
    // once it has returned, as the next call pushes there: a twin that writes there what its original's calls pushed,
    // for a read through a pointer to find, can leave there what the original's later calls pushed over it.
    int at = -1, apart = 0;
    uint8_t frames = (uint8_t)(entry.S + 2 - orig_lowest);
    for (int j = 0; j < 0x800; j++) {
      if ((j & 0x700) == 0x100 && !orig_stored[j & 0xFF] && (nes_ram[j] == start[j] || (uint8_t)(entry.S + 2 - j) < frames)) continue;
      if (left_out[j]) continue;
      if (nes_ram[j] != orig_ram[j]) { apart++; out->differs[j]++; if (at < 0) at = j; }
    }
    out->bytes += apart;
    int bank_same = !switches || twin_bank_at < 0 || orig_bank == nes_ram[twin_bank_at] % banks;
    int memory = at < 0 && bank_same;

    // what the contract says the twin gives back: its result, and each register or flag it was given by address
    int gives = 1, register_apart = -1;
    if (twin->gives && gave != twin->back(&left)) gives = 0;
    for (int n = 0; n < 7; n++) {
      if (!(twin->by_address >> n & 1)) continue;
      int same = n < 3 ? *reg_of(&given, n) == *reg_of(&left, n) : !*flag_of(&given, n) == !*flag_of(&left, n);
      if (!same) { gives = 0; if (register_apart < 0) register_apart = n; }
    }

    int hardware = kit_events.count == orig_events.count && kit_events.count <= TWIN_HW_MOST, event = -1;
    for (int j = 0; hardware && j < kit_events.count; j++) {
      const twin_event *a = &kit_events.list[j], *b = &orig_events.list[j];
      if (a->kind != b->kind || a->address != b->address || a->value != b->value) { hardware = 0; event = j; }
    }

    long late = cycles - (kit_cycles - twin->allowance);
    int back = !how && !sig;
    if (back && memory) out->memory++;
    if (back && gives) out->gives++;
    if (back && hardware) out->hardware++;
    if (back && late == 0) out->time++;
    if (back && memory && gives && hardware) {
      out->same++;
      for (uint32_t j = 0; j < orig_ran_count; j++) ran_ways[orig_ran_at[j]] |= orig_ran_ways[orig_ran_at[j]];
      if (late < out->least) out->least = late;
      if (late > out->most) out->most = late;
    } else if (!out->first[0]) {
      char *text = out->first;
      size_t room = sizeof out->first;
      char stack[8] = "";
      if (twin->stack) snprintf(stack, sizeof stack, "S %02X, ", entry.S);
      int used = snprintf(text, room, "A %02X, X %02X, Y %02X, %sflags %s%s%s%s: %s%s", entry.A, entry.X, entry.Y, stack, entry.N ? "N" : "-", entry.V ? "V" : "-", entry.Z ? "Z" : "-", entry.C ? "C" : "-",
        how == 1 ? "the original didn't come back; " : how == 2 ? "the original's processor jammed; " : how == 3 ? "the original came back with its stack elsewhere; " : "",
        sig == RAN_ON ? "the twin didn't come back in time; " : sig ? "the twin fell over; " : "");
      text += used; room -= (size_t)used;
      if (at >= 0) snprintf(text, room, "$%04X is %02X after the twin and %02X after the original, from %02X", at, nes_ram[at], orig_ram[at], start[at]);
      else if (!bank_same) snprintf(text, room, "the original leaves bank %d at $8000, and the twin's memory says %d", orig_bank, nes_ram[twin_bank_at] % banks);
      else if (!gives && register_apart >= 0) snprintf(text, room, "%c is %d after the twin and %d after the original", "AXYNVZC"[register_apart],
        register_apart < 3 ? *reg_of(&given, register_apart) : !!*flag_of(&given, register_apart), register_apart < 3 ? *reg_of(&left, register_apart) : !!*flag_of(&left, register_apart));
      else if (!gives) snprintf(text, room, "the twin gives %ld, and the original's registers say %ld (A %02X, X %02X, Y %02X, flags %s%s%s%s)", gave, twin->back(&left), left.A, left.X, left.Y,
        left.N ? "N" : "-", left.V ? "V" : "-", left.Z ? "Z" : "-", left.C ? "C" : "-");
      else if (!hardware && event >= 0 && event < orig_events.count) snprintf(text, room, "the hardware's %s differs: $%04X and %02X from the twin, $%04X and %02X from the original", event == 0 ? "first use" : "use after the first",
        kit_events.list[event].address, kit_events.list[event].value, orig_events.list[event].address, orig_events.list[event].value);
      else if (!hardware) snprintf(text, room, "the twin uses the hardware %d times and the original %d", kit_events.count, orig_events.count);
    }
  }
}

static void print(const char *name, const tally *t) {
  printf("\"%s\":{\"calls\":%ld,\"same\":%ld,\"memory\":%ld,\"gives\":%ld,\"hardware\":%ld,\"time\":%ld,\"astray\":%ld,\"bankUnknown\":%ld,\"fell\":%ld,\"ranOn\":%ld,\"notBack\":%ld,\"least\":%ld,\"most\":%ld,\"bytes\":[",
    name, t->calls, t->same, t->memory, t->gives, t->hardware, t->time, t->astray, t->bank_unknown, t->fell, t->ran_on, t->not_back, t->least, t->most);
  // the bytes that differ most often
  static long differs[0x800];
  memcpy(differs, t->differs, sizeof differs);
  for (int shown = 0; shown < 8; shown++) {
    int top = -1;
    for (int j = 0; j < 0x800; j++) if (differs[j] > 0 && (top < 0 || differs[j] > differs[top])) top = j;
    if (top < 0) break;
    printf("%s[%d,%ld]", shown ? "," : "", top, differs[top]);
    differs[top] = 0;
  }
  printf("],\"first\":\"%s\"}", t->first);
}

int main(int argc, char **argv) {
  if (argc < 8) return 2;
  static uint8_t copy[1 << 22];
  FILE *file = fopen(argv[1], "rb");
  if (!file) return 2;
  size_t size = fread(copy, 1, sizeof copy, file);
  fclose(file);
  if (size < 16 || memcmp(copy, "NES\x1A", 4)) return 2;
  kit_stand_in(copy, (uint32_t)size);
  banks = (int)(nes_prg_size / 0x4000);
  switches = nes_mapper == 2 && banks > 2;
  orig_init(nes_prg, nes_prg_size, nes_mapper);
  ran_ways = calloc(nes_prg_size, 1);
  if (!ran_ways) return 2;
  if (strcmp(argv[2], "-")) {
    file = fopen(argv[2], "rb");
    if (!file) return 2;
    fseek(file, 0, SEEK_END);
    memory_count = ftell(file) / 0x800;
    rewind(file);
    uint8_t *all = malloc((size_t)memory_count * 0x800 + 1);
    if (fread(all, 0x800, (size_t)memory_count, file) != (size_t)memory_count) return 2;
    fclose(file);
    memories = all;
  }
  long calls = atol(argv[3]);
  int which = atoi(argv[5]);
  if (which < 0 || which >= twin_contract_count) return 2;
  twin = twin_contracts[which];
  limit_ms = atol(argv[6]);
  for (const char *at = argv[7]; *at && *at != '-'; ) {
    char *end;
    long byte = strtol(at, &end, 16);
    if (end == at) break;
    if (byte >= 0 && byte < 0x800) left_out[byte] = 1;
    at = *end ? end + 1 : end;
  }
  // where the processor sees the function: the last bank, or the only ones, always there, or its own bank at $8000
  uint32_t bank = twin->offset / 0x4000;
  own_bank = switches && (int)bank < banks - 1 ? (int)bank : -1;
  address = (uint16_t)(banks == 1 ? (nes_prg[nes_prg_size - 3] >= 0xC0 ? 0xC000 : 0x8000) + twin->offset : banks == 2 ? 0x8000 + twin->offset : ((int)bank == banks - 1 ? 0xC000 : 0x8000) + twin->offset % 0x4000);
  watch();
  static tally real, changed;
  printf("{\"address\":%d,\"bank\":%d,", address, own_bank);
  seed = (uint32_t)atol(argv[4]) * 7919u + (uint32_t)which;
  if (memory_count) { run(&real, calls, 0); print("asItWas", &real); printf(","); }
  run(&changed, calls, 1);
  print("changed", &changed);
  // each instruction of the program the calls that came out the same ran, where it is and how it went on
  printf(",\"ran\":[");
  for (uint32_t at = 0, shown = 0; at < nes_prg_size; at++) if (ran_ways[at]) printf("%s%u,%d", shown++ ? "," : "", (unsigned)at, ran_ways[at]);
  printf("],\"counts\":%s}\n", kit_spent ? "true" : "false");
  return 0;
}
