/** A single CEA-708 byte with metadata. */
export interface Cea708Byte {
    pts: number;
    type: number;
    value: number;
    order: number;
}
export declare const DTVCC_PACKET_DATA = 2;
export declare const DTVCC_PACKET_START = 3;
/** A built DTVCC packet that can be read byte-by-byte. */
export declare class DtvccPacket {
    private pos;
    private packetData;
    constructor(packetData: Cea708Byte[]);
    hasMoreData(): boolean;
    getPosition(): number;
    readByte(): Cea708Byte;
    skip(n: number): void;
}
/**
 * Builds DTVCC packets from ccType 2/3 byte stream.
 * See Figure 5 CCP State Table in 5.2 of CEA-708-E.
 */
export declare class DtvccPacketBuilder {
    private builtPackets;
    private currentPacket;
    private bytesLeft;
    addByte(cea708Byte: Cea708Byte): void;
    getBuiltPackets(): DtvccPacket[];
    clearBuiltPackets(): void;
    clear(): void;
}
