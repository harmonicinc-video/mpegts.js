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
 *   4. Grid-fit font: the height-derived font is shrunk (down to a readable
 *      floor) so a *full authored line* — the 37-display-column grid the
 *      pipeline shapes lines to — fits the caption box instead of being
 *      soft-wrapped. Fitting the fixed grid rather than the current text keeps
 *      the font size constant for a given player size: it never jumps between
 *      caption updates (fitting the live text made the size a function of
 *      content, so a wide CJK line visibly resized the block). A per-content
 *      fit remains as a safety net for over-wide legacy lines from pipelines
 *      that shaped CJK by character count; for grid-legal lines it is a no-op.
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
    /** Offscreen span used to measure a line's natural (unwrapped) width. */
    private _measureSpan;
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
    /**
     * Lower bound for the fit-to-width shrink. The height-derived size is
     * reduced only as far as this to make a wide line fit; if a line still
     * doesn't fit at this size (a very small preview) we let it wrap rather
     * than shrink to an illegible size.
     */
    private static readonly MIN_FIT_FONT_SIZE;
    /**
     * The authoring grid: captions are shaped to a 37-display-column budget
     * (TTML_LINE_WIDTH in the pipeline; a full-width CJK glyph counts 2
     * columns, so CJK rows carry ≤18 glyphs). The widest legal line therefore
     * renders no wider than 37 half-width monospace characters — this
     * reference string. Sizing the font so *this* fits the box (instead of
     * whatever text is currently showing) makes the size depend only on the
     * box, so it stays rock-steady across caption updates. Slightly
     * conservative for pure-CJK rows (a browser full-width glyph is a touch
     * narrower than two Consolas half-widths), which only leaves spare margin.
     */
    private static readonly GRID_REF_LINE;
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
     * The font size to paint at: the height-derived comfort size, shrunk so a
     * full 37-column authored line (GRID_REF_LINE) fits the caption box —
     * content-independent, so the size is stable for a given box size — then
     * passed through the per-content fit purely as a safety net for over-wide
     * legacy lines (a no-op for anything the pipeline shapes today).
     */
    private _computeFontSize;
    /**
     * The desired (reading-comfort) font size from the container height.
     * CEA-708 defines 15 rows; each row ~5.33% of height (like Shaka).
     * We use ~4.5% for comfortable reading. This is the size we'd use if
     * width weren't a constraint; `_fitFontSize` may shrink it to fit.
     */
    private _desiredFontSize;
    /**
     * Shrink `desired` until the widest line fits the caption box (the block's
     * 80% max-width) so authored lines aren't soft-wrapped onto a second row.
     * Returns `desired` unchanged when every line already fits.
     *
     * Callers pass the fixed grid reference line for the primary (stable)
     * sizing and the live text only as an overflow safety net — see
     * `_computeFontSize`.
     *
     * Line width scales ~linearly with font size (monospace glyph advance), so
     * we measure the widest line's natural width at `desired` and scale down by
     * the width ratio. The 0.98 margin absorbs the fixed horizontal padding
     * (which doesn't scale with the font) so the result fits with a hair to
     * spare. We never go below MIN_FIT_FONT_SIZE — past that, wrapping is
     * preferable to an illegible font.
     */
    private _fitFontSize;
}
