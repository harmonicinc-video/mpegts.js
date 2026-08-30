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
    /** DTVCC bytes awaiting their turn in presentation order (`_drainCea708`). */
    private _cea708_pending;
    /** Newest PTS seen on a DTVCC byte — the reorder window trails it. */
    private _cea708_newest_pts;
    /**
     * How far the newest PTS must move past a byte before it is safe to decode.
     * Bounded by the stream's B-frame reorder depth: on 25fps content that is
     * two or three frames, so half a second is generous without being a
     * meaningful hold on a decoder already running ahead of the playhead.
     */
    private static readonly CEA708_REORDER_SEC;
    private _has_dtvcc_data;
    private _snapshots;
    /** Hard bound on queued snapshots (background tabs pause rAF while the
     *  worker keeps demuxing; oldest states are stale on a live stream). */
    private static readonly SNAPSHOT_CAP;
    /** Last text painted to the renderer — repaint only on change. */
    private _last_painted;
    /** How far ahead a completing packet may sit for a half-written row to be
     *  held back. Observed splits complete within 40–160 ms (1–4 frames at
     *  25fps); anything beyond this is treated as a state of its own. */
    private static readonly MID_WORD_HOLD_SEC;
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
     * Feed buffered DTVCC bytes to the packet builder in presentation order.
     *
     * SEI cc_data arrives in *decode* order, so with B-frames a byte pair can
     * reach us before a pair that precedes it on the timeline. A DTVCC packet
     * is a run of pairs headed by one that declares its length, and
     * `DtvccPacketBuilder` discards a packet the moment a new start arrives —
     * so a single displaced pair silently destroys a whole packet's characters.
     * The row then closes up around the hole ("to the Middle East" rendering as
     * "to t East"), because the window's unwritten cells contribute nothing.
     * Measured on a live capture: 9 of 370 packets destroyed this way.
     *
     * Sorting on `(pts, order)` — presentation time, ties broken by arrival —
     * is what Shaka's CeaDecoder.decode() does before building packets, and it
     * is why `Cea708Byte` has carried an `order` field all along. With the sort
     * in place, all 370 of those packets assemble intact.
     *
     * Bytes are held until the newest PTS seen has moved a full
     * [`CEA708_REORDER_SEC`] past them, which is what makes it safe to assume
     * nothing earlier is still coming. The wait costs no visible latency: the
     * demuxer runs ahead of the playhead by the buffer cushion, and `_tick`
     * paints on PTS regardless.
     */
    private _drainCea708;
    /** Decode whatever complete DTVCC packets the builder is holding. */
    private _consumeCea708Packets;
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
    /**
     * True when `pending` only carries `shown` further into the middle of a
     * word — i.e. `shown` is `pending` cut mid-token, not a caption state a
     * viewer should ever see.
     *
     * Deliberately strict: it requires a pure extension, so a roll-up (which
     * rewrites the earlier rows) or any text change fails the prefix test and
     * paints immediately.
     */
    private static _splitsWord;
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
