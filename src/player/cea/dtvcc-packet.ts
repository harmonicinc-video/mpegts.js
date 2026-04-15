/*
 * Ported from Shaka Player (lib/cea/dtvcc_packet_builder.js)
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** A single CEA-708 byte with metadata. */
export interface Cea708Byte {
    pts: number;
    type: number;   // 2 = DTVCC_PACKET_DATA, 3 = DTVCC_PACKET_START
    value: number;
    order: number;
}

export const DTVCC_PACKET_DATA = 2;
export const DTVCC_PACKET_START = 3;

/** A built DTVCC packet that can be read byte-by-byte. */
export class DtvccPacket {
    private pos = 0;
    private packetData: Cea708Byte[];

    constructor(packetData: Cea708Byte[]) {
        this.packetData = packetData;
    }

    hasMoreData(): boolean {
        return this.pos < this.packetData.length;
    }

    getPosition(): number {
        return this.pos;
    }

    readByte(): Cea708Byte {
        if (!this.hasMoreData()) {
            throw new Error('DTVCC: Buffer read out of bounds');
        }
        return this.packetData[this.pos++];
    }

    skip(n: number): void {
        if (this.pos + n > this.packetData.length) {
            throw new Error('DTVCC: Buffer read out of bounds');
        }
        this.pos += n;
    }
}

/**
 * Builds DTVCC packets from ccType 2/3 byte stream.
 * See Figure 5 CCP State Table in 5.2 of CEA-708-E.
 */
export class DtvccPacketBuilder {
    private builtPackets: DtvccPacket[] = [];
    private currentPacket: Cea708Byte[] | null = null;
    private bytesLeft = 0;

    addByte(cea708Byte: Cea708Byte): void {
        if (cea708Byte.type === DTVCC_PACKET_START) {
            const packetSize = cea708Byte.value & 0x3f;
            this.bytesLeft = packetSize * 2 - 1;
            this.currentPacket = [];
            return;
        }
        if (!this.currentPacket) return;

        if (this.bytesLeft > 0) {
            this.currentPacket.push(cea708Byte);
            this.bytesLeft--;
        }
        if (this.bytesLeft === 0) {
            this.builtPackets.push(new DtvccPacket(this.currentPacket));
            this.currentPacket = null;
        }
    }

    getBuiltPackets(): DtvccPacket[] {
        return this.builtPackets;
    }

    clearBuiltPackets(): void {
        this.builtPackets = [];
    }

    clear(): void {
        this.builtPackets = [];
        this.currentPacket = null;
        this.bytesLeft = 0;
    }
}
