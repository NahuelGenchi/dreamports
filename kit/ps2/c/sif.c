// The SIF, which carries data and calls between the EE and the IOP (ps2.h), as the console's emulator, Play!, has it,
// since that's what a Dreamport is proven against. Play! doesn't model the SIF's own hardware: what the EE sends to
// the IOP's command buffer by DMA is read there as a command, INIT, BIND, CALL or OTHERDATA, a call's arguments are
// sent ahead to an address of its own, anything else is copied into the IOP's memory, and the IOP's replies queue up
// and go to the EE's memory one at a time, each once the EE has said it took the last. The EE reaches it through its
// kernel's system calls, which are Play!'s too: SifSetDma, SifDmaStat, SifSetReg, SifGetReg and iSifSetDChain.
//
// RPC servers on the IOP are the kit's stand-ins for the modules Play! answers itself, and a Dreamport's twins of a
// game's own modules, each registered by its number (sif_register_server).
//
// Followed from Play! (https://github.com/jpd002/Play-), Copyright (c) 2006-2026, Jean-Philip Desjardins, under the
// BSD licence whose conditions and disclaimer kit/ps2/c/spu2.c carries in full.

#include "ps2-kit.h"

#define EE_RAM_SIZE 0x2000000
#define IOP_RAM_SIZE 0x400000
// where Play!'s IOP keeps its command buffer, which SifGetReg(2) gives, and the end of what its kernel keeps for itself
#define COMMAND_BUFFER 0x12500
#define CONTROL_BLOCK_END 0x10000
// the address a call's arguments are sent to, how a server's number is turned into what a bind gives back, the address
// a reset is sent to, and how long a bind waits for its server, in the EE's ticks
#define RPC_ARGUMENTS 0xDEADBEF0u
#define SERVER_XOR 0xACACACACu
#define RESET_ADDRESS 0
#define BIND_TIMEOUT 0x10000
// the EE kernel's SIF DMA queue: how many, the first id, and how long a transfer counts as queued, in ticks
#define DMA_QUEUE 0x20
#define DMA_ID_BASE 1
#define DMA_QUEUED_TICKS 1000

enum { CMD_SETSREG = 0x80000001, CMD_INIT = 0x80000002, CMD_RESET = 0x80000003, CMD_REND = 0x80000008, CMD_BIND = 0x80000009, CMD_CALL = 0x8000000A, CMD_OTHERDATA = 0x8000000C };

// a command's header, as both processors write it
typedef struct { uint32_t size_and_dest, dest, command, optional; } header;
// what a server's call or bind gets back
typedef struct { header head; uint32_t record, packet, rpc, client, command, server_data, buffer, client_buffer; } request_end;
typedef struct { header head; uint32_t record, packet, rpc, client, server; } bind;
typedef struct { header head; uint32_t record, packet, rpc, client, number, send_size, receive, receive_size, receive_mode, server_data; } call;
typedef struct { header head; uint32_t record, packet, rpc, receive, from, to, size; } other_data;

static uint8_t *ee;
static uint32_t main_address, sub_address = COMMAND_BUFFER, ms_flag, sm_flag = 0x60000, ee_receive, data_address;

// the packets queued for the EE, each its size, where it goes and its bytes, and whether the EE took the last
#define QUEUE_ROOM 0x10000
static uint8_t queue[QUEUE_ROOM];
static uint32_t queued;
static int processed = 1;

// the servers, the kit's stand-ins (serve) and a game's own modules' (function, with its buffer in the IOP's memory),
// and the binds and calls waiting for one, and the calls waiting for their module's thread
#define SERVERS 64
static struct { uint32_t id; sif_server *serve; sif_rpc *function; uint32_t buffer; } servers[SERVERS];
static struct { int server; uint32_t number, size; } waiting[SERVERS];
static int waiting_count;
static int server_count;
static struct { uint32_t id; request_end reply; int32_t timeout; } binds[SERVERS];
static int bind_count;
static struct { uint32_t id; request_end reply; call made; } calls[SERVERS];
static int call_count;

// the EE kernel's queue of SIF transfers, each by when it was set, and what the EE runs as a packet arrives
static uint32_t dma_times[DMA_QUEUE], dma_next;
static void (*ee_handler)(void);

uint8_t *ee_memory(void) {
  if (!ee) ee = kit_alloc(EE_RAM_SIZE);
  return ee;
}
void sif_ee_handler(void (*handler)(void)) { ee_handler = handler; }

static void send_to(const void *packet, uint32_t size, uint32_t to) {
  if (queued + 8 + size > QUEUE_ROOM) __builtin_trap();
  __builtin_memcpy(queue + queued, &size, 4);
  __builtin_memcpy(queue + queued + 4, &to, 4);
  __builtin_memcpy(queue + queued + 8, packet, size);
  queued += 8 + size;
}
static void send_packet(const void *packet, uint32_t size) { send_to(packet, size, ee_receive); }

static int server_index(uint32_t id) {
  for (int i = 0; i < server_count; i++) if (servers[i].id == id) return i;
  return -1;
}

static void registered(uint32_t id, sif_server *serve, sif_rpc *function, uint32_t buffer) {
  int i = server_index(id);
  if (i < 0) {
    if (server_count == SERVERS) __builtin_trap();
    i = server_count++;
  }
  servers[i].id = id;
  servers[i].serve = serve;
  servers[i].function = function;
  servers[i].buffer = buffer;
  // a bind that came before its server is answered now
  for (int b = 0; b < bind_count; b++) {
    if (binds[b].id != id) continue;
    send_packet(&binds[b].reply, sizeof binds[b].reply);
    binds[b] = binds[--bind_count];
    break;
  }
}
void sif_register_server(uint32_t id, sif_server *serve) { registered(id, serve, 0, 0); }
// as a module's sceSifRegisterRpc does, a number a stand-in already answers staying the stand-in's, as in the emulator
void sif_register_rpc(uint32_t id, sif_rpc *function, uint32_t buffer) {
  if (server_index(id) < 0) registered(id, 0, function, buffer);
}
int sif_server_registered(uint32_t id) { return server_index(id) >= 0; }

// ----------------------------------------------------------------------------------------------------------------
// The commands the EE sends

static void command_init(const header *head) {
  if (head->optional == 0) {
    __builtin_memcpy(&ee_receive, (const uint8_t *)head + 16, 4);
    ee_receive &= EE_RAM_SIZE - 1;
  } else if (head->optional == 1) {
    // the RPC library's start, answered with a SETSREG
    uint32_t sreg[6] = { sizeof sreg, 0, CMD_SETSREG, 0, 0, 1 };
    send_packet(sreg, sizeof sreg);
  }
}
static void command_bind(const header *head) {
  bind b;
  __builtin_memcpy(&b, head, sizeof b);
  request_end end = { { sizeof end, b.head.dest, CMD_REND, 0 }, b.record, b.packet, b.rpc, b.client, CMD_BIND, b.server ^ SERVER_XOR, RPC_ARGUMENTS, 0xDEADCAFE };
  end.head.size_and_dest = sizeof end;
  if (server_index(b.server) >= 0) send_packet(&end, sizeof end);
  else if (bind_count < SERVERS) {
    binds[bind_count].id = b.server;
    binds[bind_count].reply = end;
    binds[bind_count++].timeout = BIND_TIMEOUT;
  }
}
static void command_call(const header *head) {
  call c;
  __builtin_memcpy(&c, head, sizeof c);
  uint32_t id = c.server_data ^ SERVER_XOR;
  int answer = 1;
  int i = server_index(id);
  if (i >= 0 && servers[i].serve) {
    uint8_t *mem = ee_memory();
    answer = servers[i].serve(c.number, mem + data_address, c.send_size, mem + (c.receive & (EE_RAM_SIZE - 1)), c.receive_size);
  } else if (i >= 0) {
    // a module's own server: its arguments go to its buffer, a whole number of quadwords, and its thread answers when
    // the IOP next runs
    if (servers[i].buffer) __builtin_memcpy(iop_memory() + (servers[i].buffer & (IOP_RAM_SIZE - 1)), ee_memory() + data_address, (c.send_size + 15) & ~15u);
    if (waiting_count < SERVERS) {
      waiting[waiting_count].server = i;
      waiting[waiting_count].number = c.number;
      waiting[waiting_count++].size = c.send_size;
    }
    answer = 0;
  }
  request_end end = { { sizeof end, c.head.dest, CMD_REND, 0 }, c.record, c.packet, c.rpc, c.client, CMD_CALL, 0, 0, 0 };
  if (answer) send_packet(&end, sizeof end);
  else if (call_count < SERVERS) {
    // held until the server answers, one call a server at a time
    calls[call_count].id = id;
    calls[call_count].reply = end;
    calls[call_count++].made = c;
  }
}
static void command_other_data(const header *head) {
  other_data o;
  __builtin_memcpy(&o, head, sizeof o);
  __builtin_memcpy(ee_memory() + (o.to & (EE_RAM_SIZE - 1)), iop_memory() + (o.from & (IOP_RAM_SIZE - 1)), o.size);
  request_end end = { { sizeof end, o.head.dest, CMD_REND, 0 }, o.record, o.packet, o.rpc, o.receive, CMD_OTHERDATA, 0, 0, 0 };
  send_packet(&end, sizeof end);
}

// a transfer the EE sends the IOP by DMA, as the emulator's SIF takes it
static void received(uint32_t from, uint32_t size, uint32_t to) {
  from &= EE_RAM_SIZE - 1;
  uint8_t *mem = ee_memory();
  if (to == RPC_ARGUMENTS) {
    data_address = from;
    return;
  }
  if (to == RESET_ADDRESS) {
    // a reset of the IOP with a new set of modules isn't done yet: the kit's IOP goes on as it was
    return;
  }
  if (to == sub_address) {
    header head;
    __builtin_memcpy(&head, mem + from, sizeof head);
    switch (head.command) {
    case CMD_INIT: command_init((const header *)(mem + from)); break;
    case CMD_BIND: command_bind((const header *)(mem + from)); break;
    case CMD_CALL: command_call((const header *)(mem + from)); break;
    case CMD_OTHERDATA: command_other_data((const header *)(mem + from)); break;
    }
    return;
  }
  size &= 0x7FFFFFFF;
  if (to > CONTROL_BLOCK_END && to < IOP_RAM_SIZE) {
    if (to + size > IOP_RAM_SIZE) size = IOP_RAM_SIZE - to;
    __builtin_memcpy(iop_memory() + to, mem + from, size);
  }
}

// ----------------------------------------------------------------------------------------------------------------
// The EE kernel's SIF calls

uint32_t sif_set_dma(const sif_transfer *transfers, uint32_t count) {
  uint32_t index = dma_next;
  dma_times[index] = (uint32_t)ps2_ee_time();
  dma_next = (dma_next + 1) % DMA_QUEUE;
  // the emulator always sends something
  if (count == 0) count = 1;
  for (uint32_t i = 0; i < count; i++) received(transfers[i].from, (transfers[i].size + 15) / 16 * 16, transfers[i].to);
  return index + DMA_ID_BASE;
}
int32_t sif_dma_stat(uint32_t id) {
  uint32_t index = id - DMA_ID_BASE;
  if (index >= DMA_QUEUE) return -1;
  int64_t since = (int64_t)(uint64_t)(uint32_t)ps2_ee_time() - (int64_t)(uint64_t)dma_times[index];
  return since < 0 || since > DMA_QUEUED_TICKS ? -1 : 1;
}
void sif_set_dchain(int from_interrupt) {
  // only the interrupt's own call says the EE took the last packet
  if (from_interrupt) processed = 1;
}
uint32_t sif_get_reg(uint32_t which) {
  switch (which) {
  case 0x00000001: return main_address;
  case 0x00000002: return sub_address;
  case 0x00000003: return ms_flag;
  case 0x00000004: return sm_flag;
  case 0x80000000: return RESET_ADDRESS;
  case 0x80000002: return 1;
  }
  return 0;
}
void sif_set_reg(uint32_t which, uint32_t value) {
  if (which == 0x00000001) main_address = value;
}

// ----------------------------------------------------------------------------------------------------------------
// The IOP's side

void sif_call_reply(uint32_t id, const void *data) {
  for (int i = 0; i < call_count; i++) {
    if (calls[i].id != id) continue;
    if (calls[i].made.receive != 0 && data) {
      __builtin_memcpy(ee_memory() + (calls[i].made.receive & (EE_RAM_SIZE - 1)), data, (calls[i].made.receive_size + 3) & ~3u);
    }
    send_packet(&calls[i].reply, sizeof calls[i].reply);
    calls[i] = calls[--call_count];
    return;
  }
}

// The IOP's part of a slice: each module's server thread a call woke runs its function, and its answer goes back from
// where the function says it is, as the emulator's sifcmd does.
void sif_iop_run(void) {
  for (int w = 0; w < waiting_count; w++) {
    int i = waiting[w].server;
    uint32_t answer = servers[i].function(waiting[w].number, servers[i].buffer, waiting[w].size);
    sif_call_reply(servers[i].id, iop_memory() + (answer & (IOP_RAM_SIZE - 1)));
  }
  waiting_count = 0;
}

// As the EE's ticks pass: a bind whose server never came is answered with none, and the next packet goes to the EE's
// memory once it has taken the last, as the EE's DMA channel 5 brings it, and the EE's handler runs.
void sif_ticks(uint32_t ticks) {
  for (int b = 0; b < bind_count;) {
    if (binds[b].timeout < 0) {
      binds[b].reply.server_data = 0;
      send_packet(&binds[b].reply, sizeof binds[b].reply);
      binds[b] = binds[--bind_count];
    } else {
      binds[b++].timeout -= (int32_t)ticks;
    }
  }
  if (processed && queued) {
    uint32_t size, to;
    __builtin_memcpy(&size, queue, 4);
    __builtin_memcpy(&to, queue + 4, 4);
    __builtin_memcpy(ee_memory() + (to & (EE_RAM_SIZE - 1)), queue + 8, size);
    queued -= 8 + size;
    __builtin_memmove(queue, queue + 8 + size, queued);
    processed = 0;
    if (ee_handler) ee_handler();
  }
}
