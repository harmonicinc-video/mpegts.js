export default class CaptionController {
    private TAG;
    private _media_element;
    private _cea608_parser1;
    private _cea608_parser2;
    private _text_track;
    private _debugCount;
    constructor(mediaElement: HTMLMediaElement, config: any);
    /**
     * Called when CAPTION_DATA_ARRIVED fires.
     * @param pts_ms PTS in milliseconds (original, not rebased)
     * @param data   { ccData: Uint8Array, ccCount: number }
     */
    onCaptionData(pts_ms: number, data: {
        ccData: Uint8Array;
        ccCount: number;
    }): void;
    /**
     * Ported from hls.js timeline-controller.ts.
     * Splits cc_data triplets into field1/field2 byte pairs.
     */
    private extractCea608Data;
    enableCaptions(): void;
    disableCaptions(): void;
    reset(): void;
    destroy(): void;
}
