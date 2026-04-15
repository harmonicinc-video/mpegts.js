/**
 * CaptionRenderer
 *
 * DOM-based caption renderer inspired by Shaka Player's UITextDisplayer.
 * Creates a styled overlay on top of the video element instead of using
 * the browser's native VTTCue/TextTrack rendering.
 */
export default class CaptionRenderer {
    private _container;
    private _videoElement;
    private _cues;
    private _rafId;
    private _visible;
    constructor(videoElement: HTMLMediaElement);
    /** Add a caption cue to the renderer */
    addCue(startTime: number, endTime: number, text: string): void;
    /** Set visibility */
    setVisible(visible: boolean): void;
    /** Clear all cues */
    clear(): void;
    /** Destroy the renderer */
    destroy(): void;
    private _startLoop;
    private _tick;
    private _updateCues;
    private _createCueElement;
}
