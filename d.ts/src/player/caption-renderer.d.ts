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
    private _currentText;
    constructor(videoElement: HTMLMediaElement);
    /** Update the displayed text (live display model). */
    setText(text: string): void;
    setVisible(visible: boolean): void;
    clear(): void;
    destroy(): void;
}
