export default class CaptionController {
    private TAG;
    private _media_element;
    private _cea608_parser1;
    private _cea608_parser2;
    private _text_track;
    private _renderer;
    private _dtvcc_builder;
    private _cea708_services;
    private _cea708_order;
    private _has_dtvcc_data;
    constructor(mediaElement: HTMLMediaElement, config: any);
    /**
     * Called when CAPTION_DATA_ARRIVED fires.
     * @param pts_ms PTS in milliseconds (already rebased)
     * @param data   { ccData: Uint8Array, ccCount: number }
     */
    onCaptionData(pts_ms: number, data: {
        ccData: Uint8Array;
        ccCount: number;
    }): void;
    /**
     * Route cc_data triplets to CEA-608 fields and CEA-708 byte array.
     * Based on Shaka Player's CeaDecoder.extract().
     */
    private extractCcData;
    /** Add a CEA-708 caption to the DOM renderer */
    private addCea708Cue;
    enableCaptions(): void;
    disableCaptions(): void;
    reset(): void;
    destroy(): void;
}
