/*
 * Copyright (C) 2023 zheng qian. All Rights Reserved.
 *
 * @author zheng qian <xqq@xqq.im>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Live buffer latency synchronizer by increasing HTMLMediaElement.playbackRate.
//
// Static mode (liveSyncAutoTune=false): keep the latency (= buffered_end -
// currentTime, i.e. the forward buffer cushion) within [liveSyncTargetLatency,
// liveSyncMaxLatency], speeding up to liveSyncPlaybackRate when it exceeds max.
//
// Adaptive mode (liveSyncAutoTune=true): buffered_end advances in keyframe-
// aligned jumps, so the cushion must be at least as large as the longest gap
// between appends (≈ source GOP) or it underruns waiting for the next keyframe.
// We track the worst recent append gap and size the band from it:
//     target = clamp(gap * TARGET_FACTOR, floor, ceil)
//     max    = target + max(gap, MIN_MARGIN)
// so the cushion never drains below ~one GOP and a fresh append never pushes
// latency past max (which would make liveSync fight its own cushion and thrash
// the playback rate). floor = liveSyncTargetLatency, ceil = liveSyncMaxAutoLatency.
// Latency stays low for short-GOP sources and auto-expands for long/variable
// ones — resilience for feeds whose GOP we don't control.
class LiveLatencySynchronizer {

    private _config: any = null;
    private _media_element: HTMLMediaElement = null;

    private e?: any = null;

    // Adaptive (auto-tune) state: rolling window of recent fragment-append gaps.
    private _last_buffered_end: number = 0;
    private _last_advance_time: number = 0;  // performance.now() of last buffered_end advance
    private _append_gaps: number[] = [];

    private static readonly GAP_WINDOW: number = 16;
    private static readonly TARGET_FACTOR: number = 1.25;
    private static readonly MIN_MARGIN: number = 0.5;
    private static readonly MIN_SAMPLES: number = 3;

    public constructor(config: any, media_element: HTMLMediaElement) {
        this._config = config;
        this._media_element = media_element;

        this.e = {
            onMediaTimeUpdate: this._onMediaTimeUpdate.bind(this),
        };

        this._media_element.addEventListener('timeupdate', this.e.onMediaTimeUpdate);
    }

    public destroy(): void {
        this._media_element.removeEventListener('timeupdate', this.e.onMediaTimeUpdate);
        this._media_element = null;
        this._config = null;
        this._append_gaps = null;
    }

    private _onMediaTimeUpdate(e: Event): void {
        if (!this._config.isLive || !this._config.liveSync) {
            return;
        }

        const buffered = this._media_element.buffered;
        const buffered_end = buffered.length > 0 ? buffered.end(buffered.length - 1) : 0;

        if (this._config.liveSyncAutoTune) {
            this._trackAppendCadence(buffered_end);
        }

        const latency = buffered_end - this._media_element.currentTime;
        const band = this._getLatencyBand();

        if (latency > band.max) {
            const playback_rate = Math.min(2, Math.max(1, this._config.liveSyncPlaybackRate));
            this._media_element.playbackRate = playback_rate;
        } else if (latency > band.target) {
            // within band, keep current playbackRate
        } else if (this._media_element.playbackRate !== 1 && this._media_element.playbackRate !== 0) {
            this._media_element.playbackRate = 1;
        }
    }

    // Record the wall-clock gap between successive buffered_end advances. Each
    // advance is one fragment append; the gap ≈ the dry spell the cushion must
    // cover (source GOP duration plus any arrival jitter).
    private _trackAppendCadence(buffered_end: number): void {
        const now = (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : 0;

        if (this._last_advance_time === 0) {
            this._last_advance_time = now;
            this._last_buffered_end = buffered_end;
            return;
        }

        if (buffered_end > this._last_buffered_end + 0.01) {
            const gap_seconds = (now - this._last_advance_time) / 1000;
            // Ignore absurd gaps (background-tab throttling, pause) so a single
            // outlier can't poison the window.
            if (gap_seconds > 0 && gap_seconds < 60) {
                this._append_gaps.push(gap_seconds);
                if (this._append_gaps.length > LiveLatencySynchronizer.GAP_WINDOW) {
                    this._append_gaps.shift();
                }
            }
            this._last_advance_time = now;
            this._last_buffered_end = buffered_end;
        }
    }

    // The [target, max] latency band: configured values in static mode, or sized
    // from the worst recent append gap in adaptive mode (after a short warmup).
    private _getLatencyBand(): { target: number, max: number } {
        if (!this._config.liveSyncAutoTune
                || this._append_gaps.length < LiveLatencySynchronizer.MIN_SAMPLES) {
            return {
                target: this._config.liveSyncTargetLatency,
                max: this._config.liveSyncMaxLatency,
            };
        }

        const floor = this._config.liveSyncTargetLatency;
        const ceil = this._config.liveSyncMaxAutoLatency;

        let worst_gap = 0;
        for (let i = 0; i < this._append_gaps.length; i++) {
            if (this._append_gaps[i] > worst_gap) {
                worst_gap = this._append_gaps[i];
            }
        }
        worst_gap = Math.min(worst_gap, ceil);

        const target = Math.min(
            Math.max(worst_gap * LiveLatencySynchronizer.TARGET_FACTOR, floor),
            ceil
        );
        const max = target + Math.max(worst_gap, LiveLatencySynchronizer.MIN_MARGIN);
        return { target, max };
    }

}

export default LiveLatencySynchronizer;
