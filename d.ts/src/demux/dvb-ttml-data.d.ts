export interface DVBTTMLSegment {
    type: number;
    data: Uint8Array;
}
export declare class DVBTTMLData {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    lang: string;
    segment_mediatime: number;
    segments: DVBTTMLSegment[];
}
