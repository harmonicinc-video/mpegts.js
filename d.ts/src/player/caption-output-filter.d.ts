/**
 * CaptionOutputFilter
 *
 * Bridges the Cea608Parser to the browser's native TextTrack API.
 * Matches hls.js OutputFilter pattern: newCue() only buffers,
 * dispatchCue() creates the actual VTTCue.
 */
import { CaptionScreen, OutputFilter } from './cea608-parser';
export default class CaptionOutputFilter implements OutputFilter {
    private _track;
    private _cueRanges;
    private _startTime;
    private _endTime;
    private _screenText;
    constructor(track: TextTrack);
    /**
     * Called by Cea608Channel.outputDataUpdate() on every screen change.
     * Only buffers — does NOT create a VTTCue.
     */
    newCue(startTime: number, endTime: number, screen: CaptionScreen): void;
    /**
     * Called on "dispatch" events (EOC, CR, EDM).
     * Creates the actual VTTCue and adds it to the TextTrack.
     */
    dispatchCue(): void;
    reset(): void;
}
