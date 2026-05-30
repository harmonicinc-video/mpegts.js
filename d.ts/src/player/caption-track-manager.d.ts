import { DVBTTMLData } from '../demux/dvb-ttml-data';
export interface CaptionTrack {
    id: string;
    type: 'cea' | 'ttml';
    label: string;
    lang?: string;
    pid?: number;
}
export default class CaptionTrackManager {
    private TAG;
    private _renderer;
    private _caption_controller;
    private _ttml_controller;
    private _cea_seen;
    private _ttml_tracks;
    private _active;
    private _enabled;
    constructor(mediaElement: HTMLMediaElement, config: any);
    onCaptionData(pts_ms: number, data: {
        ccData: Uint8Array;
        ccCount: number;
    }): void;
    onDVBTTMLData(ttml_data: DVBTTMLData): void;
    /** First source to produce data wins, until the consumer chooses explicitly. */
    private _autoSelect;
    getTracks(): CaptionTrack[];
    /** Active track id, or 'off'. Returns null only before the first data arrives. */
    getActiveTrack(): string | null;
    /** Select a track by id ('cea' | 'ttml:<pid>'), or 'off'/null to render nothing. */
    setActiveTrack(id: string | null): void;
    enableCaptions(): void;
    disableCaptions(): void;
    reset(): void;
    destroy(): void;
}
