import CaptionRenderer from './caption-renderer';
import { DVBTTMLData } from '../demux/dvb-ttml-data';
export default class TTMLSubtitleController {
    private TAG;
    private _media_element;
    private _renderer;
    private _owns_renderer;
    private _render_active;
    private _cues;
    private _cue_keys;
    private _enabled;
    private _raf_handle;
    private _last_text;
    private _active_pid;
    private _langs;
    constructor(mediaElement: HTMLMediaElement, config: any, sharedRenderer?: CaptionRenderer);
    /** Called when DVB_TTML_SUBTITLE_ARRIVED fires (pts already rebased to ms). */
    onDVBTTMLData(ttml_data: DVBTTMLData): void;
    private _gunzip;
    private _ingestDocument;
    /** Recursively collect elements whose localName matches (namespace-agnostic). */
    private _collectElements;
    /** Extract text content of a <p>, mapping <br/> to newlines and collapsing whitespace. */
    private _extractText;
    /**
     * Parse a TTML <timeExpression> into seconds.
     * Supports clock-time (HH:MM:SS(.fff)) and offset-time (Ns/Nms/Nm/Nh).
     * Frame-based forms (HH:MM:SS:FF, Nf, Nt) are not supported and return null.
     */
    private _parseTime;
    private _tick;
    /** List the available DVB TTML subtitle streams (one per PID/language). */
    getAvailableTracks(): {
        pid: number;
        lang: string;
    }[];
    getActivePID(): number | null;
    /** Switch the displayed subtitle stream to a specific PID. */
    setActivePID(pid: number): void;
    /**
     * Select/deselect this controller as the visible track. When inactive it
     * keeps ingesting cues but stops writing to the shared renderer. Used by
     * CaptionTrackManager.
     */
    setRenderingActive(active: boolean): void;
    enableCaptions(): void;
    disableCaptions(): void;
    reset(): void;
    destroy(): void;
}
