import CaptionRenderer from './caption-renderer';
export default class CaptionController {
    private TAG;
    private _media_element;
    private _cea608_parser1;
    private _cea608_parser2;
    private _text_track;
    private _renderer;
    private _owns_renderer;
    private _render_active;
    private _dtvcc_builder;
    private _cea708_services;
    private _cea708_order;
    private _has_dtvcc_data;
    constructor(mediaElement: HTMLMediaElement, config: any, sharedRenderer?: CaptionRenderer);
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
    /** Check if any service needs a display refresh (VLC-style batching). */
    private _checkNeedsDisplay;
    enableCaptions(): void;
    disableCaptions(): void;
    /**
     * Select/deselect this controller as the visible track. When inactive it
     * keeps decoding (so CEA state stays current) but stops writing to the
     * shared renderer. Used by CaptionTrackManager.
     */
    setRenderingActive(active: boolean): void;
    reset(): void;
    destroy(): void;
}
