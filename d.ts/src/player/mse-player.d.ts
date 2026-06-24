import MediaInfo from '../core/media-info';
declare class MSEPlayer {
    private readonly TAG;
    private _type;
    private _media_element;
    private _player_engine;
    constructor(mediaDataSource: any, config?: any);
    destroy(): void;
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
    attachMediaElement(mediaElement: HTMLMediaElement): void;
    detachMediaElement(): void;
    load(): void;
    unload(): void;
    play(): Promise<void>;
    pause(): void;
    get type(): string;
    get buffered(): TimeRanges;
    get duration(): number;
    get volume(): number;
    set volume(value: number);
    get muted(): boolean;
    set muted(muted: boolean);
    get currentTime(): number;
    set currentTime(seconds: number);
    get mediaInfo(): MediaInfo;
    get statisticsInfo(): any;
    private get _caption_manager();
    enableCaptions(): void;
    disableCaptions(): void;
    getCaptionTracks(): {
        id: string;
        type: string;
        label: string;
        lang?: string;
        pid?: number;
    }[];
    getActiveCaptionTrack(): string | null;
    setCaptionTrack(id: string | null): void;
    getTTMLTracks(): {
        pid: number;
        lang: string;
    }[];
    getActiveTTMLPID(): number | null;
    setTTMLTrack(pid: number): void;
    /** List all audio elementary streams discovered in the PMT. */
    getAudioTracks(): {
        pid: number;
        type: string;
        lang: string;
    }[];
    /** Switch to a different audio elementary stream by PID. */
    setAudioTrack(pid: number): void;
}
export default MSEPlayer;
