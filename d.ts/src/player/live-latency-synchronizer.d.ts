declare class LiveLatencySynchronizer {
    private _config;
    private _media_element;
    private e?;
    private _last_buffered_end;
    private _last_advance_time;
    private _append_gaps;
    private static readonly GAP_WINDOW;
    private static readonly TARGET_FACTOR;
    private static readonly MIN_MARGIN;
    private static readonly MIN_SAMPLES;
    constructor(config: any, media_element: HTMLMediaElement);
    destroy(): void;
    private _onMediaTimeUpdate;
    private _trackAppendCadence;
    private _getLatencyBand;
}
export default LiveLatencySynchronizer;
