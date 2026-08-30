/**
 * CaptionController
 *
 * Handles both CEA-608 and CEA-708 (DTVCC) caption decoding.
 * Routes ccType 0/1 → CEA-608 parser, ccType 2/3 → CEA-708 DTVCC pipeline.
 *
 * CEA-708 port based on Shaka Player (Apache-2.0).
 *
 * Rendering is playhead-synced: decoding happens at demux time (the demuxer
 * runs ahead of playback by the forward buffer), but each decoded display
 * state is captured as a PTS-stamped snapshot and only painted once
 * currentTime reaches it. Painting on decode instead would make the caption
 * offset equal to the buffer cushion — tens of seconds after a tap-backlog
 * burst. Same pattern as TTMLSubtitleController's timed cue list.
 */
import Log from '../utils/logger';
import Cea608Parser from './cea608-parser';
import CaptionOutputFilter from './caption-output-filter';
import CaptionRenderer from './caption-renderer';
import { Cea708Byte, DtvccPacketBuilder, DTVCC_PACKET_DATA, DTVCC_PACKET_START } from './cea/dtvcc-packet';
import { Cea708Service } from './cea/cea708-service';

export default class CaptionController {
    private TAG: string = 'CaptionController';
    private _media_element: HTMLMediaElement;
    private _cea608_parser1: Cea608Parser;   // field 1 (CC1/CC2)
    private _cea608_parser2: Cea608Parser;   // field 2 (CC3/CC4)
    private _text_track: TextTrack | null = null;
    private _renderer: CaptionRenderer | null = null;
    // When the renderer is shared (managed by CaptionTrackManager), this
    // controller must not destroy it, and only writes to it while selected.
    private _owns_renderer: boolean = true;
    private _render_active: boolean = true;

    // CEA-708 DTVCC
    private _dtvcc_builder: DtvccPacketBuilder;
    private _cea708_services: Map<number, Cea708Service> = new Map();
    private _cea708_order = 0;
    /** DTVCC bytes awaiting their turn in presentation order (`_drainCea708`). */
    private _cea708_pending: Cea708Byte[] = [];
    /** Newest PTS seen on a DTVCC byte — the reorder window trails it. */
    private _cea708_newest_pts = 0;
    /**
     * How far the newest PTS must move past a byte before it is safe to decode.
     * Bounded by the stream's B-frame reorder depth: on 25fps content that is
     * two or three frames, so half a second is generous without being a
     * meaningful hold on a decoder already running ahead of the playhead.
     */
    private static readonly CEA708_REORDER_SEC = 0.5;
    private _has_dtvcc_data = false;

    // Playhead-synced display: decoded 708 display states, stamped with the
    // PTS (seconds, playback timeline) of the caption data that produced them.
    // A rAF ticker paints the latest snapshot whose pts <= currentTime.
    private _snapshots: { pts: number, text: string }[] = [];
    /** Hard bound on queued snapshots (background tabs pause rAF while the
     *  worker keeps demuxing; oldest states are stale on a live stream). */
    private static readonly SNAPSHOT_CAP = 512;
    /** Last text painted to the renderer — repaint only on change. */
    private _last_painted: string | null = null;
    /** How far ahead a completing packet may sit for a half-written row to be
     *  held back. Observed splits complete within 40–160 ms (1–4 frames at
     *  25fps); anything beyond this is treated as a state of its own. */
    private static readonly MID_WORD_HOLD_SEC = 0.4;
    private _raf_handle: number | null = null;


    constructor(
        mediaElement: HTMLMediaElement,
        config: any,
        sharedRenderer?: CaptionRenderer
    ) {
        this._media_element = mediaElement;

        // Create native TextTrack (hidden — used for CEA-608 fallback only)
        this._text_track = mediaElement.addTextTrack('captions', 'English', 'en');
        this._text_track.mode = 'hidden';  // always hidden — we use CaptionRenderer

        // DOM-based caption renderer (VLC-quality rendering). When a shared
        // renderer is supplied by CaptionTrackManager, reuse it so CEA and DVB
        // TTML never stack two overlays; the manager owns its lifecycle.
        if (sharedRenderer) {
            this._renderer = sharedRenderer;
            this._owns_renderer = false;
        } else {
            this._renderer = new CaptionRenderer(mediaElement);
            this._renderer.setVisible(config.showCaptions !== false);
        }

        // CEA-608: OutputFilter bridges parser → TextTrack (VTTCue)
        const filter1 = new CaptionOutputFilter(this._text_track);
        const filter2 = new CaptionOutputFilter(this._text_track);
        this._cea608_parser1 = new Cea608Parser(1, filter1, filter2);

        const filter3 = new CaptionOutputFilter(this._text_track);
        const filter4 = new CaptionOutputFilter(this._text_track);
        this._cea608_parser2 = new Cea608Parser(3, filter3, filter4);

        // CEA-708 DTVCC
        this._dtvcc_builder = new DtvccPacketBuilder();

        this._tick = this._tick.bind(this);
        this._raf_handle = requestAnimationFrame(this._tick);

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
                this._cea708_pending.push(byte);
                if (byte.pts > this._cea708_newest_pts) this._cea708_newest_pts = byte.pts;
            }
            this._drainCea708();
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
    private _drainCea708(): void {
        const cutoff = this._cea708_newest_pts - CaptionController.CEA708_REORDER_SEC;
        this._cea708_pending.sort((a, b) => (a.pts - b.pts) || (a.order - b.order));

        let ready = 0;
        while (ready < this._cea708_pending.length
               && this._cea708_pending[ready].pts <= cutoff) {
            ready++;
        }
        if (ready === 0) return;

        // Snapshot at each frame boundary rather than once at the end, so a
        // display state keeps the PTS of the bytes that produced it — _tick
        // schedules on that.
        const batch = this._cea708_pending.splice(0, ready);
        let framePts = batch[0].pts;
        for (const byte of batch) {
            if (byte.pts !== framePts) {
                this._consumeCea708Packets();
                this._checkNeedsDisplay(framePts);
                framePts = byte.pts;
            }
            this._dtvcc_builder.addByte(byte);
        }
        this._consumeCea708Packets();
        this._checkNeedsDisplay(framePts);
    }

    /** Decode whatever complete DTVCC packets the builder is holding. */
    private _consumeCea708Packets(): void {
        for (const pkt of this._dtvcc_builder.getBuiltPackets()) {
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
                            svc.handleCea708ControlCode(pkt);
                        }
                    }
                }
            } catch (e) {
                // Invalid packet — skip
            }
        }
        this._dtvcc_builder.clearBuiltPackets();
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

    /**
     * Capture a display-state snapshot when any service signals a refresh
     * (VLC-style batching). Runs even while this track is deselected, so the
     * snapshot queue stays current and re-selecting the CEA track can show
     * the right text for the current playhead immediately.
     */
    private _checkNeedsDisplay(pts_sec: number): void {
        let needsUpdate = false;
        const services = Array.from(this._cea708_services) as any[];
        for (let i = 0; i < services.length; i++) {
            const svc = services[i][1];
            if (svc.needsDisplay) {
                needsUpdate = true;
                svc.needsDisplay = false;
            }
        }
        if (!needsUpdate) return;

        const parts: string[] = [];
        for (let i = 0; i < services.length; i++) {
            const t = services[i][1].getDisplayText();
            if (t) parts.push(t);
        }
        const text = parts.join('\n');

        // Skip no-op states; an empty string is a real state (screen clear).
        const last = this._snapshots[this._snapshots.length - 1];
        if (last && last.text === text) return;

        this._snapshots.push({ pts: pts_sec, text });
        if (this._snapshots.length > CaptionController.SNAPSHOT_CAP) {
            this._snapshots.splice(0, this._snapshots.length - CaptionController.SNAPSHOT_CAP);
        }
    }

    /**
     * Paint the snapshot the playhead has reached: the latest one with
     * pts <= currentTime. States decoded ahead of playback (demux runs ahead
     * by the buffer cushion) are held back until their frame is on screen.
     * When no snapshot has been reached yet, the current display is kept
     * as-is rather than cleared.
     */
    private _tick(): void {
        if (this._media_element && this._renderer && this._render_active) {
            const now = this._media_element.currentTime;

            // _snapshots is in decode order; PTS can be mildly non-monotonic
            // around frame reordering, so scan the whole (capped) queue and
            // take the last reached state in decode order.
            let reached = -1;
            for (let i = 0; i < this._snapshots.length; i++) {
                if (this._snapshots[i].pts <= now) {
                    reached = i;
                }
            }

            if (reached >= 0) {
                // Drop superseded states; keep the displayed one at index 0 so
                // a deselect/reselect cycle can repaint it.
                if (reached > 0) this._snapshots.splice(0, reached);
                const state = this._snapshots[0];
                const next = this._snapshots[1];

                // A row arrives a DTVCC packet at a time, so it can be on the
                // wire half-written for a frame or two — "Pres" a moment before
                // "President". Painting that reads as dropped characters. Hold
                // the half-written state until the packet that completes the
                // word is reached; bounded by MID_WORD_HOLD_SEC so a genuinely
                // final state (nothing coming to complete it) still paints.
                const holdForCompletion = next !== undefined
                    && next.pts - state.pts <= CaptionController.MID_WORD_HOLD_SEC
                    && CaptionController._splitsWord(state.text, next.text);

                if (!holdForCompletion && state.text !== this._last_painted) {
                    this._last_painted = state.text;
                    this._renderer.setText(state.text);
                }
            }
        }
        this._raf_handle = requestAnimationFrame(this._tick);
    }

    /**
     * True when `pending` only carries `shown` further into the middle of a
     * word — i.e. `shown` is `pending` cut mid-token, not a caption state a
     * viewer should ever see.
     *
     * Deliberately strict: it requires a pure extension, so a roll-up (which
     * rewrites the earlier rows) or any text change fails the prefix test and
     * paints immediately.
     */
    private static _splitsWord(shown: string, pending: string): boolean {
        if (!shown || pending.length <= shown.length) return false;
        if (!pending.startsWith(shown)) return false;
        // A row that ends on a completed token is a legitimate state.
        if (/\s$/.test(shown)) return false;
        // …and the next character has to continue that same token.
        return !/\s/.test(pending.charAt(shown.length));
    }

    enableCaptions(): void {
        if (this._renderer) { this._renderer.setVisible(true); }
    }

    disableCaptions(): void {
        if (this._renderer) { this._renderer.setVisible(false); }
    }

    /**
     * Select/deselect this controller as the visible track. When inactive it
     * keeps decoding (so CEA state stays current) but stops writing to the
     * shared renderer. Used by CaptionTrackManager.
     */
    setRenderingActive(active: boolean): void {
        this._render_active = active;
        // Force the next tick to repaint the playhead's current snapshot
        // (the manager clears the shared renderer on every track switch).
        if (active) { this._last_painted = null; }
    }

    reset(): void {
        if (this._cea608_parser1) { this._cea608_parser1.reset(); }
        if (this._cea608_parser2) { this._cea608_parser2.reset(); }
        if (this._renderer) { this._renderer.clear(); }
        this._dtvcc_builder.clear();
        this._cea708_services.clear();
        this._cea708_order = 0;
        this._cea708_pending = [];
        this._cea708_newest_pts = 0;
        this._has_dtvcc_data = false;
        this._snapshots = [];
        this._last_painted = null;
    }

    destroy(): void {
        if (this._raf_handle != null) {
            cancelAnimationFrame(this._raf_handle);
            this._raf_handle = null;
        }
        this._snapshots = [];
        this._cea608_parser1 = null;
        this._cea608_parser2 = null;
        this._dtvcc_builder = null;
        this._cea708_services = null;
        this._text_track = null;
        // Only destroy the renderer if we own it; a shared renderer is owned by
        // CaptionTrackManager.
        if (this._renderer && this._owns_renderer) { this._renderer.destroy(); }
        this._renderer = null;
        this._media_element = null;
    }
}
