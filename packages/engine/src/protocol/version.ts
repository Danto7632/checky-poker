// A-PROTO-VERSION (T-023): '1.0' names the frozen contract 1.0.4 (including the pre-freeze patch 1.0.4-p1).
// Before release the label does not move; after the freeze, any change to a P2P message, field or the wire
// format bumps it. G.HELLO.proto must equal it exactly (SS8 rule 6).
export const PROTOCOL_VERSION = '1.0';
