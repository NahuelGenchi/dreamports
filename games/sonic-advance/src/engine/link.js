// The link cable between the GBAs of a multiplayer game played on one page (the original's MultiSio). Each GBA
// keeps a 20-byte packet to send (gMultiSioSend), which its tasks change during its frame and which stays as
// it is between frames. At the start of a frame the library reads in what the others sent and hands its own
// packet over to the transfer, which runs during that frame, so every GBA's tasks read the packets all of
// them had at the end of the frame before last (gMultiSioRecv, its own among them). The link recordings show
// this latency (docs/ROM.md).
//
// A packet is the original's bytes: [0] u16 its kind (0x1000 in a stage), then what that kind carries; in a
// stage (MultiSioData_0_4) s16 x and y at 2 and 4, u16 animation at 6, u16 flags at 8, then four bytes and,
// from 0xE, the room event being sent (mp_event_mgr.c).

export const PACKET_SIZE = 20;
const DELAY = 2;   // frames from a packet's send to its reception. Every packet is read 2 frames after it was sent, but the last GBA's, the one
// the transfer ends with, reaches the GBAs before it only 3 frames after, as the linked cores show for 2, 3 and 4 GBAs
const delayFrom = (count, receiver, sender) => (sender === count - 1 && receiver < sender ? DELAY + 1 : DELAY);
const KEEP = 4;

/** A packet's fields, read and written as the original lays them out. */
export function packetView(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, PACKET_SIZE);
  return {
    bytes,
    get kind() { return v.getUint16(0, true); }, set kind(n) { v.setUint16(0, n, true); },
    get x() { return v.getInt16(2, true); }, set x(n) { v.setInt16(2, n, true); },
    get y() { return v.getInt16(4, true); }, set y(n) { v.setInt16(4, n, true); },
    get anim() { return v.getUint16(6, true); }, set anim(n) { v.setUint16(6, n, true); },
    get flags() { return v.getUint16(8, true); }, set flags(n) { v.setUint16(8, n, true); },
    get itemEffect() { return bytes[0xA]; }, set itemEffect(n) { bytes[0xA] = n; },
    get variant() { return bytes[0xB]; }, set variant(n) { bytes[0xB] = n; },
    get animSpeed() { return bytes[0xC]; }, set animSpeed(n) { bytes[0xC] = n; },
    get rotation() { return bytes[0xD]; }, set rotation(n) { bytes[0xD] = n; },
    /** The room event: its type at 0xE and five bytes of what it carries. */
    get event() { return bytes.subarray(0xE, PACKET_SIZE); },
  };
}

/**
 * The link between `count` GBAs. `send(i)` is GBA i's own packet, which its tasks write; `recv(i)` the packet
 * GBA i sent DELAY frames ago, or null while the link has carried nothing yet; `endFrame()` closes a frame of
 * every GBA.
 *
 * The VS menus read it as the original's MultiSio library gives it (`view(i)`): a GBA takes part once its tasks
 * switch it on (`enable(i, on)`, MultiSioStart and MultiSioStop), the link's status flags say whose packet it
 * holds (bit n for GBA n, 0x80 for the parent, the GBA with id 0, once another is on), and each GBA's `slot(n)`
 * is the packet it holds of GBA n, or null.
 */
export function createLink(count) {
  const send = Array.from({ length: count }, () => packetView(new Uint8Array(PACKET_SIZE)));
  const on = new Array(count).fill(false);
  const sent = [];   // what the GBAs sent and which were on at the end of each of the last DELAY frames, oldest first
  const snapshot = delay => sent[sent.length - delay] ?? null;
  return {
    count,
    send: i => send[i],
    recv: i => (sent.length >= DELAY ? sent[sent.length - DELAY].packets[i] : null),
    enable(i, value) { on[i] = value; },
    isOn: i => on[i],
    endFrame() {
      sent.push({ packets: send.map(p => packetView(p.bytes.slice())), on: on.slice() });
      if (sent.length > KEEP) sent.shift();
    },
    /** What GBA `id` reads from the library: { flags, slot(n), data(n), id }. */
    view(id) {
      const delayOf = n => delayFrom(count, id, n);
      const slot = n => {
        const shot = snapshot(delayOf(n));
        return shot?.on[n] && shot.on[id] ? shot.packets[n] : null;
      };
      let flags = 0;
      for (let n = 0; n < count; n++) if (slot(n)) flags |= 1 << n;
      const shot = snapshot(DELAY);
      if (id === 0 && shot?.on[0] && shot.on.some((v, n) => n !== 0 && v)) flags |= 0x80;
      return {
        id, flags, slot,
        // SIODATA32's halves: 0 until a transfer has happened, 0xFFFF for a GBA that answered nothing
        data: n => (snapshot(DELAY) ? (slot(n) ? 1 : 0xFFFF) : 0),
      };
    },
  };
}
