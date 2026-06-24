/**
 * CaptionRenderer
 *
 * DOM-based caption renderer using a live display model (like VLC).
 * Instead of timed cues, it simply shows "what the current text is"
 * and updates it whenever the decoder state changes.
 *
 * Live ASR roll-up captions update frequently and grow word-by-word. To keep
 * the preview legible, three things are done here:
 *
 *   1. Repaint throttle: rapid setText() calls are coalesced (REPAINT_THROTTLE_MS)
 *      so the overlay never repaints faster than it can be read.
 *   2. In-place diff: line rows are reused and only their text/font-size is
 *      patched, instead of tearing down and rebuilding the block on every
 *      update — this removes the per-update flash.
 *   3. Scroll animation: when the window rolls up, the block slides up briefly
 *      so the roll-up reads as scrolling motion rather than an instant text swap.
 */
export default class CaptionRenderer {
    private _container;
    private _textElement;
    private _videoElement;
    /** Last text handed to setText() (pre-throttle) — used to skip no-op updates. */
    private _currentText;
    /** Last text actually painted to the DOM. */
    private _renderedText;
    /** Reusable per-line row elements (stable DOM across updates). */
    private _lineRows;
    /** Lines painted on the previous render — used to detect roll-up. */
    private _prevLines;
    private _onFullscreenChange;
    /** Coalesce decoder updates to at most one repaint per this interval. */
    private static readonly REPAINT_THROTTLE_MS;
    private _flushTimer;
    private _pendingText;
    /**
     * Duration of the upward roll-up slide. A short snap reads as an abrupt
     * jolt; a longer slide reads as a gentle scroll (the W3C roll-up guidance
     * recommends a CSS-transition scroll). This is preview-only — it never
     * touches the emitted CEA-608/708 bytes.
     */
    private static readonly SCROLL_ANIM_MS;
    constructor(videoElement: HTMLMediaElement);
    /**
     * Update the displayed text (live display model).
     *
     * Throttled: the call records the latest text and schedules a single
     * repaint at most once per REPAINT_THROTTLE_MS. This is a trailing
     * throttle — the freshest text is always the one that gets painted.
     */
    setText(text: string): void;
    setVisible(visible: boolean): void;
    clear(): void;
    destroy(): void;
    /**
     * Paint `text` to the DOM via an in-place diff: reuse existing line
     * rows, add/remove rows only when the line count changes, and patch
     * each row's text/font-size only when it actually differs. No full
     * teardown — this is what keeps the box from flashing on every update.
     */
    private _render;
    /**
     * Play an upward slide so a roll-up reads as gentle scrolling motion rather
     * than an instant text swap. Starts the block one row lower, then animates
     * it back to rest over SCROLL_ANIM_MS with an ease-out curve so it
     * decelerates into place instead of snapping.
     */
    private _animateScroll;
    /** Create a stable, centered line row holding one text box. */
    private _createRow;
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
