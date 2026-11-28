// The level's collision: the tiles of its metatiles, how high the ground is in each, and the sensors that look for it, in
// C.
#include "stage_init.h"

int Div(int num, int denom);

/** How high the ground is in a tile's column or row, and which way it turns: GetTileHeightAndRotation and its kin. */
typedef s32 (*SensorFunc)(s32 pos, s32 other, u32 layer, u8 *outRotation);

/** PlayerSensorCast, 0x0803FA40 to 0x0803FBEE: how far the ground is from a place along one direction, looking through
 *  up to three tiles with the height function it's given, and which way the ground turns where it's found. */
s32 PlayerSensorCast(s32 pos, s32 other, s32 layer, s32 step, u8 *outRotation, SensorFunc func) {
  u8 local[4];
  u8 *found;
  s32 result;
  s32 offset;

  if (outRotation == NULL) {
    outRotation = local;
  }
  found = &local[0];
  found++;

  result = CALL(func)(pos, other, layer, found);
  if (result == 0) {
    result = CALL(func)(pos + step, other, layer, found);
    if (result == 0) {
      offset = step * 2;
      result = CALL(func)(pos + offset, other, layer, found);
      if (result == 0) {
        if (step > 0) {
          s32 inTile = pos % 8u;
          result = 24;
          return result - inTile;
        } else {
          return (pos % 8u) + 17;
        }
      } else if (result == 8) {
        *outRotation = *found;
        if (step > 0) {
          return ~(pos % 8u) + 16;
        } else {
          return (pos % 8u) + 8;
        }
      } else {
        *outRotation = *found;
        if (result > 0) {
          result--;
          result -= pos % 8u;
          return result + 16;
        } else {
          return result + (pos % 8u) + 16;
        }
      }
    } else if (result == 8) {
      *outRotation = *found;
      if (step > 0) {
        return ~(pos % 8u) + 8;
      } else {
        return (pos % 8u) + 0;
      }
    } else {
      *outRotation = *found;
      if (result > 0) {
        result--;
        result -= pos % 8u;
        return result + 8;
      } else {
        return result + (pos % 8u) + 8;
      }
    }
  } else if (result == 8) {
    *outRotation = *found;
    offset = -step;
    result = CALL(func)(pos + offset, other, layer, found);
    if (result == 8) {
      *outRotation = *found;
      offset -= step;
      result = CALL(func)(pos + offset, other, layer, found);
      if (result == 8) {
        *outRotation = *found;
        if (step > 0) {
          return ~(pos % 8u) - 16;
        } else {
          return (pos % 8u) - 24;
        }
      } else if (result == 0) {
        if (step > 0) {
          s32 inTile = pos % 8u;
          result = -9;
          return result - inTile;
        } else {
          return (pos % 8u) - 16;
        }
      } else {
        *outRotation = *found;
        if (result > 0) {
          result--;
          result -= pos % 8u;
          return result - 16;
        } else {
          return result + (pos % 8u) - 16;
        }
      }
    } else if (result == 0) {
      if (step > 0) {
        return ~(pos % 8u) + 0;
      } else {
        return (pos % 8u) - 8;
      }
    } else {
      *outRotation = *found;
      if (result > 0) {
        result--;
        result -= pos % 8u;
        return result - 8;
      } else {
        return result + (pos % 8u) - 8;
      }
    }
  } else {
    *outRotation = *found;
    if (result <= 0) {
      return result + (pos % 8u);
    } else {
      return (--result) - (pos % 8u);
    }
  }
}

/** GetMetatileId, 0x08040080: the tile of the level's collision at a place, in one of its two layers, through the
 *  metatile that holds it, keeping the last column and row worked out. */
u32 GetMetatileId(s32 x, s32 y, u32 layer) {
  s32 tileX = x >> 3;
  s32 tileY;
  s32 metaX, inX, metaY, inY;
  const struct Collision *coll;
  u8 meta;

  if (gStageColCacheX.tile == tileX) {
    inX = gStageColCacheX.mod12;
    metaX = gStageColCacheX.div12;
  } else {
    metaX = Div(tileX, 12);
    inX = tileX - metaX * 12;
    gStageColCacheX.tile = tileX;
    gStageColCacheX.div12 = metaX;
    gStageColCacheX.mod12 = inX;
  }

  tileY = y >> 3;
  if (gStageColCacheY.tile == tileY) {
    inY = gStageColCacheY.mod12;
    metaY = gStageColCacheY.div12;
  } else {
    metaY = Div(tileY, 12);
    inY = tileY - metaY * 12;
    gStageColCacheY.tile = tileY;
    gStageColCacheY.div12 = metaY;
    gStageColCacheY.mod12 = inY;
  }

  coll = gRefCollision;
  meta = coll->map[layer][coll->levelX * metaY + metaX];
  return coll->metatiles[meta * 144 + inY * 12 + inX];
}

/** GetTileHeightAndRotation, 0x0803FF50: how high the ground is in the column of the tile at a place, and which way its
 *  surface turns, with the tile flipped as its metatile says, and the platforms one passes through left out when asked. */
s32 GetTileHeightAndRotation(s32 y, s32 x, u32 layerAndFlags, u8 *outRotation) {
  u32 tile, index;
  s32 column, height;
  u8 rotation;

  x = (x < 0) ? 0 : ((x > gRefCollision->pxWidth - 1) ? gRefCollision->pxWidth - 1 : x);
  y = (y < 0) ? 0 : ((y > gRefCollision->pxHeight - 1) ? gRefCollision->pxHeight - 1 : y);

  tile = GetMetatileId(x, y, layerAndFlags & 1);
  index = tile & 0x3FF;
  column = x & 7;
  if (tile & 0x400) {
    column = 7 - column;
  }

  // each column's height is the top half of a signed byte
  height = ((const s8 *)gRefCollision->heightMap)[(index << 3) + column];
  if ((height >>= 4) == -8) {
    height = 8;
  }

  if (layerAndFlags & 0x80) {
    if ((gRefCollision->flags[index >> 3] >> ((index & 7) * 2)) & 1) {
      height = 0;
    }
  }

  // upside down, a column's ground hangs from the tile's top
  if (tile & 0x800) {
    s32 flipped;
    if (height != 8 && height != 0) {
      flipped = height + 8;
      flipped = (height > 0) ? height - 8 : flipped;
    } else {
      flipped = height;
    }
    height = flipped;
  }

  rotation = gRefCollision->tileRotation[index];
  if (tile & 0x400) {
    rotation = -rotation;
  }

  if (tile & 0x800) {
    u8 upside;
    if (height != 0) {
      u32 turned = -0x80 - rotation;
      upside = turned;
    } else {
      upside = rotation;
    }
    rotation = upside;
  }

  *outRotation = rotation;
  return height;
}
