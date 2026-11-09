// The act's terrain and the sensors that read it for Sonic, translated from the JavaScript version's engine/terrain.js
// and engine/sensors.js.

#ifndef SA_TERRAIN_H
#define SA_TERRAIN_H

#include "player.h"

enum { IGNORE_PLATFORMS = 0x80 };   // added to a layer: jump-through tiles count as empty
enum { PROBE_FLOOR, PROBE_WALL };   // a scan along a column, or along a row

typedef struct { int d, rot, hasRot; } Scan;

/** sub_801E4E4, the original's terrain scan: the distance from `p0` to the last free pixel along `step` (+8 or -8),
 *  and the surface's angle, if it found a surface. `p1` is the other coordinate. */
Scan terrain_scan(int probe, int p0, int p1, int layer, int step);

/** The one-tile floor probe (sub_801F100): the distance from (x, y) to the floor within the tile holding y, 0 or less at or
 *  inside it. An empty tile sends it on to the next one along `step` (+8 or -8), a full one to the tile before. */
int terrain_tile_floor(int x, int y, int layer, int step);
/** The same probe along either axis (the JavaScript version's tileScan): `kind` and the coordinates as terrain_scan takes them. */
int terrain_tile_scan(int kind, int p0, int p1, int layer, int step);
/** sub_801F07C: the same probe with the tile's angle, which an empty tile hasn't (hasRot 0). */
Scan terrain_tile_probe(int kind, int p0, int p1, int layer, int step);
/** The surface angle of the tile at (px, py), 0-255 a turn, mirrored for flipped tiles. */
int terrain_angle(int px, int py, int layer);

/** sub_8022D6C: keeps a grounded Sonic on the surface, follows its angle, or lets him fall off. */
void sensors_ground(Player *p);
/** sub_8023128 walking and sub_80231C0 rolling: stops Sonic at a wall ahead one frame early. True when a wall to his
 *  side pushed him back. */
int sensors_wall_push(Player *p, int rolling);
/** sub_8022190: the collision of Sonic in the air, touching him down on the ground. */
void sensors_air(Player *p);
/** His angle in the act's own terms: turned over when gravity is flipped. */
int sensors_act_angle(const Player *p);
/** sub_8022F58: the room above Sonic, or beyond him, in the act's direction `angle`. */
int sensors_clearance(const Player *p, int angle);
/** Player_HandleSpriteYOffsetChange: moves his centre so his feet stay put when the offset changes. */
void sensors_set_offset_y(Player *p, int offsetY);

#endif
