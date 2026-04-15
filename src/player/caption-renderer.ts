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
    private _currentText: string = '';

    constructor(videoElement: HTMLMediaElement) {
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

        // Insert into the video's parent
        const parent = videoElement.parentElement;
        if (parent) {
            const pos = getComputedStyle(parent).position;
            if (pos === 'static') parent.style.position = 'relative';
            parent.appendChild(this._container);
        }
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
                fontSize: 'clamp(16px, 2.2vw, 28px)',
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
        if (this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
    }
}
