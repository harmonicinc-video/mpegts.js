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
    private _snapshots;
    /** Hard bound on queued snapshots (background tabs pause rAF while the
     *  worker keeps demuxing; oldest states are stale on a live stream). */
    private static readonly SNAPSHOT_CAP;
    /** Last text painted to the renderer — repaint only on change. */
    private _last_painted;
    private _raf_handle;
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
    /**
     * Capture a display-state snapshot when any service signals a refresh
     * (VLC-style batching). Runs even while this track is deselected, so the
     * snapshot queue stays current and re-selecting the CEA track can show
     * the right text for the current playhead immediately.
     */
    private _checkNeedsDisplay;
    /**
     * Paint the snapshot the playhead has reached: the latest one with
     * pts <= currentTime. States decoded ahead of playback (demux runs ahead
     * by the buffer cushion) are held back until their frame is on screen.
     * When no snapshot has been reached yet, the current display is kept
     * as-is rather than cleared.
     */
    private _tick;
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
