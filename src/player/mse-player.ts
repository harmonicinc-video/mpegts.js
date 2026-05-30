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

import Log from '../utils/logger';
import MediaInfo from '../core/media-info';
import PlayerEngine from './player-engine';
import PlayerEngineMainThread from './player-engine-main-thread';
import PlayerEngineDedicatedThread from './player-engine-dedicated-thread';
import {InvalidArgumentException} from '../utils/exception';

class MSEPlayer {

    private readonly TAG: string = 'MSEPlayer';

    private _type: string = 'MSEPlayer';

    private _media_element: HTMLMediaElement = null;
    private _player_engine: PlayerEngine = null;

    public constructor(mediaDataSource: any, config?: any) {
        const typeLowerCase: string = mediaDataSource.type.toLowerCase();
        if (typeLowerCase !== 'mse'
                && typeLowerCase !== 'mpegts'
                && typeLowerCase !== 'm2ts'
                && typeLowerCase !== 'flv') {
            throw new InvalidArgumentException('MSEPlayer requires an mpegts/m2ts/flv MediaDataSource input!');
        }

        if (config && config.enableWorkerForMSE && PlayerEngineDedicatedThread.isSupported()) {
            try {
                this._player_engine = new PlayerEngineDedicatedThread(mediaDataSource, config);
            } catch (error) {
                Log.e(this.TAG,
                    'Error while initializing PlayerEngineDedicatedThread, fallback to PlayerEngineMainThread');
                this._player_engine = new PlayerEngineMainThread(mediaDataSource, config);
            }
        } else {
            this._player_engine = new PlayerEngineMainThread(mediaDataSource, config);
        }
    }

    public destroy(): void {
        this._player_engine.destroy();
        this._player_engine = null;
        this._media_element = null;
    }

    public on(event: string, listener: (...args: any[]) => void): void {
        this._player_engine.on(event, listener);
    }

    public off(event: string, listener: (...args: any[]) => void): void {
        this._player_engine.off(event, listener);
    }

    public attachMediaElement(mediaElement: HTMLMediaElement): void {
        this._media_element = mediaElement;
        this._player_engine.attachMediaElement(mediaElement);
    }

    public detachMediaElement(): void {
        this._media_element = null;
        this._player_engine.detachMediaElement();
    }

    public load(): void {
        this._player_engine.load();
    }

    public unload(): void {
        this._player_engine.unload();
    }

    public play(): Promise<void> {
        return this._player_engine.play();
    }

    public pause(): void {
        this._player_engine.pause();
    }

    public get type(): string {
        return this._type;
    }

    public get buffered(): TimeRanges {
        return this._media_element.buffered;
    }

    public get duration(): number {
        return this._media_element.duration;
    }

    public get volume(): number {
        return this._media_element.volume;
    }

    public set volume(value) {
        this._media_element.volume = value;
    }

    public get muted(): boolean {
        return this._media_element.muted;
    }

    public set muted(muted) {
        this._media_element.muted = muted;
    }

    public get currentTime(): number {
        if (this._media_element) {
            return this._media_element.currentTime;
        }
        return 0;
    }

    public set currentTime(seconds: number) {
        this._player_engine.seek(seconds);
    }

    public get mediaInfo(): MediaInfo {
        return this._player_engine.mediaInfo;
    }

    public get statisticsInfo(): any {
        return this._player_engine.statisticsInfo;
    }

    private get _caption_manager(): any {
        return this._player_engine && (this._player_engine as any)._caption_manager;
    }

    public enableCaptions(): void {
        if (this._caption_manager) { this._caption_manager.enableCaptions(); }
    }

    public disableCaptions(): void {
        if (this._caption_manager) { this._caption_manager.disableCaptions(); }
    }

    // --- Unified caption/subtitle track selection (CEA-608/708 + DVB TTML) ---

    // Returns the selectable tracks: { id, type: 'cea'|'ttml', label, lang?, pid? }.
    public getCaptionTracks(): { id: string, type: string, label: string, lang?: string, pid?: number }[] {
        const mgr = this._caption_manager;
        return mgr ? mgr.getTracks() : [];
    }

    // Active track id ('cea' | 'ttml:<pid>' | 'off'), or null before any data.
    public getActiveCaptionTrack(): string | null {
        const mgr = this._caption_manager;
        return mgr ? mgr.getActiveTrack() : null;
    }

    // Select a track by id, or 'off'/null to render nothing.
    public setCaptionTrack(id: string | null): void {
        const mgr = this._caption_manager;
        if (mgr) { mgr.setActiveTrack(id); }
    }

    // --- DVB TTML subtitle track selection (legacy helpers, kept for compat) ---
    public getTTMLTracks(): { pid: number, lang: string }[] {
        return this.getCaptionTracks()
            .filter((t) => t.type === 'ttml')
            .map((t) => ({ pid: t.pid as number, lang: t.lang as string }));
    }

    public getActiveTTMLPID(): number | null {
        const active = this.getActiveCaptionTrack();
        if (active && active.indexOf('ttml:') === 0) {
            return parseInt(active.substring('ttml:'.length), 10);
        }
        return null;
    }

    public setTTMLTrack(pid: number): void {
        this.setCaptionTrack(`ttml:${pid}`);
    }

}

export default MSEPlayer;
