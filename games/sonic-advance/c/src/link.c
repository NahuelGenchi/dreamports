// The link cable between the GBAs of a multiplayer game played on one page (the original's MultiSio), translated from
// engine/link.js. Each GBA keeps a 20-byte packet to send (gMultiSioSend), which its tasks change during its frame and
// which stays as it is between frames. At the start of a frame the library reads in what the others sent and hands its
// own packet over to the transfer, which runs during that frame, so every GBA's tasks read the packets all of them had at
// the end of the frame before last (gMultiSioRecv). The last GBA's packet, the one the transfer ends with, reaches the
// GBAs before it a frame later still, as the linked cores show for 2, 3 and 4 GBAs.
//
// Each GBA on the page is a WebAssembly of its own, so each keeps its own copy of what the link carried: once every GBA
// has run its frame, the page, which is the cable, writes every GBA's packet and whether it was on into each one's cable
// (dp_link_join gives where it is), and the frame ends (dp_link_end_frame). A GBA with no cable carries its own packet alone, as engine/link.js's link of one.
//
// The VS menus read the link as the MultiSio library gives it: a GBA takes part once its tasks switch it on
// (link_enable, MultiSioStart and MultiSioStop), the status flags say whose packet it holds (bit n for GBA n, 0x80 for the
// parent, the GBA with id 0, once another is on), and link_slot(n) is the packet it holds of GBA n, or NULL.

#include "sa.h"
#include "page.h"

#define DELAY 2   // frames from a packet's send to its reception
#define KEEP 4

typedef struct { uint8_t packets[PLAYERS_MAX][PACKET_SIZE]; uint8_t on[PLAYERS_MAX]; } Shot;

// what the page reads and writes, in this order (main.js): this GBA's packet and whether it is on, then every GBA's at
// the frame's end
static struct { uint8_t send[PACKET_SIZE]; uint8_t on, pad[3]; Shot frame; } cable;
static Shot sent[KEEP];   // what the GBAs sent and which were on at the end of each of the last KEEP frames
static int kept, newest;
static int count = 1, me, driven;

/** The GBA's number on the link, and how many there are. */
int link_id(void) { return me; }
int link_count(void) { return count; }

// the frames a packet of GBA `sender` takes to reach GBA `receiver`
static int delay_from(int receiver, int sender) { return sender == count - 1 && receiver < sender ? DELAY + 1 : DELAY; }
// the link as it was `delay` frames ago, or NULL while it hasn't carried that much yet
static const Shot *snapshot(int delay) { return kept >= delay ? &sent[(newest - delay + 1 + KEEP) % KEEP] : NULL; }

/** This GBA's packet, which its tasks write. */
uint8_t *link_send(void) { return cable.send; }
/** MultiSioStart (1) and MultiSioStop (0). */
void link_enable(int on) { cable.on = (uint8_t)(on != 0); }

/** The packet this GBA holds of GBA `n`, or NULL. */
const uint8_t *link_slot(int n) {
  if (n < 0 || n >= PLAYERS_MAX) return NULL;
  const Shot *shot = snapshot(delay_from(me, n));
  return shot && shot->on[n] && shot->on[me] ? shot->packets[n] : NULL;
}

/** The library's status flags. */
int link_flags(void) {
  int flags = 0;
  for (int n = 0; n < count; n++) if (link_slot(n)) flags |= 1 << n;
  const Shot *shot = snapshot(DELAY);
  if (me == 0 && shot && shot->on[0]) {
    for (int n = 1; n < count; n++) if (shot->on[n]) { flags |= 0x80; break; }
  }
  return flags;
}

/** SIODATA32's halves: 0 until a transfer has happened, 0xFFFF for a GBA that answered nothing. */
int link_data(int n) { return snapshot(DELAY) ? (link_slot(n) ? 1 : 0xFFFF) : 0; }

/** A packet's kind, or 0 for none. */
int packet_kind(const uint8_t *packet) { return packet ? packet[0] | packet[1] << 8 : 0; }

static void end_frame(void) {
  newest = (newest + 1) % KEEP;
  sent[newest] = cable.frame;
  if (kept < KEEP) kept++;
}

/** A frame of the GBA is over: with no cable, the link carries its own packet alone. */
void link_frame_done(void) {
  if (driven) return;
  memset(&cable.frame, 0, sizeof cable.frame);
  memcpy(cable.frame.packets[0], cable.send, PACKET_SIZE);
  cable.frame.on[0] = cable.on;
  end_frame();
}

/**
 * The page puts the GBA on a cable with `players` GBAs, as number `id`, before its first frame, and from then on ends its
 * frames. Returns where the cable's bytes are.
 */
EXPORT("dp_link_join") uint8_t *dp_link_join(int players, int id) {
  count = players < 1 ? 1 : players > PLAYERS_MAX ? PLAYERS_MAX : players;
  me = id < 0 || id >= count ? 0 : id;
  driven = 1;
  return (uint8_t *)&cable;
}
/** Every GBA's frame is over, and the page has put what each sent in the cable's frame: the link carries it. */
EXPORT("dp_link_end_frame") void dp_link_end_frame(void) { end_frame(); }
