// The function check on the Game Boy (../twin.mjs): one function of the original and its twin, a function of the
// game's C built for this computer as it is, get the same registers and the same memory, the 8 KB of work memory and
// the high memory, thousands of times, and what each leaves is compared: every byte of that memory, what the twin's
// contract says it gives back, what reaches the hardware, and the time, when the twin counts it.
//   check <copy> <memories, or -> <calls> <seed> <which twin> <milliseconds a call may take>
// It writes one line of JSON, which ../twin.mjs reads. <memories> is a file of memories, each as long as that memory,
// taken from play of the original: the calls "as it was" start from those as they are, and the calls "changed" from
// one of them, or from random bytes when there are none, with a few of the bytes the function reads changed.

#include <setjmp.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <sys/time.h>
#endif
#include "gb.h"
#include "check.h"

// MOST_DRAWS: the registers tried for one call before its `if` is taken to say no
// PER_MEMORY: how many of those with one memory, before another is taken
enum { MOST_DRAWS = 1 << 17, PER_MEMORY = 1 << 11, MOST_HANGS = 3, ROUNDS = 2, MOST_CHANGED = 6 };
// the stack pointer a call starts with when its twin isn't given it: near the top of the work memory, where most
// games keep their stack
enum { STACK_AT = 0xDFF0 };
enum { REGISTERS = 7, NAMED = 11 };

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
// no timer here: ../twin.mjs stops the whole check when a twin doesn't return
static jmp_buf back;
#define MARK() setjmp(back)
static void fell(int sig) { longjmp(back, sig); }
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
  long least, most;              // the original's cycles less the twin's own, over the calls that were otherwise the same
  long differs[TWIN_MEMORY];     // how often each byte of the memory came out different
  char first[400];
} tally;

static const twin_contract *twin;
static const uint8_t *memories;
static long memory_count;
static int banks, chip, own_bank;   // own_bank: the bank the function is in, when it's one the cartridge switches
static uint16_t address;
// how each of the program's instructions went on, over every call that came out the same
static uint8_t *ran_ways;
static long limit_ms;
static uint8_t twin_memory[TWIN_MEMORY];

static uint8_t *reg_of(twin_regs *r, int n) { return n == 0 ? &r->A : n == 1 ? &r->B : n == 2 ? &r->C : n == 3 ? &r->D : n == 4 ? &r->E : n == 5 ? &r->H : &r->L; }
static int *flag_of(twin_regs *r, int n) { return n == 7 ? &r->ZF : n == 8 ? &r->NF : n == 9 ? &r->HF : &r->CF; }
static const char *const NAMES[NAMED] = { "A", "B", "C", "D", "E", "H", "L", "ZF", "NF", "HF", "CF" };

// whether the contract takes these registers with this memory: its `if`
static int is_given(const uint8_t *start, const twin_regs *r) {
  kit_memory_in(start);
  return twin->given(r);
}

static int bank_for(const uint8_t *start) {
  if (chip == TWIN_CHIP_NONE || banks <= 2) return banks == 2 ? 1 : 0;
  if (own_bank >= 0) return own_bank;
  int at = twin_bank_at >= 0 ? twin_place((uint16_t)twin_bank_at) : -1;
  return at >= 0 ? start[at] % banks : -1;
}

// What the CALL that calls the function leaves at the stack pointer it starts with: the address it comes back to, low
// byte first. It's in the memory both sides start with, as it is on the console when the call begins.
static void place_return(uint8_t *start, uint16_t sp) {
  int low = twin_place(sp), high = twin_place((uint16_t)(sp + 1));
  if (low >= 0) start[low] = TWIN_RETURN_TO & 0xFF;
  if (high >= 0) start[high] = TWIN_RETURN_TO >> 8;
}

// A memory and registers for one call: registers are drawn until the contract's `if` takes them, with another memory
// every so many tries, as an `if` can ask something of the memory too. 0 when the `if` took none of them.
static int draw(uint8_t *start, twin_regs *r, int changed) {
  for (int tries = 0; ; tries++) {
    if (tries == MOST_DRAWS) return 0;
    if (tries % PER_MEMORY == 0) {
      if (memory_count) memcpy(start, memories + (long)rnd((uint32_t)memory_count) * TWIN_MEMORY, TWIN_MEMORY);
      else for (int i = 0; i < TWIN_MEMORY; i++) start[i] = (uint8_t)rnd(256);
      int at = twin_bank_at >= 0 ? twin_place((uint16_t)twin_bank_at) : -1;
      if (own_bank >= 0 && at >= 0) start[at] = (uint8_t)own_bank;
    }
    r->A = any_byte(); r->B = any_byte(); r->C = any_byte(); r->D = any_byte(); r->E = any_byte(); r->H = any_byte(); r->L = any_byte();
    // a stack with room under it and its return address above, anywhere in the work memory
    r->SP = twin->stack ? (uint16_t)(0xC100 + rnd(0x1E00)) : STACK_AT;
    r->ZF = (int)rnd(2); r->NF = (int)rnd(2); r->HF = (int)rnd(2); r->CF = (int)rnd(2);
    place_return(start, r->SP);
    if (is_given(start, r)) break;
  }
  // what the function reads, changed: the original runs to say what it reads, a few of those bytes get other values,
  // and it runs again, as other values lead it to read other bytes
  for (int round = 0; changed && round < ROUNDS; round++) {
    static uint8_t before[TWIN_MEMORY];
    static int read[TWIN_MEMORY];
    twin_regs tried = *r;
    long cycles;
    int count = 0, bank_at = twin_bank_at >= 0 ? twin_place((uint16_t)twin_bank_at) : -1;
    memcpy(orig_memory, start, TWIN_MEMORY);
    twin_reads_from(0);
    orig_call(address, bank_for(start), &tried, &cycles);
    for (int i = 0; i < TWIN_MEMORY; i++) if (orig_read[i] && !(own_bank >= 0 && i == bank_at)) read[count++] = i;
    if (!count) break;
    memcpy(before, start, TWIN_MEMORY);
    for (int n = 1 + (int)rnd(MOST_CHANGED); n > 0; n--) start[read[rnd((uint32_t)count)]] = any_byte();
    place_return(start, r->SP);
    if (!is_given(start, r)) memcpy(start, before, TWIN_MEMORY);
  }
  return 1;
}

// the stack pointer the twin's call started with, which a call it makes to a stop starts below
static uint16_t twin_sp;
void twin_stop_registers(twin_regs *r) {
  r->A = any_byte(); r->B = any_byte(); r->C = any_byte(); r->D = any_byte(); r->E = any_byte(); r->H = any_byte(); r->L = any_byte();
  r->ZF = (int)rnd(2); r->NF = (int)rnd(2); r->HF = (int)rnd(2); r->CF = (int)rnd(2);
  r->SP = (uint16_t)(twin_sp - 2);
}

static void flags_text(char *into, const twin_regs *r) {
  snprintf(into, 8, "%s%s%s%s", r->ZF ? "Z" : "-", r->NF ? "N" : "-", r->HF ? "H" : "-", r->CF ? "C" : "-");
}

static void run(tally *out, long calls, int changed) {
  static uint8_t start[TWIN_MEMORY];
  memset(out, 0, sizeof *out);
  out->least = 1L << 30;
  out->most = -(1L << 30);
  for (long i = 0; i < calls && out->ran_on < MOST_HANGS; i++) {
    twin_regs entry;
    if (!draw(start, &entry, changed)) { out->calls = -1; return; }
    uint32_t reads = rnd(0xFFFFFFFFu);

    twin_regs left = entry;
    long cycles = 0;
    memcpy(orig_memory, start, TWIN_MEMORY);
    twin_reads_from(reads);
    int bank = bank_for(start);
    int how = orig_call(address, bank, &left, &cycles);
    // a call that reads where the console has nothing, or a bank nothing says is there, isn't one the game makes
    if (orig_astray || orig_bank_reads) { out->astray++; if (orig_bank_reads) out->bank_unknown++; continue; }
    out->calls++;

    twin_regs given = entry;
    long gave = 0;
    kit_memory_in(start);
    kit_begin(bank);
    twin_reads_from(reads);
    twin_sp = entry.SP;
    int sig = MARK();
    if (!sig) {
      limit_on(limit_ms);
      twin->call(&given, &gave);
      limit_off();
    } else if (sig == RAN_ON) out->ran_on++;
    else out->fell++;
    if (how) out->not_back++;
    kit_memory_out(twin_memory);

    // Every byte of the memory, but the call's own stack: from the lowest its stack pointer went up to where it came
    // back to is where the original pushed what it kept and its calls' return addresses, free once it has returned,
    // and not the game's memory unless the original stored there other than by pushing.
    int at = -1, apart = 0;
    for (int j = 0; j < TWIN_MEMORY; j++) {
      uint16_t where = twin_address(j);
      if (where >= orig_lowest && where < (uint16_t)(entry.SP + 2) && !orig_stored[j]) continue;
      if (twin_memory[j] != orig_memory[j]) { apart++; out->differs[j]++; if (at < 0) at = j; }
    }
    out->bytes += apart;
    int bank_at = twin_bank_at >= 0 ? twin_place((uint16_t)twin_bank_at) : -1;
    int bank_same = chip == TWIN_CHIP_NONE || banks <= 2 || orig_bank < 0 || (bank_at < 0 ? orig_bank == kit_bank : orig_bank == twin_memory[bank_at] % banks);
    int memory = at < 0 && bank_same;

    // what the contract says the twin gives back: its result, and each register or flag it was given by address
    int gives = 1, register_apart = -1;
    if (twin->gives && gave != twin->back(&left)) gives = 0;
    for (int n = 0; n < NAMED; n++) {
      if (!(twin->by_address >> n & 1)) continue;
      int same = n < REGISTERS ? *reg_of(&given, n) == *reg_of(&left, n) : !*flag_of(&given, n) == !*flag_of(&left, n);
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
      char *text = out->first, flags[8], stack[16] = "";
      size_t room = sizeof out->first;
      flags_text(flags, &entry);
      if (twin->stack) snprintf(stack, sizeof stack, "SP %04X, ", entry.SP);
      int used = snprintf(text, room, "A %02X, BC %02X%02X, DE %02X%02X, HL %02X%02X, %sflags %s: %s%s", entry.A, entry.B, entry.C, entry.D, entry.E, entry.H, entry.L, stack, flags,
        how == 1 ? "the original didn't come back; " : how == 2 ? "the original's processor met a byte that is no instruction; " : how == 3 ? "the original came back with its stack elsewhere; " : how == 4 ? "the original stopped to wait; " : "",
        sig == RAN_ON ? "the twin didn't come back in time; " : sig ? "the twin fell over; " : "");
      text += used; room -= (size_t)used;
      if (at >= 0) snprintf(text, room, "$%04X is %02X after the twin and %02X after the original, from %02X", twin_address(at), twin_memory[at], orig_memory[at], start[at]);
      else if (!bank_same) snprintf(text, room, "the original leaves bank %d at $4000, and the twin %d", orig_bank, bank_at < 0 ? kit_bank : twin_memory[bank_at] % banks);
      else if (!gives && register_apart >= 0) snprintf(text, room, "%s is %d after the twin and %d after the original", NAMES[register_apart],
        register_apart < REGISTERS ? *reg_of(&given, register_apart) : !!*flag_of(&given, register_apart), register_apart < REGISTERS ? *reg_of(&left, register_apart) : !!*flag_of(&left, register_apart));
      else if (!gives) {
        flags_text(flags, &left);
        snprintf(text, room, "the twin gives %ld, and the original's registers say %ld (A %02X, BC %02X%02X, DE %02X%02X, HL %02X%02X, flags %s)", gave, twin->back(&left), left.A, left.B, left.C, left.D, left.E, left.H, left.L, flags);
      } else if (!hardware && event >= 0 && event < orig_events.count) snprintf(text, room, "the hardware's %s differs: $%04X and %02X from the twin, $%04X and %02X from the original", event == 0 ? "first use" : "use, after others the same,",
        kit_events.list[event].address, kit_events.list[event].value, orig_events.list[event].address, orig_events.list[event].value);
      else if (!hardware) snprintf(text, room, "the twin uses the hardware %d times and the original %d", kit_events.count, orig_events.count);
    }
  }
}

static void print(const char *name, const tally *t) {
  printf("\"%s\":{\"calls\":%ld,\"same\":%ld,\"memory\":%ld,\"gives\":%ld,\"hardware\":%ld,\"time\":%ld,\"astray\":%ld,\"bankUnknown\":%ld,\"fell\":%ld,\"ranOn\":%ld,\"notBack\":%ld,\"least\":%ld,\"most\":%ld,\"bytes\":%ld,\"differs\":[",
    name, t->calls, t->same, t->memory, t->gives, t->hardware, t->time, t->astray, t->bank_unknown, t->fell, t->ran_on, t->not_back, t->least, t->most, t->bytes);
  // the bytes that differ most often
  static long differs[TWIN_MEMORY];
  memcpy(differs, t->differs, sizeof differs);
  for (int shown = 0; shown < 8; shown++) {
    int top = -1;
    for (int j = 0; j < TWIN_MEMORY; j++) if (differs[j] > 0 && (top < 0 || differs[j] > differs[top])) top = j;
    if (top < 0) break;
    printf("%s[%d,%ld]", shown ? "," : "", twin_address(top), differs[top]);
    differs[top] = 0;
  }
  printf("],\"first\":\"%s\"}", t->first);
}

int main(int argc, char **argv) {
  if (argc < 7) return 2;
  static uint8_t copy[1 << 23];
  FILE *file = fopen(argv[1], "rb");
  if (!file) return 2;
  size_t size = fread(copy, 1, sizeof copy, file);
  fclose(file);
  if (size < 0x150) return 2;
  uint8_t kind = copy[0x147];
  chip = kind >= 0x01 && kind <= 0x03 ? TWIN_CHIP_MBC1 : kind >= 0x0F && kind <= 0x13 ? TWIN_CHIP_MBC3 : kind >= 0x19 && kind <= 0x1E ? TWIN_CHIP_MBC5 : TWIN_CHIP_NONE;
  kit_stand_in(copy, (uint32_t)size, chip);
  banks = (int)(size / 0x4000);
  orig_init(copy, (uint32_t)size, gb_colour, chip);
  ran_ways = calloc(size, 1);
  if (!ran_ways) return 2;
  if (strcmp(argv[2], "-")) {
    file = fopen(argv[2], "rb");
    if (!file) return 2;
    fseek(file, 0, SEEK_END);
    memory_count = ftell(file) / TWIN_MEMORY;
    rewind(file);
    uint8_t *all = malloc((size_t)memory_count * TWIN_MEMORY + 1);
    if (fread(all, TWIN_MEMORY, (size_t)memory_count, file) != (size_t)memory_count) return 2;
    fclose(file);
    memories = all;
  }
  long calls = atol(argv[3]);
  int which = atoi(argv[5]);
  if (which < 0 || which >= twin_contract_count) return 2;
  twin = twin_contracts[which];
  limit_ms = atol(argv[6]);
  // where the processor sees the function: the first bank, always there, or its own bank at $4000
  uint32_t bank = twin->offset / 0x4000;
  own_bank = bank > 0 ? (int)bank : -1;
  address = (uint16_t)(bank ? 0x4000 + twin->offset % 0x4000 : twin->offset);
  watch();
  static tally real, changed;
  printf("{\"address\":%d,\"bank\":%d,", address, own_bank);
  seed = (uint32_t)atol(argv[4]) * 7919u + (uint32_t)which;
  if (memory_count) { run(&real, calls, 0); print("asItWas", &real); printf(","); }
  run(&changed, calls, 1);
  print("changed", &changed);
  // each instruction of the program the calls that came out the same ran, where it is and how it went on
  printf(",\"ran\":[");
  for (uint32_t at = 0, shown = 0; at < size; at++) if (ran_ways[at]) printf("%s%u,%d", shown++ ? "," : "", (unsigned)at, ran_ways[at]);
  printf("],\"counts\":%s}\n", kit_spent ? "true" : "false");
  return 0;
}
