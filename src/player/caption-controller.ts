/**
 * CaptionController
 *
 * Self-contained CEA-608 caption handling inside mpegts.js.
 * Orchestrates: PTS rebase → field separation → Cea608Parser → TextTrack
 */
import Log from '../utils/logger';
import Cea608Parser from './cea608-parser';
import CaptionOutputFilter from './caption-output-filter';

export default class CaptionController {
    private TAG: string = 'CaptionController';
    private _media_element: HTMLMediaElement;
    private _cea608_parser1: Cea608Parser;   // field 1 (CC1/CC2)
    private _cea608_parser2: Cea608Parser;   // field 2 (CC3/CC4)
    private _text_track: TextTrack | null = null;
    private _debugCount: number = 0;


    constructor(
        mediaElement: HTMLMediaElement,
        config: any
    ) {
        this._media_element = mediaElement;


        // Create native TextTrack — browser handles rendering
        this._text_track = mediaElement.addTextTrack('captions', 'English', 'en');
        this._text_track.mode = config.showCaptions ? 'showing' : 'hidden';

        // OutputFilter bridges parser → TextTrack (VTTCue)
        const filter1 = new CaptionOutputFilter(this._text_track);
        const filter2 = new CaptionOutputFilter(this._text_track);
        this._cea608_parser1 = new Cea608Parser(1, filter1, filter2);

        // Field 2 for CC3/CC4 (rare, but supported)
        const filter3 = new CaptionOutputFilter(this._text_track);
        const filter4 = new CaptionOutputFilter(this._text_track);
        this._cea608_parser2 = new Cea608Parser(3, filter3, filter4);

        Log.v(this.TAG, 'CaptionController initialized');
    }

    /**
     * Called when CAPTION_DATA_ARRIVED fires.
     * @param pts_ms PTS in milliseconds (original, not rebased)
     * @param data   { ccData: Uint8Array, ccCount: number }
     */
    onCaptionData(pts_ms: number, data: { ccData: Uint8Array, ccCount: number }): void {
        // PTS is already rebased by transmuxing-controller (raw PTS - dtsBase)
        const mediaTime = pts_ms / 1000;

        // DEBUG: dump first 10 cc_data arrays
        if (!this._debugCount) { this._debugCount = 0; }
        if (this._debugCount < 10) {
            const hex = Array.from(data.ccData).map(b => '0x' + b.toString(16).padStart(2, '0')).join(',');
            Log.v(this.TAG, `CC_DEBUG #${this._debugCount} pts=${pts_ms.toFixed(0)}ms ccCount=${data.ccCount} len=${data.ccData.length} bytes=[${hex}]`);
            this._debugCount++;
        }

        // Split cc_data triplets into field1/field2 byte pairs
        const fields = this.extractCea608Data(data.ccData);
        if (fields[0].length > 0) {
            this._cea608_parser1.addData(mediaTime, fields[0]);
        }
        if (fields[1].length > 0) {
            this._cea608_parser2.addData(mediaTime, fields[1]);
        }
    }

    /**
     * Ported from hls.js timeline-controller.ts.
     * Splits cc_data triplets into field1/field2 byte pairs.
     */
    private extractCea608Data(byteArray: Uint8Array): number[][] {
        const ccBytes: number[][] = [[], []];
        if (!byteArray || byteArray.length < 2) {
            return ccBytes;
        }
        const count = byteArray[0] & 0x1f;
        let pos = 2;
        for (let j = 0; j < count; j++) {
            if (pos + 3 > byteArray.length) { break; }
            const tmpByte = byteArray[pos++];
            const ccbyte1 = 0x7f & byteArray[pos++];
            const ccbyte2 = 0x7f & byteArray[pos++];
            if (ccbyte1 === 0 && ccbyte2 === 0) { continue; }
            const ccValid = (0x04 & tmpByte) !== 0;
            if (ccValid) {
                const ccType = 0x03 & tmpByte;
                if (ccType === 0x00 || ccType === 0x01) {
                    ccBytes[ccType].push(ccbyte1, ccbyte2);
                }
            }
        }
        return ccBytes;
    }

    enableCaptions(): void {
        if (this._text_track) { this._text_track.mode = 'showing'; }
    }

    disableCaptions(): void {
        if (this._text_track) { this._text_track.mode = 'hidden'; }
    }

    reset(): void {
        if (this._cea608_parser1) { this._cea608_parser1.reset(); }
        if (this._cea608_parser2) { this._cea608_parser2.reset(); }
    }

    destroy(): void {
        this._cea608_parser1 = null;
        this._cea608_parser2 = null;
        this._text_track = null;
        this._media_element = null;
    }
}
