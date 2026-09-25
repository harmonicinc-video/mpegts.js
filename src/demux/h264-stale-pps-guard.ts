/*
 * Keep Chrome's VideoToolbox decoder from decoding with a stale PPS.
 *
 * Chrome's macOS H.264 path (VideoToolboxH264Accelerator) builds the decoder's
 * format description from the SPS and PPS active at a keyframe. A PPS that
 * changes on a non-IDR picture is sent to VideoToolbox in-band instead, and the
 * format's PPS is left as it was. Chrome then decides whether to send a PPS by
 * comparing the picture's PPS with the format's PPS only. So when the stream
 * returns to the format's PPS after an in-band change, Chrome sends nothing and
 * VideoToolbox keeps decoding with the last in-band PPS: the wrong QP and
 * scaling matrices desync CABAC, the frame fails with
 * kVTVideoDecoderBadDataErr (-12909), and the <video> element errors out with
 * PIPELINE_ERROR_DECODE.
 *
 * Broadcast encoders with adaptive quantisation hit this routinely: they
 * re-send PPS 0 many times per GOP, switching scaling matrices and
 * pic_init_qp and then switching back.
 *
 * This guard follows that decision per picture. When a picture would reach the
 * stale case, it inserts a PPS that decodes identically but differs in bytes
 * (pic_init_qp_minus26 moved by one, and every slice_qp_delta of the picture
 * moved the other way, so 26 + pic_init_qp_minus26 + slice_qp_delta is
 * unchanged). Chrome sees a PPS change and delivers it. Every other picture
 * passes through untouched.
 */

import Log from '../utils/logger';

class BitReader {
    public pos = 0;
    constructor(private readonly d: Uint8Array) {}

    u(n: number): number {
        let v = 0;
        for (let i = 0; i < n; i++) {
            if (this.pos >= this.d.length * 8) {
                throw new Error('BitReader: read past end');
            }
            v = v * 2 + ((this.d[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
            this.pos++;
        }
        return v;
    }

    ue(): number {
        let zeros = 0;
        while (this.u(1) === 0) {
            if (++zeros > 31) {
                throw new Error('BitReader: invalid exp-golomb code');
            }
        }
        return zeros ? Math.pow(2, zeros) - 1 + this.u(zeros) : 0;
    }

    se(): number {
        const k = this.ue();
        return k & 1 ? (k + 1) / 2 : -(k / 2);
    }
}

class BitWriter {
    private bytes: number[] = [];
    private cur = 0;
    private n = 0;

    bit(v: number): void {
        this.cur = (this.cur << 1) | v;
        if (++this.n === 8) {
            this.bytes.push(this.cur);
            this.cur = 0;
            this.n = 0;
        }
    }

    u(n: number, v: number): void {
        for (let i = n - 1; i >= 0; i--) {
            this.bit(Math.floor(v / Math.pow(2, i)) & 1);
        }
    }

    ue(v: number): void {
        const x = v + 1;
        const len = Math.floor(Math.log(x) / Math.LN2);
        this.u(len, 0);
        this.u(len + 1, x);
    }

    se(v: number): void {
        this.ue(v > 0 ? 2 * v - 1 : -2 * v);
    }

    copy(src: Uint8Array, from: number, to: number): void {
        for (let p = from; p < to; p++) {
            this.bit((src[p >> 3] >> (7 - (p & 7))) & 1);
        }
    }

    get aligned(): boolean {
        return this.n === 0;
    }

    result(): Uint8Array {
        return new Uint8Array(this.bytes);
    }
}

function toRBSP(nal: Uint8Array): Uint8Array {
    const out = new Uint8Array(nal.length);
    let n = 0;
    let zeros = 0;
    for (let i = 0; i < nal.length; i++) {
        const b = nal[i];
        if (zeros >= 2 && b === 3) {
            zeros = 0;
            continue;
        }
        out[n++] = b;
        zeros = b === 0 ? zeros + 1 : 0;
    }
    return out.subarray(0, n);
}

function toEBSP(rbsp: Uint8Array): Uint8Array {
    const out: number[] = [];
    let zeros = 0;
    for (let i = 0; i < rbsp.length; i++) {
        const b = rbsp[i];
        if (zeros >= 2 && b <= 3) {
            out.push(3);
            zeros = 0;
        }
        out.push(b);
        zeros = b === 0 ? zeros + 1 : 0;
    }
    // An RBSP ending in a cabac_zero_word ends in 0x00, and a NAL unit must
    // not: H.264 7.4.1 appends a final 0x03. VideoToolbox rejects the slice
    // without it (ffmpeg tolerates it, so a software decode will not show this).
    if (out.length && out[out.length - 1] === 0) {
        out.push(3);
    }
    return new Uint8Array(out);
}

/** Bit position of the rbsp_stop_one_bit. */
function stopBit(d: Uint8Array): number {
    for (let i = d.length - 1; i >= 0; i--) {
        if (d[i]) {
            for (let k = 0; k < 8; k++) {
                if ((d[i] >> k) & 1) {
                    return i * 8 + (7 - k);
                }
            }
        }
    }
    return -1;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

interface SPSInfo {
    separateColourPlane: number;
    chromaArrayType: number;
    log2MaxFrameNum: number;
    pocType: number;
    log2MaxPocLsb: number;
    deltaPicOrderAlwaysZero: number;
    frameMbsOnly: number;
}

interface PPSInfo {
    spsId: number;
    cabac: number;
    bottomFieldPicOrder: number;
    numRefIdxL0: number;
    numRefIdxL1: number;
    weightedPred: number;
    weightedBipred: number;
    initQp: number;
    initQpStart: number;
    initQpEnd: number;
    deblockingControl: number;
    redundantPicCnt: number;
}

const HIGH_PROFILES = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];

function skipScalingLists(br: BitReader, count: number): void {
    for (let i = 0; i < count; i++) {
        if (br.u(1)) {
            const size = i < 6 ? 16 : 64;
            let last = 8;
            let next = 8;
            for (let j = 0; j < size; j++) {
                if (next !== 0) {
                    next = (last + br.se() + 256) % 256;
                }
                last = next === 0 ? last : next;
            }
        }
    }
}

function parseSPS(r: Uint8Array): { id: number, info: SPSInfo } {
    const br = new BitReader(r);
    br.pos = 8;
    const profile = br.u(8);
    br.u(16);
    const id = br.ue();
    let chromaFormat = 1;
    let separateColourPlane = 0;
    if (HIGH_PROFILES.indexOf(profile) >= 0) {
        chromaFormat = br.ue();
        if (chromaFormat === 3) {
            separateColourPlane = br.u(1);
        }
        br.ue();
        br.ue();
        br.u(1);
        if (br.u(1)) {
            skipScalingLists(br, chromaFormat !== 3 ? 8 : 12);
        }
    }
    const log2MaxFrameNum = br.ue() + 4;
    const pocType = br.ue();
    let log2MaxPocLsb = 0;
    let deltaPicOrderAlwaysZero = 0;
    if (pocType === 0) {
        log2MaxPocLsb = br.ue() + 4;
    } else if (pocType === 1) {
        deltaPicOrderAlwaysZero = br.u(1);
        br.se();
        br.se();
        const cycle = br.ue();
        for (let i = 0; i < cycle; i++) {
            br.se();
        }
    }
    br.ue();
    br.u(1);
    br.ue();
    br.ue();
    const frameMbsOnly = br.u(1);
    return {
        id,
        info: {
            separateColourPlane,
            chromaArrayType: separateColourPlane ? 0 : chromaFormat,
            log2MaxFrameNum, pocType, log2MaxPocLsb, deltaPicOrderAlwaysZero, frameMbsOnly,
        },
    };
}

function parsePPS(r: Uint8Array): { id: number, info: PPSInfo } | null {
    const br = new BitReader(r);
    br.pos = 8;
    const id = br.ue();
    const spsId = br.ue();
    const cabac = br.u(1);
    const bottomFieldPicOrder = br.u(1);
    if (br.ue() !== 0) {
        return null;  // slice groups (FMO): not handled, leave the stream alone
    }
    const numRefIdxL0 = br.ue() + 1;
    const numRefIdxL1 = br.ue() + 1;
    const weightedPred = br.u(1);
    const weightedBipred = br.u(2);
    const initQpStart = br.pos;
    const initQp = br.se();
    const initQpEnd = br.pos;
    br.se();
    br.se();
    const deblockingControl = br.u(1);
    br.u(1);
    const redundantPicCnt = br.u(1);
    return {
        id,
        info: {
            spsId, cabac, bottomFieldPicOrder, numRefIdxL0, numRefIdxL1, weightedPred, weightedBipred,
            initQp, initQpStart, initQpEnd, deblockingControl, redundantPicCnt,
        },
    };
}

/** The same PPS RBSP with pic_init_qp_minus26 replaced. */
function withInitQp(r: Uint8Array, pps: PPSInfo, initQp: number): Uint8Array {
    const bw = new BitWriter();
    bw.copy(r, 0, pps.initQpStart);
    bw.se(initQp);
    bw.copy(r, pps.initQpEnd, stopBit(r) + 1);
    while (!bw.aligned) {
        bw.bit(0);
    }
    return bw.result();
}

/** A slice RBSP with slice_qp_delta moved by `delta`. Throws on anything it cannot parse. */
function withQpDelta(r: Uint8Array, sps: SPSInfo, pps: PPSInfo, delta: number): Uint8Array {
    const br = new BitReader(r);
    const nalRefIdc = (r[0] >> 5) & 3;
    const idr = (r[0] & 31) === 5;
    br.pos = 8;
    br.ue();  // first_mb_in_slice
    const sliceType = br.ue() % 5;
    br.ue();  // pic_parameter_set_id
    const P = sliceType === 0 || sliceType === 3;
    const B = sliceType === 1;
    const I = sliceType === 2 || sliceType === 4;
    if (sps.separateColourPlane) {
        br.u(2);
    }
    br.u(sps.log2MaxFrameNum);
    let field = 0;
    if (!sps.frameMbsOnly) {
        field = br.u(1);
        if (field) {
            br.u(1);
        }
    }
    if (idr) {
        br.ue();
    }
    if (sps.pocType === 0) {
        br.u(sps.log2MaxPocLsb);
        if (pps.bottomFieldPicOrder && !field) {
            br.se();
        }
    } else if (sps.pocType === 1 && !sps.deltaPicOrderAlwaysZero) {
        br.se();
        if (pps.bottomFieldPicOrder && !field) {
            br.se();
        }
    }
    if (pps.redundantPicCnt) {
        br.ue();
    }
    if (B) {
        br.u(1);  // direct_spatial_mv_pred_flag
    }
    let l0 = pps.numRefIdxL0;
    let l1 = pps.numRefIdxL1;
    if ((P || B) && br.u(1)) {
        l0 = br.ue() + 1;
        if (B) {
            l1 = br.ue() + 1;
        }
    }
    const refPicListModification = () => {
        if (br.u(1)) {
            let op: number;
            do {
                op = br.ue();
                if (op !== 3) {
                    br.ue();
                }
            } while (op !== 3);
        }
    };
    if (!I) {
        refPicListModification();
    }
    if (B) {
        refPicListModification();
    }
    if ((pps.weightedPred && P) || (pps.weightedBipred === 1 && B)) {
        br.ue();
        if (sps.chromaArrayType !== 0) {
            br.ue();
        }
        const lists = B ? [l0, l1] : [l0];
        for (let li = 0; li < lists.length; li++) {
            for (let i = 0; i < lists[li]; i++) {
                if (br.u(1)) {
                    br.se();
                    br.se();
                }
                if (sps.chromaArrayType !== 0 && br.u(1)) {
                    br.se();
                    br.se();
                    br.se();
                    br.se();
                }
            }
        }
    }
    if (nalRefIdc) {
        if (idr) {
            br.u(2);
        } else if (br.u(1)) {
            let op: number;
            do {
                op = br.ue();
                if (op === 1 || op === 3) {
                    br.ue();
                }
                if (op === 2) {
                    br.ue();
                }
                if (op === 3 || op === 6) {
                    br.ue();
                }
                if (op === 4) {
                    br.ue();
                }
            } while (op !== 0);
        }
    }
    if (pps.cabac && !I) {
        br.ue();
    }
    const qpStart = br.pos;
    const qpDelta = br.se();
    const qpEnd = br.pos;
    const qp = 26 + pps.initQp + qpDelta + delta;
    if (qp < 0 || qp > 51) {
        throw new Error(`slice QP ${qp} out of range`);
    }
    if (sliceType === 3 || sliceType === 4) {
        if (sliceType === 3) {
            br.u(1);
        }
        br.se();
    }
    if (pps.deblockingControl && br.ue() !== 1) {
        br.se();
        br.se();
    }
    const headerEnd = br.pos;

    const bw = new BitWriter();
    bw.copy(r, 0, qpStart);
    bw.se(qpDelta + delta);
    bw.copy(r, qpEnd, headerEnd);
    if (pps.cabac) {
        // slice_data starts byte-aligned after cabac_alignment_one_bits: re-pad
        // our header the same way and carry the slice data over byte for byte.
        while (!bw.aligned) {
            bw.bit(1);
        }
        const head = bw.result();
        const dataStart = (headerEnd + 7) >> 3;
        const out = new Uint8Array(head.length + r.length - dataStart);
        out.set(head, 0);
        out.set(r.subarray(dataStart), head.length);
        return out;
    }
    bw.copy(r, headerEnd, stopBit(r) + 1);
    while (!bw.aligned) {
        bw.bit(0);
    }
    return bw.result();
}

interface PPSEntry {
    info: PPSInfo;
    rbsp: Uint8Array;
}

export class H264StalePPSGuard {

    private readonly TAG = 'H264StalePPSGuard';
    private sps: { [id: number]: SPSInfo } = {};
    private lastSPS: Uint8Array = null;
    private spsChanged = false;
    // The PPS the encoder last sent, per id.
    private actual: { [id: number]: PPSEntry } = {};
    // The PPS the decoder last parsed, per id: the encoder's, or one we inserted.
    private parsed: { [id: number]: PPSEntry } = {};
    // Chrome's model: the format's PPS, and the PPS VideoToolbox last received.
    private formatPPS: Uint8Array = null;
    private deliveredPPS: Uint8Array = null;
    // pic_init_qp offset of the picture being emitted, for its later slices.
    private pictureOffset = 0;
    private picturePPS: PPSInfo = null;
    private guarded = 0;

    /**
     * Feed every NAL unit (payload without start code or length prefix), in
     * stream order. Returns the NAL units to emit in its place, or null to
     * emit it unchanged.
     */
    public process(nal: Uint8Array): Uint8Array[] | null {
        // The Annex B parser hands over trailing_zero_8bits with the payload;
        // they belong to the byte stream, not the NAL unit.
        let end = nal.length;
        while (end > 1 && nal[end - 1] === 0) {
            end--;
        }
        nal = nal.subarray(0, end);
        const type = nal[0] & 31;
        try {
            if (type === 7) {
                const rbsp = toRBSP(nal);
                const sps = parseSPS(rbsp);
                this.sps[sps.id] = sps.info;
                if (this.lastSPS && !bytesEqual(this.lastSPS, rbsp)) {
                    this.spsChanged = true;
                }
                this.lastSPS = rbsp;
                return null;
            }
            if (type === 8) {
                const rbsp = toRBSP(nal);
                const pps = parsePPS(rbsp);
                if (pps) {
                    const entry = { info: pps.info, rbsp };
                    this.actual[pps.id] = entry;
                    this.parsed[pps.id] = entry;
                    if (this.formatPPS === null) {
                        // The first PPS is the one in the init segment's avcC.
                        this.formatPPS = rbsp;
                        this.deliveredPPS = rbsp;
                    }
                }
                return null;
            }
            if (type === 1 || type === 5) {
                return this.processSlice(nal);
            }
        } catch (e) {
            Log.w(this.TAG, `NAL type ${type} left as-is: ${e.message}`);
        }
        return null;
    }

    private processSlice(nal: Uint8Array): Uint8Array[] | null {
        const head = new BitReader(toRBSP(nal.subarray(0, Math.min(nal.length, 64))));
        head.pos = 8;
        const firstMb = head.ue();
        head.ue();
        const ppsId = head.ue();
        const actual = this.actual[ppsId];
        const parsed = this.parsed[ppsId];
        if (!actual || !parsed || this.formatPPS === null) {
            return null;
        }
        let out: Uint8Array[] = [];
        if (firstMb === 0) {
            // A new picture: this is where Chrome compares parameter sets.
            const formatChange = (nal[0] & 31) === 5 || this.spsChanged;
            this.spsChanged = false;
            let emitted = parsed;
            if (bytesEqual(emitted.rbsp, this.formatPPS) && !bytesEqual(this.deliveredPPS, this.formatPPS)) {
                emitted = this.variantOf(actual);
                this.parsed[ppsId] = emitted;
                out.push(toEBSP(emitted.rbsp));
                if (++this.guarded === 1) {
                    Log.v(this.TAG, 'inserting a re-encoded PPS where VideoToolbox would keep a stale one');
                }
            }
            if (!bytesEqual(emitted.rbsp, this.formatPPS)) {
                if (formatChange) {
                    this.formatPPS = emitted.rbsp;
                }
                this.deliveredPPS = emitted.rbsp;
            }
            this.pictureOffset = emitted.info.initQp - actual.info.initQp;
            this.picturePPS = emitted.info;
        }
        if (this.pictureOffset === 0) {
            return out.length ? out.concat([nal]) : null;
        }
        try {
            const sps = this.sps[actual.info.spsId];
            if (!sps) {
                throw new Error('no SPS');
            }
            out.push(toEBSP(withQpDelta(toRBSP(nal), sps, this.picturePPS, -this.pictureOffset)));
            return out;
        } catch (e) {
            // Leave the picture as the encoder sent it: without the rewritten
            // slice the inserted PPS would decode it with the wrong QP.
            Log.w(this.TAG, `slice left as-is: ${e.message}`);
            this.parsed[ppsId] = actual;
            this.pictureOffset = 0;
            return null;
        }
    }

    /** The same PPS with pic_init_qp_minus26 moved by one, differing in bytes from the format's. */
    private variantOf(pps: PPSEntry): PPSEntry {
        const candidates = [pps.info.initQp + 1, pps.info.initQp - 1];
        for (let i = 0; i < candidates.length; i++) {
            const initQp = candidates[i];
            if (initQp < -26 || initQp > 25) {
                continue;
            }
            const rbsp = withInitQp(pps.rbsp, pps.info, initQp);
            if (!bytesEqual(rbsp, this.formatPPS)) {
                return { info: parsePPS(rbsp).info, rbsp };
            }
        }
        throw new Error('no usable pic_init_qp variant');
    }
}
