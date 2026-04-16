/**
 * CaptionRenderer
 *
 * DOM-based caption renderer using a live display model (like VLC).
 * Instead of timed cues, it simply shows "what the current text is"
 * and updates it whenever the decoder state changes.
 */
export default class CaptionRenderer {
    private _container;
    private _textElement;
    private _videoElement;
    private _currentText;
    private _onFullscreenChange;
    constructor(videoElement: HTMLMediaElement);
    /** Update the displayed text (live display model). */
    setText(text: string): void;
    setVisible(visible: boolean): void;
    clear(): void;
    destroy(): void;
    /**
     * Recalculate font size when entering/exiting fullscreen.
     * The consumer is responsible for fullscreening the video's parent
     * container (Shaka Player pattern) so the overlay stays visible.
     */
    private _handleFullscreenChange;
    /**
     * Compute font size based on video container height.
     * CEA-708 defines 15 rows; each row ~5.33% of height (like Shaka).
     * We use ~4.5% for comfortable reading.
     */
    private _computeFontSize;
}
