// Draw order of the markers on the driver's maps.
//
// The address pill must have a HIGHER z-index than the car. react-native-maps keeps its features in a list indexed by child position,
// and React Native sorts a map's children by z-index before mounting them. The pill mounts later (it waits for the address), so with a
// lower z-index it sorted in front of the car and was inserted at the car's index; the library writes into that slot (set, not insert),
// which overwrote the car's entry, and the car never appeared on the map (the pill, mounted last, still did). With the pill above the car
// it is appended after the car and nothing is overwritten. Found on a real phone, 14 Nov 2026: a ring of test markers showed that
// flat, opacity and rotation were never the cause.
export const MARKER_Z = { car: 10, pill: 11 } as const
