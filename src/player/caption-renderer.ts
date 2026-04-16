/**
 * CaptionRenderer
 *
 * DOM-based caption renderer using a live display model (like VLC).
 * Instead of timed cues, it simply shows "what the current text is"
 * and updates it whenever the decoder state changes.
 */
export default class CaptionRenderer {
    private _container: HTMLDivElement;
    private _textElement: HTMLDivElement;
    private _videoElement: HTMLMediaElement;
    private _currentText: string = '';
    private _onFullscreenChange: (() => void) | null = null;

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

        // The single text display element
        this._textElement = document.createElement('div');
        Object.assign(this._textElement.style, {
            textAlign: 'center',
            maxWidth: '80%',
            transition: 'opacity 0.1s ease',
        });
        this._container.appendChild(this._textElement);

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

    /** Update the displayed text (live display model). */
    setText(text: string): void {
        if (text === this._currentText) return;
        this._currentText = text;

        // Clear existing content
        this._textElement.innerHTML = '';

        if (!text) return;

        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) this._textElement.appendChild(document.createElement('br'));
            const span = document.createElement('span');
            span.textContent = lines[i];
            Object.assign(span.style, {
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                color: '#FFFFFF',
                fontFamily: 'Consolas, "Courier New", Courier, monospace',
                fontSize: this._computeFontSize() + 'px',
                fontWeight: '500',
                padding: '3px 10px',
                lineHeight: '1.5',
                letterSpacing: '0.03em',
                whiteSpace: 'pre-wrap',
                textShadow: '1px 1px 3px rgba(0,0,0,1)',
                borderRadius: '3px',
                display: 'inline',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone',
            });
            this._textElement.appendChild(span);
        }
    }

    setVisible(visible: boolean): void {
        this._container.style.display = visible ? 'flex' : 'none';
    }

    clear(): void {
        this._currentText = '';
        this._textElement.innerHTML = '';
    }

    destroy(): void {
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
     * Recalculate font size when entering/exiting fullscreen.
     * The consumer is responsible for fullscreening the video's parent
     * container (Shaka Player pattern) so the overlay stays visible.
     */
    private _handleFullscreenChange(): void {
        // Re-render current text with updated font size
        if (this._currentText) {
            const saved = this._currentText;
            this._currentText = '';
            this.setText(saved);
        }
    }

    /**
     * Compute font size based on video container height.
     * CEA-708 defines 15 rows; each row ~5.33% of height (like Shaka).
     * We use ~4.5% for comfortable reading.
     */
    private _computeFontSize(): number {
        const containerHeight = this._videoElement?.parentElement?.clientHeight
            || this._videoElement?.clientHeight || 480;
        const size = Math.round(containerHeight * 0.045);
        return Math.max(18, Math.min(size, 42));
    }
}
