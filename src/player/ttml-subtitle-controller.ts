/**
 * TTMLSubtitleController
 *
 * Decodes DVB TTML subtitles (ETSI EN 303 560) and renders them as plain
 * centered text via the shared CaptionRenderer overlay.
 *
 * Unlike the CEA-608/708 live-display model, TTML cues carry explicit
 * begin/end times, so this controller maintains a timed cue list and drives
 * the overlay from the media element's currentTime.
 */
import Log from '../utils/logger';
import CaptionRenderer from './caption-renderer';
import { DVBTTMLData, DVBTTMLSegment } from '../demux/dvb-ttml-data';

interface TTMLCue {
    pid: number;
    start: number;  // media time, seconds
    end: number;    // media time, seconds
    text: string;
}

export default class TTMLSubtitleController {
    private TAG: string = 'TTMLSubtitleController';
    private _media_element: HTMLMediaElement;
    private _renderer: CaptionRenderer | null = null;
    // When the renderer is shared (managed by CaptionTrackManager), this
    // controller must not destroy it, and only writes while selected.
    private _owns_renderer: boolean = true;
    private _render_active: boolean = true;
    private _cues: TTMLCue[] = [];
    private _cue_keys: Set<string> = new Set();
    private _enabled: boolean = true;
    private _raf_handle: number | null = null;
    private _last_text: string = '';
    // A program may carry several TTML subtitle streams (languages). We display
    // one at a time: lock onto the first PID seen; switch via setActivePID().
    private _active_pid: number | null = null;
    private _langs: Map<number, string> = new Map();

    constructor(mediaElement: HTMLMediaElement, config: any, sharedRenderer?: CaptionRenderer) {
        this._media_element = mediaElement;
        this._enabled = config.showCaptions !== false;
        // Reuse the manager-owned overlay when shared so CEA and DVB TTML never
        // render two stacked overlays; the manager owns its lifecycle.
        if (sharedRenderer) {
            this._renderer = sharedRenderer;
            this._owns_renderer = false;
        } else {
            this._renderer = new CaptionRenderer(mediaElement);
            this._renderer.setVisible(this._enabled);
        }

        this._tick = this._tick.bind(this);
        this._raf_handle = requestAnimationFrame(this._tick);

        Log.v(this.TAG, 'TTMLSubtitleController initialized');
    }

    /** Called when DVB_TTML_SUBTITLE_ARRIVED fires (pts already rebased to ms). */
    onDVBTTMLData(ttml_data: DVBTTMLData): void {
        // Track available subtitle streams; lock display onto the first one seen.
        if (!this._langs.has(ttml_data.pid)) {
            this._langs.set(ttml_data.pid, ttml_data.lang);
        }
        if (this._active_pid == null) {
            this._active_pid = ttml_data.pid;
            Log.v(this.TAG, `Active TTML stream: PID ${ttml_data.pid} (${ttml_data.lang})`);
        }

        // At most one TTML document segment per PES packet (spec Table 18).
        const segment: DVBTTMLSegment | undefined = ttml_data.segments.find(
            (s) => s.type === 0x01 || s.type === 0x02
        );
        if (!segment) { return; }

        // Anchor TTML timeline onto the media timeline (spec §5.2.4.1):
        //   media_time(Tx) = pts_sec + (Tx - Ti),  Ti = segment_mediatime / 10000
        const pts_sec = ttml_data.pts != undefined ? ttml_data.pts / 1000 : 0;
        const ti = ttml_data.segment_mediatime / 10000;

        const decode = (bytes: Uint8Array): void => {
            let xml: string;
            try {
                xml = new TextDecoder('utf-8').decode(bytes);
            } catch (e) {
                Log.e(this.TAG, `Failed to decode TTML document: ${e}`);
                return;
            }
            this._ingestDocument(xml, ttml_data.pid, pts_sec, ti);
        };

        if (segment.type === 0x02) {
            // gzip-compressed TTML document
            this._gunzip(segment.data).then(decode).catch((e) => {
                Log.e(this.TAG, `gzip decompression failed: ${e}`);
            });
        } else {
            decode(segment.data);
        }
    }

    private async _gunzip(bytes: Uint8Array): Promise<Uint8Array> {
        if (typeof (self as any).DecompressionStream === 'undefined') {
            throw new Error('DecompressionStream not supported in this environment');
        }
        // Feed the gzip bytes through DecompressionStream and drain the output
        // with a plain reader. We deliberately avoid `new Response(stream)` —
        // in some browser contexts that routes through the fetch machinery and
        // throws "TypeError: Failed to fetch".
        const ds = new (self as any).DecompressionStream('gzip');
        // Copy into a standalone ArrayBuffer so a subarray view can't carry
        // extra bytes into the stream.
        const input = new Uint8Array(bytes.length);
        input.set(bytes);

        // DVB TTML gzip segments pad segment_length to a byte boundary, so the
        // gzip member is followed by trailing zero bytes. gzip allows
        // concatenated members, so DecompressionStream interprets that padding
        // as the start of a second member, fails its header check, and rejects
        // with "Junk found after end of compressed data". The full decompressed
        // output of the real member is enqueued *before* that error fires — but
        // erroring the stream clears any chunks still sitting in its queue. So
        // we must be draining the reader concurrently with the write/close, with
        // a read already pending when the output is enqueued, to capture it
        // before the trailing-junk error discards the queue.
        const reader = ds.readable.getReader();

        // Kick off write+close without awaiting; swallow the trailing-junk
        // rejection here so it surfaces only on the reader side.
        const writer = ds.writable.getWriter();
        void (async () => {
            try {
                await writer.write(input);
                await writer.close();
            } catch (_e) { /* trailing-junk error is handled via the reader */ }
        })();

        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            let value: Uint8Array | undefined;
            let done = false;
            try {
                ({ value, done } = await reader.read());
            } catch (e) {
                // We already drained the real member's output above; treat the
                // trailing-junk error as a successful end-of-member.
                if (total > 0) { break; }
                throw e;
            }
            if (done) { break; }
            if (value) { chunks.push(value); total += value.length; }
        }

        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }

    private _ingestDocument(xml: string, pid: number, pts_sec: number, ti: number): void {
        let doc: Document;
        try {
            doc = new DOMParser().parseFromString(xml, 'text/xml');
        } catch (e) {
            Log.e(this.TAG, `TTML XML parse error: ${e}`);
            return;
        }
        if (doc.getElementsByTagName('parsererror').length > 0) {
            Log.w(this.TAG, 'TTML XML parse error (malformed document)');
            return;
        }

        const paragraphs = this._collectElements(doc.documentElement, 'p');
        for (const p of paragraphs) {
            const begin = this._parseTime(p.getAttribute('begin'));
            const end = this._parseTime(p.getAttribute('end'));
            if (begin == null) { continue; }

            const text = this._extractText(p).trim();
            if (!text) { continue; }

            const start = pts_sec + (begin - ti);
            const stop = end != null ? pts_sec + (end - ti) : start + 5; // default 5s if no end

            const key = `${pid}|${start.toFixed(3)}|${stop.toFixed(3)}|${text}`;
            if (this._cue_keys.has(key)) { continue; }  // dedup across segment continuation
            this._cue_keys.add(key);
            this._cues.push({ pid, start, end: stop, text });
        }

        this._cues.sort((a, b) => a.start - b.start);
    }

    /** Recursively collect elements whose localName matches (namespace-agnostic). */
    private _collectElements(root: Element, localName: string): Element[] {
        const out: Element[] = [];
        const walk = (node: Element) => {
            if (node.localName === localName) { out.push(node); }
            for (let i = 0; i < node.children.length; i++) {
                walk(node.children[i]);
            }
        };
        if (root) { walk(root); }
        return out;
    }

    /** Extract text content of a <p>, mapping <br/> to newlines and collapsing whitespace. */
    private _extractText(p: Element): string {
        let result = '';
        const walk = (node: Node) => {
            for (let i = 0; i < node.childNodes.length; i++) {
                const child = node.childNodes[i];
                if (child.nodeType === 3 /* TEXT_NODE */) {
                    result += (child.textContent || '').replace(/\s+/g, ' ');
                } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
                    const el = child as Element;
                    if (el.localName === 'br') {
                        result += '\n';
                    } else {
                        walk(el);
                    }
                }
            }
        };
        walk(p);
        // Trim spaces around explicit line breaks
        return result.split('\n').map((l) => l.trim()).join('\n');
    }

    /**
     * Parse a TTML <timeExpression> into seconds.
     * Supports clock-time (HH:MM:SS(.fff)) and offset-time (Ns/Nms/Nm/Nh).
     * Frame-based forms (HH:MM:SS:FF, Nf, Nt) are not supported and return null.
     */
    private _parseTime(value: string | null): number | null {
        if (!value) { return null; }
        const v = value.trim();

        // offset-time: number followed by metric (h, m, s, ms)
        const offset = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(v);
        if (offset) {
            const n = parseFloat(offset[1]);
            switch (offset[2]) {
                case 'ms': return n / 1000;
                case 's': return n;
                case 'm': return n * 60;
                case 'h': return n * 3600;
            }
        }

        // clock-time: HH:MM:SS or HH:MM:SS.fff (reject frame form HH:MM:SS:FF)
        const clock = /^(\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v);
        if (clock) {
            return parseInt(clock[1], 10) * 3600 +
                   parseInt(clock[2], 10) * 60 +
                   parseFloat(clock[3]);
        }

        Log.w(this.TAG, `Unsupported TTML time expression: ${v}`);
        return null;
    }

    private _tick(): void {
        if (this._media_element && this._renderer && this._render_active) {
            const now = this._media_element.currentTime;

            let text = '';
            for (const cue of this._cues) {
                if (cue.pid === this._active_pid && cue.start <= now && now < cue.end) {
                    text = text ? text + '\n' + cue.text : cue.text;
                }
            }

            if (text !== this._last_text) {
                this._last_text = text;
                this._renderer.setText(text);
            }

            // Prune cues that ended well before now to bound memory. Rebuild the
            // dedup-key set from the survivors so it can't grow unbounded over a
            // long live session.
            if (this._cues.length > 256) {
                this._cues = this._cues.filter((c) => c.end >= now - 30);
                this._cue_keys.clear();
                for (const c of this._cues) {
                    this._cue_keys.add(`${c.pid}|${c.start.toFixed(3)}|${c.end.toFixed(3)}|${c.text}`);
                }
            }
        }
        this._raf_handle = requestAnimationFrame(this._tick);
    }

    /** List the available DVB TTML subtitle streams (one per PID/language). */
    getAvailableTracks(): { pid: number, lang: string }[] {
        const out: { pid: number, lang: string }[] = [];
        this._langs.forEach((lang, pid) => out.push({ pid, lang }));
        return out;
    }

    getActivePID(): number | null {
        return this._active_pid;
    }

    /** Switch the displayed subtitle stream to a specific PID. */
    setActivePID(pid: number): void {
        if (pid === this._active_pid) { return; }
        this._active_pid = pid;
        this._last_text = '';
        if (this._renderer && this._render_active) { this._renderer.clear(); }
        Log.v(this.TAG, `Switched active TTML stream to PID ${pid} (${this._langs.get(pid) || 'und'})`);
    }

    /**
     * Select/deselect this controller as the visible track. When inactive it
     * keeps ingesting cues but stops writing to the shared renderer. Used by
     * CaptionTrackManager.
     */
    setRenderingActive(active: boolean): void {
        this._render_active = active;
        // Force the next tick to re-emit current text on (re)activation.
        this._last_text = '';
    }

    enableCaptions(): void {
        this._enabled = true;
        if (this._renderer) { this._renderer.setVisible(true); }
    }

    disableCaptions(): void {
        this._enabled = false;
        if (this._renderer) { this._renderer.setVisible(false); }
    }

    reset(): void {
        this._cues = [];
        this._cue_keys.clear();
        this._last_text = '';
        this._active_pid = null;
        this._langs.clear();
        if (this._renderer) { this._renderer.clear(); }
    }

    destroy(): void {
        if (this._raf_handle != null) {
            cancelAnimationFrame(this._raf_handle);
            this._raf_handle = null;
        }
        this._cues = [];
        this._cue_keys.clear();
        // Only destroy the renderer if we own it; a shared renderer is owned by
        // CaptionTrackManager.
        if (this._renderer && this._owns_renderer) { this._renderer.destroy(); }
        this._renderer = null;
        this._media_element = null;
    }
}
