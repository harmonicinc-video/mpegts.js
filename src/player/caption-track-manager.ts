/**
 * CaptionTrackManager
 *
 * Unifies CEA-608/708 captions and DVB TTML subtitles into a single track
 * selection backed by one shared overlay (CaptionRenderer). Both decoders keep
 * running, but only the selected track writes to the overlay — so the two never
 * stack on screen.
 *
 * Track ids:
 *   'cea:<n>'     one CEA-708 service (one language, ADR 0023); `cea` alone
 *                 means service 1, for callers that predate multi-language CEA
 *   'ttml:<pid>'  one DVB TTML subtitle stream (per PID / language)
 *   'off'         nothing rendered
 *
 * Default behavior mirrors the old per-controller "lock onto first stream":
 * the first source to produce data is auto-selected, until the consumer makes
 * an explicit choice via setActiveTrack().
 */
import Log from '../utils/logger';
import CaptionRenderer from './caption-renderer';
import CaptionController from './caption-controller';
import TTMLSubtitleController from './ttml-subtitle-controller';
import { DVBTTMLData } from '../demux/dvb-ttml-data';

export interface CaptionTrack {
    id: string;                     // 'cea:<service>' | 'ttml:<pid>'
    type: 'cea' | 'ttml';
    label: string;                  // human-readable, e.g. 'DVB TTML (deu)'
    lang?: string;                  // ISO-639 language (TTML only)
    pid?: number;                   // elementary PID (TTML only)
    service?: number;               // CEA-708 service number (CEA only)
}

/** The 608 channel that carries the same language as a 708 service (ADR 0023). */
const CEA_CHANNEL_OF_SERVICE: { [service: number]: string } = { 1: 'CC1', 2: 'CC3', 3: 'CC2', 4: 'CC4' };

export default class CaptionTrackManager {
    private TAG: string = 'CaptionTrackManager';
    private _renderer: CaptionRenderer | null = null;
    private _caption_controller: CaptionController | null = null;
    private _ttml_controller: TTMLSubtitleController | null = null;

    private _cea_seen: boolean = false;
    private _ttml_tracks: { pid: number, lang: string }[] = [];

    // Active track id: 'cea' | 'ttml:<pid>' | 'off'. null means "not yet locked"
    // — the first source to produce data is auto-selected while in this state.
    private _active: string | null = null;
    private _enabled: boolean = true;

    constructor(mediaElement: HTMLMediaElement, config: any) {
        this._enabled = config.showCaptions !== false;

        // One overlay, shared by both controllers.
        this._renderer = new CaptionRenderer(mediaElement);
        this._renderer.setVisible(this._enabled);

        this._caption_controller = new CaptionController(mediaElement, config, this._renderer);
        this._ttml_controller = new TTMLSubtitleController(mediaElement, config, this._renderer);

        // Nothing selected yet → both controllers idle (don't write to overlay).
        this._caption_controller.setRenderingActive(false);
        this._ttml_controller.setRenderingActive(false);

        Log.v(this.TAG, 'CaptionTrackManager initialized');
    }

    // --- data ingress (from the player engine event handlers) ---

    onCaptionData(pts_ms: number, data: { ccData: Uint8Array, ccCount: number }): void {
        if (!this._caption_controller) { return; }
        this._caption_controller.onCaptionData(pts_ms, data);
        if (!this._cea_seen) {
            this._cea_seen = true;
            Log.v(this.TAG, 'CEA-608/708 caption track discovered');
            this._autoSelect('cea:1');
        }
    }

    onDVBTTMLData(ttml_data: DVBTTMLData): void {
        if (!this._ttml_controller) { return; }
        this._ttml_controller.onDVBTTMLData(ttml_data);
        if (!this._ttml_tracks.some((t) => t.pid === ttml_data.pid)) {
            this._ttml_tracks.push({ pid: ttml_data.pid, lang: ttml_data.lang });
            Log.v(this.TAG, `DVB TTML track discovered: PID ${ttml_data.pid} (${ttml_data.lang})`);
        }
        this._autoSelect(`ttml:${ttml_data.pid}`);
    }

    /** First source to produce data wins, until the consumer chooses explicitly. */
    private _autoSelect(id: string): void {
        if (this._active == null) {
            this.setActiveTrack(id);
        }
    }

    // --- track selection ---

    getTracks(): CaptionTrack[] {
        const out: CaptionTrack[] = [];
        if (this._cea_seen) {
            const services = this._caption_controller?.getServices() ?? [];
            // 608-only streams (no DTVCC) still show as one CEA track.
            for (const service of services.length > 0 ? services : [1]) {
                const channel = CEA_CHANNEL_OF_SERVICE[service];
                out.push({
                    id: `cea:${service}`,
                    type: 'cea',
                    label: services.length > 1
                        ? `CEA-608/708 ${channel ? channel + ' / ' : ''}service ${service}`
                        : 'CEA-608/708',
                    service,
                });
            }
        }
        for (const t of this._ttml_tracks) {
            out.push({
                id: `ttml:${t.pid}`,
                type: 'ttml',
                label: `DVB TTML (${t.lang})`,
                lang: t.lang,
                pid: t.pid,
            });
        }
        return out;
    }

    /** Active track id, or 'off'. Returns null only before the first data arrives. */
    getActiveTrack(): string | null {
        return this._active;
    }

    /** Select a track by id ('cea' | 'ttml:<pid>'), or 'off'/null to render nothing. */
    setActiveTrack(id: string | null): void {
        let next = id == null ? 'off' : id;
        if (next === 'cea') next = 'cea:1';
        this._active = next;

        const ceaActive = next.indexOf('cea:') === 0;
        const ttmlActive = next.indexOf('ttml:') === 0;

        if (this._caption_controller) {
            if (ceaActive) {
                this._caption_controller.setSelectedService(
                    parseInt(next.substring('cea:'.length), 10) || 1,
                );
            }
            this._caption_controller.setRenderingActive(ceaActive);
        }
        if (this._ttml_controller) {
            if (ttmlActive) {
                const pid = parseInt(next.substring('ttml:'.length), 10);
                this._ttml_controller.setActivePID(pid);
            }
            this._ttml_controller.setRenderingActive(ttmlActive);
        }

        // Clear the shared overlay on every switch so stale text from the
        // previously-active track never lingers.
        if (this._renderer) { this._renderer.clear(); }

        Log.v(this.TAG, `Active caption track: ${next}`);
    }

    // --- global show/hide (independent of which track is selected) ---

    enableCaptions(): void {
        this._enabled = true;
        if (this._renderer) { this._renderer.setVisible(true); }
    }

    disableCaptions(): void {
        this._enabled = false;
        if (this._renderer) { this._renderer.setVisible(false); }
    }

    reset(): void {
        this._caption_controller?.reset();
        this._ttml_controller?.reset();
        this._cea_seen = false;
        this._ttml_tracks = [];
        this._active = null;
        if (this._renderer) { this._renderer.clear(); }
    }

    destroy(): void {
        // Controllers must not destroy the shared renderer (they were given it),
        // so we tear it down here after them.
        this._caption_controller?.destroy();
        this._caption_controller = null;
        this._ttml_controller?.destroy();
        this._ttml_controller = null;
        if (this._renderer) { this._renderer.destroy(); this._renderer = null; }
    }
}
