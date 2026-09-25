export declare class H264StalePPSGuard {
    private readonly TAG;
    private sps;
    private lastSPS;
    private spsChanged;
    private actual;
    private parsed;
    private formatPPS;
    private deliveredPPS;
    private pictureOffset;
    private picturePPS;
    private guarded;
    /**
     * Feed every NAL unit (payload without start code or length prefix), in
     * stream order. Returns the NAL units to emit in its place, or null to
     * emit it unchanged.
     */
    process(nal: Uint8Array): Uint8Array[] | null;
    private processSlice;
    /** The same PPS with pic_init_qp_minus26 moved by one, differing in bytes from the format's. */
    private variantOf;
}
