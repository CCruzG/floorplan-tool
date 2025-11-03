// renderer/models/roomDefaults.js
// Default minimum area (in square meters) per room type and overheads.
export const ROOM_MIN_AREAS = {
  bedroom: 9,    // m^2 per bedroom
  bathroom: 3,   // m^2 per bathroom
  kitchen: 6,    // m^2 for kitchen
  living: 10     // m^2 for living/common space
};

export const DEFAULT_OVERHEAD = 0.12; // 12% circulation/structural overhead

export const DEFAULT_CONFIG = {
  roomMinAreas: ROOM_MIN_AREAS,
  overhead: DEFAULT_OVERHEAD
};
