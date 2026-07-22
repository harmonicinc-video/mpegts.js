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
    private _container: HTMLDivElement;
    private _textElement: HTMLDivElement;
    private _videoElement: HTMLMediaElement;
    /** Last text handed to setText() (pre-throttle) — used to skip no-op updates. */
    private _currentText: string = '';
    /** Last text actually painted to the DOM. */
    private _renderedText: string | null = null;
    /** Reusable per-line row elements (stable DOM across updates). */
    private _lineRows: HTMLDivElement[] = [];
    /** Lines painted on the previous render — used to detect roll-up. */
    private _prevLines: string[] = [];
    /** Offscreen span used to measure a line's natural (unwrapped) width. */
    private _measureSpan: HTMLSpanElement;
    private _onFullscreenChange: (() => void) | null = null;

    // ── Repaint throttle ──────────────────────────────────────────────
    /** Coalesce decoder updates to at most one repaint per this interval. */
    private static readonly REPAINT_THROTTLE_MS = 180;
    private _flushTimer: ReturnType<typeof setTimeout> | null = null;
    private _pendingText: string | null = null;

    // ── Roll-up scroll animation ──────────────────────────────────────
    /**
     * Duration of the upward roll-up slide. A short snap reads as an abrupt
     * jolt; a longer slide reads as a gentle scroll (the W3C roll-up guidance
     * recommends a CSS-transition scroll). This is preview-only — it never
     * touches the emitted CEA-608/708 bytes.
     */
    private static readonly SCROLL_ANIM_MS = 300;

    // ── Fit-to-width ──────────────────────────────────────────────────
    /**
     * Lower bound for the fit-to-width shrink. The height-derived size is
     * reduced only as far as this to make a wide line fit; if a line still
     * doesn't fit at this size (a very small preview) we let it wrap rather
     * than shrink to an illegible size.
     */
    private static readonly MIN_FIT_FONT_SIZE = 12;

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
    private static readonly GRID_REF_LINE = '0'.repeat(37);

    constructor(videoElement: HTMLMediaElement) {
        this._videoElement = videoElement;
        // Create overlay container positioned over the video
        this._container = document.createElement('div');
        this._container.className = 'mpegts-caption-container';
        Object.assign(this._container.style, {
            position: 'absolute',
            left: '0', right: '0', bottom: '0', top: '0',
            pointerEvents: 'none',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: '8%',  // above typical lower-thirds
            zIndex: '2147483647',
        });

        // The caption block: a bottom-anchored, centered column of line rows.
        // Pinning the block at flex-end means new lines extend it upward while
        // its bottom edge stays fixed — natural roll-up behavior with no
        // vertical jump.
        this._textElement = document.createElement('div');
        Object.assign(this._textElement.style, {
            maxWidth: '80%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            willChange: 'transform',
        });
        this._container.appendChild(this._textElement);

        // Offscreen, non-wrapping span with the same typography as a line row,
        // used to measure a line's natural single-line width for fit-to-width.
        // It never affects layout (absolute + hidden) and never wraps (nowrap),
        // so offsetWidth reports the width the line *wants* before any wrap.
        this._measureSpan = document.createElement('span');
        Object.assign(this._measureSpan.style, {
            position: 'absolute',
            left: '-99999px',
            top: '0',
            visibility: 'hidden',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontFamily: 'Consolas, "Courier New", Courier, monospace',
            fontWeight: '500',
            letterSpacing: '0.03em',
            padding: '3px 10px',
        });
        this._container.appendChild(this._measureSpan);

        // Insert into the video's parent (consumer should fullscreen this parent)
        const parent = videoElement.parentElement;
        if (parent) {
            const pos = getComputedStyle(parent).position;
            if (pos === 'static') parent.style.position = 'relative';
            parent.appendChild(this._container);
        }

        // Recalculate font size when entering/exiting fullscreen
        this._onFullscreenChange = this._handleFullscreenChange.bind(this);
        document.addEventListener('fullscreenchange', this._onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this._onFullscreenChange);
    }

    /**
     * Update the displayed text (live display model).
     *
     * Throttled: the call records the latest text and schedules a single
     * repaint at most once per REPAINT_THROTTLE_MS. This is a trailing
     * throttle — the freshest text is always the one that gets painted.
     */
    setText(text: string): void {
        if (text === this._currentText) return;
        this._currentText = text;
        this._pendingText = text;

        // A repaint is already scheduled — it will pick up _pendingText.
        if (this._flushTimer !== null) return;

        this._flushTimer = setTimeout(() => {
            this._flushTimer = null;
            const pending = this._pendingText;
            this._pendingText = null;
            if (pending !== null) this._render(pending);
        }, CaptionRenderer.REPAINT_THROTTLE_MS);
    }

    setVisible(visible: boolean): void {
        this._container.style.display = visible ? 'flex' : 'none';
    }

    clear(): void {
        if (this._flushTimer !== null) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._pendingText = null;
        this._currentText = '';
        this._renderedText = '';
        this._prevLines = [];
        this._textElement.style.transition = '';
        this._textElement.style.transform = '';
        for (const row of this._lineRows) {
            if (row.parentNode) row.parentNode.removeChild(row);
        }
        this._lineRows = [];
    }

    destroy(): void {
        if (this._flushTimer !== null) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        if (this._onFullscreenChange) {
            document.removeEventListener('fullscreenchange', this._onFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', this._onFullscreenChange);
            this._onFullscreenChange = null;
        }
        if (this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._videoElement = null;
    }

    /**
     * Paint `text` to the DOM via an in-place diff: reuse existing line
     * rows, add/remove rows only when the line count changes, and patch
     * each row's text/font-size only when it actually differs. No full
     * teardown — this is what keeps the box from flashing on every update.
     */
    private _render(text: string): void {
        if (text === this._renderedText) return;
        this._renderedText = text;

        const lines = text ? text.split('\n') : [];
        const fontSize = this._computeFontSize(lines) + 'px';

        // Roll-up detection: the top line changed to a line we were previously
        // showing *below* it (index > 0). That is a scroll, not bottom-line
        // growth — only then do we play the slide animation.
        const rolledUp = this._prevLines.length > 0 && lines.length > 0
            && lines[0] !== this._prevLines[0]
            && this._prevLines.indexOf(lines[0]) > 0;

        // Grow/shrink the row pool to match the current line count.
        while (this._lineRows.length < lines.length) {
            const row = this._createRow();
            this._lineRows.push(row);
            this._textElement.appendChild(row);
        }
        while (this._lineRows.length > lines.length) {
            const row = this._lineRows.pop();
            if (row && row.parentNode) row.parentNode.removeChild(row);
        }

        // Patch text + font size in place (only when changed).
        for (let i = 0; i < lines.length; i++) {
            const span = this._lineRows[i].firstElementChild as HTMLElement;
            if (span.textContent !== lines[i]) span.textContent = lines[i];
            if (span.style.fontSize !== fontSize) span.style.fontSize = fontSize;
        }

        this._prevLines = lines;
        if (rolledUp) this._animateScroll();
    }

    /**
     * Play an upward slide so a roll-up reads as gentle scrolling motion rather
     * than an instant text swap. Starts the block one row lower, then animates
     * it back to rest over SCROLL_ANIM_MS with an ease-out curve so it
     * decelerates into place instead of snapping.
     */
    private _animateScroll(): void {
        const h = this._lineRows[0] ? this._lineRows[0].offsetHeight : 0;
        if (h <= 0) return;
        const el = this._textElement;
        el.style.transition = 'none';
        el.style.transform = `translateY(${h}px)`;
        // Force reflow so the starting transform commits before we animate.
        void el.offsetHeight;
        el.style.transition = `transform ${CaptionRenderer.SCROLL_ANIM_MS}ms ease-out`;
        el.style.transform = 'translateY(0)';
    }

    /** Create a stable, centered line row holding one text box. */
    private _createRow(): HTMLDivElement {
        const row = document.createElement('div');
        row.style.textAlign = 'center';

        const span = document.createElement('span');
        Object.assign(span.style, {
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            color: '#FFFFFF',
            fontFamily: 'Consolas, "Courier New", Courier, monospace',
            fontSize: this._desiredFontSize() + 'px',
            fontWeight: '500',
            padding: '3px 10px',
            lineHeight: '1.5',
            letterSpacing: '0.03em',
            whiteSpace: 'pre-wrap',
            textShadow: '1px 1px 3px rgba(0,0,0,1)',
            borderRadius: '3px',
            display: 'inline-block',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
        });
        row.appendChild(span);
        return row;
    }

    /**
     * Recalculate font size when entering/exiting fullscreen.
     * The consumer is responsible for fullscreening the video's parent
     * container (Shaka Player pattern) so the overlay stays visible.
     */
    private _handleFullscreenChange(): void {
        const fontSize = this._computeFontSize(this._prevLines) + 'px';
        for (const row of this._lineRows) {
            const span = row.firstElementChild as HTMLElement | null;
            if (span) span.style.fontSize = fontSize;
        }
    }

    /**
     * The font size to paint at: the height-derived comfort size, shrunk so a
     * full 37-column authored line (GRID_REF_LINE) fits the caption box —
     * content-independent, so the size is stable for a given box size — then
     * passed through the per-content fit purely as a safety net for over-wide
     * legacy lines (a no-op for anything the pipeline shapes today).
     */
    private _computeFontSize(lines: string[]): number {
        const gridFit = this._fitFontSize([CaptionRenderer.GRID_REF_LINE], this._desiredFontSize());
        return this._fitFontSize(lines, gridFit);
    }

    /**
     * The desired (reading-comfort) font size from the container height.
     * CEA-708 defines 15 rows; each row ~5.33% of height (like Shaka).
     * We use ~4.5% for comfortable reading. This is the size we'd use if
     * width weren't a constraint; `_fitFontSize` may shrink it to fit.
     */
    private _desiredFontSize(): number {
        const containerHeight = this._videoElement?.parentElement?.clientHeight
            || this._videoElement?.clientHeight || 480;
        const size = Math.round(containerHeight * 0.045);
        return Math.max(18, Math.min(size, 42));
    }

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
    private _fitFontSize(lines: string[], desired: number): number {
        const maxWidth = this._container.clientWidth * 0.8;
        if (lines.length === 0 || maxWidth <= 0) return desired;

        this._measureSpan.style.fontSize = desired + 'px';
        let widest = 0;
        for (const line of lines) {
            // Blank rows measure as a space so an empty line can't force a shrink.
            this._measureSpan.textContent = line || ' ';
            if (this._measureSpan.offsetWidth > widest) {
                widest = this._measureSpan.offsetWidth;
            }
        }
        if (widest <= maxWidth) return desired;

        const scaled = Math.floor(desired * (maxWidth / widest) * 0.98);
        return Math.max(CaptionRenderer.MIN_FIT_FONT_SIZE, Math.min(desired, scaled));
    }
}
