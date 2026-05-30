// DVB TTML subtitle data carried in PES packets (stream_type=0x06,
// identified by the TTML subtitling descriptor, ETSI EN 303 560).

export interface DVBTTMLSegment {
    // segment_type: 0x01 = uncompressed TTML, 0x02 = gzip-compressed TTML
    type: number;
    data: Uint8Array;
}

export class DVBTTMLData {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    lang: string;
    // segment_mediatime in units of 100 microseconds (48-bit field)
    segment_mediatime: number;
    segments: DVBTTMLSegment[] = [];
}
