/**
 * CaptionOutputFilter
 *
 * Bridges the Cea608Parser to the browser's native TextTrack API.
 * Matches hls.js OutputFilter pattern: newCue() only buffers,
 * dispatchCue() creates the actual VTTCue.
 */
import { CaptionScreen, OutputFilter } from './cea608-parser';

export default class CaptionOutputFilter implements OutputFilter {
    private _track: TextTrack;
    private _cueRanges: Array<[number, number]> = [];
    private _startTime: number | null = null;
    private _endTime: number | null = null;
    private _screenText: string | null = null;

    constructor(track: TextTrack) {
        this._track = track;
    }

    /**
     * Called by Cea608Channel.outputDataUpdate() on every screen change.
     * Only buffers — does NOT create a VTTCue.
     */
    newCue(startTime: number, endTime: number, screen: CaptionScreen): void {
        if (this._startTime === null || this._startTime > startTime) {
            this._startTime = startTime;
        }
        this._endTime = endTime;
        this._screenText = screen.getDisplayText();
    }

    /**
     * Called on "dispatch" events (EOC, CR, EDM).
     * Creates the actual VTTCue and adds it to the TextTrack.
     */
    dispatchCue(): void {
        if (this._startTime === null || !this._screenText) {
            return;
        }
        // Deduplicate identical time ranges
        for (let i = 0; i < this._cueRanges.length; i++) {
            if (this._cueRanges[i][0] === this._startTime &&
                this._cueRanges[i][1] === this._endTime) {
                return;
            }
        }
        try {
            const cue = new VTTCue(
                this._startTime,
                this._endTime,
                this._screenText
            );
            this._track.addCue(cue);
            this._cueRanges.push([this._startTime, this._endTime]);
        } catch (e) {
            // VTTCue may not be available
        }
        this._startTime = null;
    }

    reset(): void {
        this._cueRanges = [];
        this._startTime = null;
    }
}
