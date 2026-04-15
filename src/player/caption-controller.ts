/**
 * CaptionController
 *
 * Handles both CEA-608 and CEA-708 (DTVCC) caption decoding.
 * Routes ccType 0/1 → CEA-608 parser, ccType 2/3 → CEA-708 DTVCC pipeline.
 *
 * CEA-708 port based on Shaka Player (Apache-2.0).
 */
import Log from '../utils/logger';
import Cea608Parser from './cea608-parser';
import CaptionOutputFilter from './caption-output-filter';
import CaptionRenderer from './caption-renderer';
import { Cea708Byte, DtvccPacketBuilder, DTVCC_PACKET_DATA, DTVCC_PACKET_START } from './cea/dtvcc-packet';
import { Cea708Service } from './cea/cea708-service';
import { Cea708Caption } from './cea/cea708-window';

export default class CaptionController {
    private TAG: string = 'CaptionController';
    private _media_element: HTMLMediaElement;
    private _cea608_parser1: Cea608Parser;   // field 1 (CC1/CC2)
    private _cea608_parser2: Cea608Parser;   // field 2 (CC3/CC4)
    private _text_track: TextTrack | null = null;
    private _renderer: CaptionRenderer | null = null;

    // CEA-708 DTVCC
    private _dtvcc_builder: DtvccPacketBuilder;
    private _cea708_services: Map<number, Cea708Service> = new Map();
    private _cea708_order = 0;
    private _has_dtvcc_data = false;


    constructor(
        mediaElement: HTMLMediaElement,
        config: any
    ) {
        this._media_element = mediaElement;

        // Create native TextTrack (hidden — used for CEA-608 fallback only)
        this._text_track = mediaElement.addTextTrack('captions', 'English', 'en');
        this._text_track.mode = 'hidden';  // always hidden — we use CaptionRenderer

        // DOM-based caption renderer (VLC-quality rendering)
        this._renderer = new CaptionRenderer(mediaElement);
        this._renderer.setVisible(config.showCaptions !== false);

        // CEA-608: OutputFilter bridges parser → TextTrack (VTTCue)
        const filter1 = new CaptionOutputFilter(this._text_track);
        const filter2 = new CaptionOutputFilter(this._text_track);
        this._cea608_parser1 = new Cea608Parser(1, filter1, filter2);

        const filter3 = new CaptionOutputFilter(this._text_track);
        const filter4 = new CaptionOutputFilter(this._text_track);
        this._cea608_parser2 = new Cea608Parser(3, filter3, filter4);

        // CEA-708 DTVCC
        this._dtvcc_builder = new DtvccPacketBuilder();

        Log.v(this.TAG, 'CaptionController initialized (608+708)');
    }

    /**
     * Called when CAPTION_DATA_ARRIVED fires.
     * @param pts_ms PTS in milliseconds (already rebased)
     * @param data   { ccData: Uint8Array, ccCount: number }
     */
    onCaptionData(pts_ms: number, data: { ccData: Uint8Array, ccCount: number }): void {
        const mediaTime = pts_ms / 1000;

        // Extract and route triplets to 608 vs 708 paths
        const extracted = this.extractCcData(data.ccData, mediaTime);

        // --- CEA-708 DTVCC path ---
        if (extracted.cea708.length > 0) {
            this._has_dtvcc_data = true;
            for (const byte of extracted.cea708) {
                this._dtvcc_builder.addByte(byte);
            }
            const packets = this._dtvcc_builder.getBuiltPackets();
            for (const pkt of packets) {
                try {
                    while (pkt.hasMoreData()) {
                        const header = pkt.readByte().value;
                        let serviceNum = (header & 0xe0) >> 5;
                        const blockSize = header & 0x1f;
                        if (serviceNum === 0x07 && blockSize !== 0) {
                            serviceNum = pkt.readByte().value & 0x3f;
                        }
                        if (serviceNum !== 0) {
                            if (!this._cea708_services.has(serviceNum)) {
                                this._cea708_services.set(serviceNum, new Cea708Service(serviceNum));
                            }
                            const svc = this._cea708_services.get(serviceNum)!;
                            const startPos = pkt.getPosition();
                            while (pkt.getPosition() - startPos < blockSize) {
                                const captions = svc.handleCea708ControlCode(pkt);
                                for (const cap of captions) {
                                    this.addCea708Cue(cap);
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Invalid packet — skip it
                }
            }
            this._dtvcc_builder.clearBuiltPackets();
        }

        // --- CEA-608 path (only if no DTVCC data in stream) ---
        if (!this._has_dtvcc_data) {
            if (extracted.field1.length > 0) {
                this._cea608_parser1.addData(mediaTime, extracted.field1);
            }
            if (extracted.field2.length > 0) {
                this._cea608_parser2.addData(mediaTime, extracted.field2);
            }
        }
    }

    /**
     * Route cc_data triplets to CEA-608 fields and CEA-708 byte array.
     * Based on Shaka Player's CeaDecoder.extract().
     */
    private extractCcData(byteArray: Uint8Array, mediaTime: number): {
        field1: number[], field2: number[], cea708: Cea708Byte[]
    } {
        const field1: number[] = [];
        const field2: number[] = [];
        const cea708: Cea708Byte[] = [];
        if (!byteArray || byteArray.length < 2) {
            return { field1, field2, cea708 };
        }
        const count = byteArray[0] & 0x1f;
        let pos = 2; // skip cc_count byte + em_data
        for (let j = 0; j < count; j++) {
            if (pos + 3 > byteArray.length) break;
            const marker = byteArray[pos++];
            const ccData1 = byteArray[pos++];
            const ccData2 = byteArray[pos++];
            const ccValid = (marker & 0x04) !== 0;
            if (!ccValid) continue;
            const ccType = marker & 0x03;
            if (ccType === 0x00 || ccType === 0x01) {
                // CEA-608
                const b1 = ccData1 & 0x7f;
                const b2 = ccData2 & 0x7f;
                if (b1 === 0 && b2 === 0) continue;
                if (ccType === 0x00) field1.push(b1, b2);
                else field2.push(b1, b2);
            } else {
                // CEA-708 DTVCC: ccType 2 = packet data, 3 = packet start
                const type = (ccType === 3) ? DTVCC_PACKET_START : DTVCC_PACKET_DATA;
                cea708.push({
                    pts: mediaTime,
                    type: type,
                    value: ccData1,
                    order: this._cea708_order++,
                });
                // Second byte is always packet data
                cea708.push({
                    pts: mediaTime,
                    type: DTVCC_PACKET_DATA,
                    value: ccData2,
                    order: this._cea708_order++,
                });
            }
        }
        return { field1, field2, cea708 };
    }

    /** Add a CEA-708 caption to the DOM renderer */
    private addCea708Cue(caption: Cea708Caption): void {
        if (!this._renderer || !caption.text) return;
        this._renderer.addCue(caption.startTime, caption.endTime, caption.text);
    }

    enableCaptions(): void {
        if (this._renderer) { this._renderer.setVisible(true); }
    }

    disableCaptions(): void {
        if (this._renderer) { this._renderer.setVisible(false); }
    }

    reset(): void {
        if (this._cea608_parser1) { this._cea608_parser1.reset(); }
        if (this._cea608_parser2) { this._cea608_parser2.reset(); }
        if (this._renderer) { this._renderer.clear(); }
        this._dtvcc_builder.clear();
        this._cea708_services.clear();
        this._cea708_order = 0;
        this._has_dtvcc_data = false;
    }

    destroy(): void {
        this._cea608_parser1 = null;
        this._cea608_parser2 = null;
        this._dtvcc_builder = null;
        this._cea708_services = null;
        this._text_track = null;
        if (this._renderer) { this._renderer.destroy(); this._renderer = null; }
        this._media_element = null;
    }
}
