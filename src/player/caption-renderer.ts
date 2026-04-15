/**
 * CaptionRenderer
 *
 * DOM-based caption renderer inspired by Shaka Player's UITextDisplayer.
 * Creates a styled overlay on top of the video element instead of using
 * the browser's native VTTCue/TextTrack rendering.
 */
export default class CaptionRenderer {
    private _container: HTMLDivElement;
    private _videoElement: HTMLMediaElement;
    private _cues: RenderedCue[] = [];
    private _rafId: number = 0;
    private _visible: boolean = true;

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
            paddingBottom: '5%',
            zIndex: '2147483647',  // max z-index to be on top
        });

        // Ensure the parent container has relative positioning
        const parent = videoElement.parentElement;
        if (parent) {
            const parentPos = getComputedStyle(parent).position;
            if (parentPos === 'static') {
                parent.style.position = 'relative';
            }
            parent.appendChild(this._container);
        }

        // Start the update loop
        this._tick = this._tick.bind(this);
        this._startLoop();
    }

    /** Add a caption cue to the renderer */
    addCue(startTime: number, endTime: number, text: string): void {
        const cue: RenderedCue = { startTime, endTime, text, element: null };
        this._cues.push(cue);

        // Limit total cues to prevent memory buildup
        while (this._cues.length > 100) {
            const old = this._cues.shift();
            if (old?.element?.parentNode) {
                old.element.parentNode.removeChild(old.element);
            }
        }
    }

    /** Set visibility */
    setVisible(visible: boolean): void {
        this._visible = visible;
        this._container.style.display = visible ? 'flex' : 'none';
    }

    /** Clear all cues */
    clear(): void {
        for (const cue of this._cues) {
            if (cue.element?.parentNode) {
                cue.element.parentNode.removeChild(cue.element);
            }
        }
        this._cues = [];
    }

    /** Destroy the renderer */
    destroy(): void {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
        this.clear();
        if (this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._videoElement = null;
    }

    private _startLoop(): void {
        this._rafId = requestAnimationFrame(this._tick);
    }

    private _tick(): void {
        if (!this._videoElement) return;
        this._updateCues();
        this._rafId = requestAnimationFrame(this._tick);
    }

    private _updateCues(): void {
        const ct = this._videoElement.currentTime;

        for (const cue of this._cues) {
            const shouldShow = ct >= cue.startTime && ct < cue.endTime;

            if (shouldShow && !cue.element) {
                // Create and show the cue element
                cue.element = this._createCueElement(cue.text);
                this._container.appendChild(cue.element);
            } else if (!shouldShow && cue.element) {
                // Remove the cue element
                if (cue.element.parentNode) {
                    cue.element.parentNode.removeChild(cue.element);
                }
                cue.element = null;
            }
        }

        // Purge old cues that have ended and are no longer needed
        const cutoff = ct - 30;  // keep 30s of history
        while (this._cues.length > 0 && this._cues[0].endTime < cutoff) {
            const old = this._cues.shift();
            if (old?.element?.parentNode) {
                old.element.parentNode.removeChild(old.element);
            }
        }
    }

    private _createCueElement(text: string): HTMLDivElement {
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            textAlign: 'center',
            marginBottom: '2px',
            maxWidth: '80%',
        });

        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) wrapper.appendChild(document.createElement('br'));
            const span = document.createElement('span');
            span.textContent = lines[i];
            Object.assign(span.style, {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: '#FFFFFF',
                fontFamily: '"Courier New", Courier, monospace',
                fontSize: '1.3em',
                fontWeight: '600',
                padding: '2px 8px',
                lineHeight: '1.4',
                whiteSpace: 'pre-wrap',
                textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
                borderRadius: '2px',
                display: 'inline',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone',
            });
            wrapper.appendChild(span);
        }
        return wrapper;
    }
}

interface RenderedCue {
    startTime: number;
    endTime: number;
    text: string;
    element: HTMLDivElement | null;
}
