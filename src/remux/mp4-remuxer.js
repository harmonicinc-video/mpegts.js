/*
 * Copyright (C) 2016 Bilibili. All Rights Reserved.
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

import Log from '../utils/logger.js';
import MP4 from './mp4-generator.js';
import AAC from './aac-silent.js';
import Browser from '../utils/browser.js';
import { SampleInfo, MediaSegmentInfo, MediaSegmentInfoList } from '../core/media-segment-info.js';
import { IllegalStateException } from '../utils/exception.js';


// A backward DTS step larger than this is treated as a stream timeline
// discontinuity (source switch, pipeline restart, failover) rather than as
// packet overlap or jitter. Audio re-anchors on the continuous output grid
// instead of dropping every frame until the wire catches up (which starves
// audio for the whole gap and freezes playback); both tracks discard the
// sample stashed from the old timeline, because deriving a batch's
// dtsCorrection from it maps every genuinely new sample far into the past.
// Smaller overlaps keep the historical behavior.
const DTS_DISCONTINUITY_MS = 500;

// Fragmented mp4 remuxer
class MP4Remuxer {

    constructor(config) {
        this.TAG = 'MP4Remuxer';

        this._config = config;
        this._isLive = (config.isLive === true) ? true : false;

        this._dtsBase = -1;
        this._dtsBaseInited = false;
        this._audioDtsBase = Infinity;
        this._videoDtsBase = Infinity;
        this._audioNextDts = undefined;
        this._audioBackwardJumpActive = false;
        this._videoBackwardJumpActive = false;
        this._videoNextDts = undefined;
        this._audioStashedLastSample = null;
        this._videoStashedLastSample = null;

        this._audioMeta = null;
        this._videoMeta = null;

        this._audioSegmentInfoList = new MediaSegmentInfoList('audio');
        this._videoSegmentInfoList = new MediaSegmentInfoList('video');

        this._onInitSegment = null;
        this._onMediaSegment = null;

        // Workaround for chrome < 50: Always force first sample as a Random Access Point in media segment
        // see https://bugs.chromium.org/p/chromium/issues/detail?id=229412
        this._forceFirstIDR = (Browser.chrome &&
                              (Browser.version.major < 50 ||
                              (Browser.version.major === 50 && Browser.version.build < 2661))) ? true : false;

        // Workaround for IE11/Edge: Fill silent aac frame after keyframe-seeking
        // Make audio beginDts equals with video beginDts, in order to fix seek freeze
        this._fillSilentAfterSeek = (Browser.msedge || Browser.msie);

        // While only FireFox supports 'audio/mp4, codecs="mp3"', use 'audio/mpeg' for chrome, safari, ...
        this._mp3UseMpegAudio = !Browser.firefox;

        this._fillAudioTimestampGap = this._config.fixAudioTimestampGap;
    }

    destroy() {
        this._dtsBase = -1;
        this._dtsBaseInited = false;
        this._audioMeta = null;
        this._videoMeta = null;
        this._audioSegmentInfoList.clear();
        this._audioSegmentInfoList = null;
        this._videoSegmentInfoList.clear();
        this._videoSegmentInfoList = null;
        this._onInitSegment = null;
        this._onMediaSegment = null;
    }

    bindDataSource(producer) {
        producer.onDataAvailable = this.remux.bind(this);
        producer.onTrackMetadata = this._onTrackMetadataReceived.bind(this);
        return this;
    }

    /* prototype: function onInitSegment(type: string, initSegment: ArrayBuffer): void
       InitSegment: {
           type: string,
           data: ArrayBuffer,
           codec: string,
           container: string
       }
    */
    get onInitSegment() {
        return this._onInitSegment;
    }

    set onInitSegment(callback) {
        this._onInitSegment = callback;
    }

    /* prototype: function onMediaSegment(type: string, mediaSegment: MediaSegment): void
       MediaSegment: {
           type: string,
           data: ArrayBuffer,
           sampleCount: int32
           info: MediaSegmentInfo
       }
    */
    get onMediaSegment() {
        return this._onMediaSegment;
    }

    set onMediaSegment(callback) {
        this._onMediaSegment = callback;
    }

    // True when `firstNewSample` sits far enough below the track's running
    // output timeline (or below the sample stashed from the previous batch) to
    // be a stream discontinuity rather than overlap/jitter. Compared against
    // _{audio,video}NextDts when known, else against the stashed sample, so it
    // still fires on the batch where the timeline reference was just reset.
    _isBackwardDiscontinuity(firstNewSample, stashedSample, nextDts) {
        if (firstNewSample == null) {
            return false;
        }
        const originalDts = firstNewSample.dts - this._dtsBase;
        const reference = nextDts !== undefined
            ? nextDts
            : (stashedSample != null ? stashedSample.dts - this._dtsBase : undefined);
        if (reference === undefined) {
            return false;
        }
        return (originalDts - reference) <= -DTS_DISCONTINUITY_MS;
    }

    insertDiscontinuity() {
        this._audioNextDts = this._videoNextDts = undefined;
        this._audioBackwardJumpActive = false;
        this._videoBackwardJumpActive = false;
    }

    seek(originalDts) {
        this._audioStashedLastSample = null;
        this._videoStashedLastSample = null;
        this._videoSegmentInfoList.clear();
        this._audioSegmentInfoList.clear();
    }

    remux(audioTrack, videoTrack) {
        if (!this._onMediaSegment) {
            throw new IllegalStateException('MP4Remuxer: onMediaSegment callback must be specificed!');
        }
        if (!this._dtsBaseInited) {
            this._calculateDtsBase(audioTrack, videoTrack);
        }
        if (videoTrack) {
            this._remuxVideo(videoTrack);
        }
        if (audioTrack) {
            this._remuxAudio(audioTrack);
        }
    }

    _onTrackMetadataReceived(type, metadata) {
        let metabox = null;

        let container = 'mp4';
        let codec = metadata.codec;

        if (type === 'audio') {
            this._audioMeta = metadata;
            if (metadata.codec === 'mp3' && this._mp3UseMpegAudio) {
                // 'audio/mpeg' for MP3 audio track
                container = 'mpeg';
                codec = '';
                metabox = new Uint8Array();
            } else {
                // 'audio/mp4, codecs="codec"'
                metabox = MP4.generateInitSegment(metadata);
            }
        } else if (type === 'video') {
            this._videoMeta = metadata;
            metabox = MP4.generateInitSegment(metadata);
        } else {
            return;
        }

        // dispatch metabox (Initialization Segment)
        if (!this._onInitSegment) {
            throw new IllegalStateException('MP4Remuxer: onInitSegment callback must be specified!');
        }
        this._onInitSegment(type, {
            type: type,
            data: metabox.buffer,
            codec: codec,
            container: `${type}/${container}`,
            mediaDuration: metadata.duration  // in timescale 1000 (milliseconds)
        });
    }

    _calculateDtsBase(audioTrack, videoTrack) {
        if (this._dtsBaseInited) {
            return;
        }

        if (audioTrack && audioTrack.samples && audioTrack.samples.length) {
            this._audioDtsBase = audioTrack.samples[0].dts;
        }
        if (videoTrack && videoTrack.samples && videoTrack.samples.length) {
            this._videoDtsBase = videoTrack.samples[0].dts;
        }

        this._dtsBase = Math.min(this._audioDtsBase, this._videoDtsBase);
        this._dtsBaseInited = true;
    }

    getTimestampBase() {
        if (!this._dtsBaseInited) {
            return undefined;
        }
        return this._dtsBase;
    }

    flushStashedSamples() {
        let videoSample = this._videoStashedLastSample;
        let audioSample = this._audioStashedLastSample;

        let videoTrack = {
            type: 'video',
            id: 1,
            sequenceNumber: 0,
            samples: [],
            length: 0
        };

        if (videoSample != null) {
            videoTrack.samples.push(videoSample);
            videoTrack.length = videoSample.length;
        }

        let audioTrack = {
            type: 'audio',
            id: 2,
            sequenceNumber: 0,
            samples: [],
            length: 0
        };

        if (audioSample != null) {
            audioTrack.samples.push(audioSample);
            audioTrack.length = audioSample.length;
        }

        this._videoStashedLastSample = null;
        this._audioStashedLastSample = null;

        this._remuxVideo(videoTrack, true);
        this._remuxAudio(audioTrack, true);
    }

    _remuxAudio(audioTrack, force) {
        if (this._audioMeta == null) {
            return;
        }

        let track = audioTrack;
        let samples = track.samples;
        let dtsCorrection = undefined;
        let firstDts = -1, lastDts = -1, lastPts = -1;
        let refSampleDuration = this._audioMeta.refSampleDuration;

        let mpegRawTrack = this._audioMeta.codec === 'mp3' && this._mp3UseMpegAudio;
        let firstSegmentAfterSeek = this._dtsBaseInited && this._audioNextDts === undefined;

        let insertPrefixSilentFrame = false;

        if (!samples || samples.length === 0) {
            return;
        }
        if (samples.length === 1 && !force) {
            // If [sample count in current batch] === 1 && (force != true)
            // Ignore and keep in demuxer's queue
            return;
        }  // else if (force === true) do remux

        let offset = 0;
        let mdatbox = null;
        let mdatBytes = 0;

        // calculate initial mdat size
        if (mpegRawTrack) {
            // for raw mpeg buffer
            offset = 0;
            mdatBytes = track.length;
        } else {
            // for fmp4 mdat box
            offset = 8;  // size + type
            mdatBytes = 8 + track.length;
        }


        let lastSample = null;

        // Pop the lastSample and waiting for stash
        if (samples.length > 1) {
            lastSample = samples.pop();
            mdatBytes -= lastSample.length;
        }

        // Insert [stashed lastSample in the previous batch] to the front.
        // Across a timeline discontinuity the stashed sample belongs to the OLD
        // timeline: it must not be re-inserted, or it lands on the new grid as a
        // stray frame from minutes ago (and skews this batch's dtsCorrection).
        if (this._audioStashedLastSample != null) {
            let sample = this._audioStashedLastSample;
            this._audioStashedLastSample = null;
            if (!this._isBackwardDiscontinuity(samples[0], sample, this._audioNextDts)) {
                samples.unshift(sample);
                mdatBytes += sample.length;
            }
            // else: dropped. No mdatBytes adjustment — the stashed sample was
            // never part of this batch's track.length in the first place.
        }

        // Stash the lastSample of current batch, waiting for next batch
        if (lastSample != null) {
            this._audioStashedLastSample = lastSample;
        }


        let firstSampleOriginalDts = samples[0].dts - this._dtsBase;

        // calculate dtsCorrection
        if (this._audioNextDts) {
            dtsCorrection = firstSampleOriginalDts - this._audioNextDts;
        } else {  // this._audioNextDts == undefined
            if (this._audioSegmentInfoList.isEmpty()) {
                dtsCorrection = 0;
                if (this._fillSilentAfterSeek && !this._videoSegmentInfoList.isEmpty()) {
                    if (this._audioMeta.originalCodec !== 'mp3') {
                        insertPrefixSilentFrame = true;
                    }
                }
            } else {
                let lastSample = this._audioSegmentInfoList.getLastSampleBefore(firstSampleOriginalDts);
                if (lastSample != null) {
                    let distance = (firstSampleOriginalDts - (lastSample.originalDts + lastSample.duration));
                    if (distance <= 3) {
                        distance = 0;
                    }
                    let expectedDts = lastSample.dts + lastSample.duration + distance;
                    dtsCorrection = firstSampleOriginalDts - expectedDts;
                } else { // lastSample == null, cannot found
                    dtsCorrection = 0;
                }
            }
        }

        if (insertPrefixSilentFrame) {
            // align audio segment beginDts to match with current video segment's beginDts
            let firstSampleDts = firstSampleOriginalDts - dtsCorrection;
            let videoSegment = this._videoSegmentInfoList.getLastSegmentBefore(firstSampleOriginalDts);
            if (videoSegment != null && videoSegment.beginDts < firstSampleDts) {
                let silentUnit = AAC.getSilentFrame(this._audioMeta.originalCodec, this._audioMeta.channelCount);
                if (silentUnit) {
                    let dts = videoSegment.beginDts;
                    let silentFrameDuration = firstSampleDts - videoSegment.beginDts;
                    Log.v(this.TAG, `InsertPrefixSilentAudio: dts: ${dts}, duration: ${silentFrameDuration}`);
                    samples.unshift({ unit: silentUnit, dts: dts, pts: dts });
                    mdatBytes += silentUnit.byteLength;
                }  // silentUnit == null: Cannot generate, skip
            } else {
                insertPrefixSilentFrame = false;
            }
        }

        let mp4Samples = [];

        // Correct dts for each sample, and calculate sample duration. Then output to mp4Samples
        for (let i = 0; i < samples.length; i++) {
            let sample = samples[i];
            let unit = sample.unit;
            let originalDts = sample.dts - this._dtsBase;
            let dts = originalDts;
            let needFillSilentFrames = false;
            let silentFrames = null;
            let sampleDuration = 0;

            if (originalDts < -0.001 && this._audioNextDts === undefined) {
                // Only before the audio timeline exists is a negative dts an
                // invalid first sample. Mid-stream it means the wire timeline
                // jumped below _dtsBase (e.g. a pipeline restart) — let it
                // through so the discontinuity re-anchor below handles it.
                continue; //pass the first sample with the invalid dts
            }

            if (this._audioMeta.codec !== 'mp3' && refSampleDuration != null) {
                // for AAC codec, we need to keep dts increase based on refSampleDuration
                let curRefDts = originalDts;
                const maxAudioFramesDrift = 3;
                if (this._audioNextDts) {
                    curRefDts = this._audioNextDts;
                }

                dtsCorrection = originalDts - curRefDts;
                const backwardJump = dtsCorrection <= -DTS_DISCONTINUITY_MS;
                if (backwardJump) {
                    if (!this._audioBackwardJumpActive) {
                        this._audioBackwardJumpActive = true;
                        Log.w(this.TAG, `Audio DTS jumped backwards (originalDts: ${originalDts} ms, curRefDts: ${curRefDts} ms, ` +
                            `dtsCorrection: ${Math.round(dtsCorrection)} ms) — treating as timeline discontinuity, re-anchoring on the continuous grid.`);
                    }
                } else {
                    this._audioBackwardJumpActive = false;
                }
                if (!backwardJump && dtsCorrection <= -maxAudioFramesDrift * refSampleDuration) {
                    // If we're overlapping by more than maxAudioFramesDrift number of frame, drop this sample
                    Log.w(this.TAG, `Dropping 1 audio frame (originalDts: ${originalDts} ms ,curRefDts: ${curRefDts} ms)  due to dtsCorrection: ${dtsCorrection} ms overlap.`);
                    continue;
                }
                else if (!backwardJump && dtsCorrection >= maxAudioFramesDrift * refSampleDuration && this._fillAudioTimestampGap && !Browser.safari) {
                    // Silent frame generation, if large timestamp gap detected && config.fixAudioTimestampGap
                    needFillSilentFrames = true;
                    // We need to insert silent frames to fill timestamp gap
                    let frameCount = Math.floor(dtsCorrection / refSampleDuration);
                    Log.w(this.TAG, 'Large audio timestamp gap detected, may cause AV sync to drift. ' +
                        'Silent frames will be generated to avoid unsync.\n' +
                        `originalDts: ${originalDts} ms, curRefDts: ${curRefDts} ms, ` +
                        `dtsCorrection: ${Math.round(dtsCorrection)} ms, generate: ${frameCount} frames`);


                    dts = Math.floor(curRefDts);
                    sampleDuration = Math.floor(curRefDts + refSampleDuration) - dts;

                    let silentUnit = AAC.getSilentFrame(this._audioMeta.originalCodec, this._audioMeta.channelCount);
                    if (silentUnit == null) {
                        Log.w(this.TAG, 'Unable to generate silent frame for ' +
                            `${this._audioMeta.originalCodec} with ${this._audioMeta.channelCount} channels, repeat last frame`);
                        // Repeat last frame
                        silentUnit = unit;
                    }
                    silentFrames = [];

                    for (let j = 0; j < frameCount; j++) {
                        curRefDts = curRefDts + refSampleDuration;
                        let intDts = Math.floor(curRefDts);  // change to integer
                        let intDuration = Math.floor(curRefDts + refSampleDuration) - intDts;
                        let frame = {
                            dts: intDts,
                            pts: intDts,
                            cts: 0,
                            unit: silentUnit,
                            size: silentUnit.byteLength,
                            duration: intDuration,  // wait for next sample
                            originalDts: originalDts,
                            flags: {
                                isLeading: 0,
                                dependsOn: 1,
                                isDependedOn: 0,
                                hasRedundancy: 0
                            }
                        };
                        silentFrames.push(frame);
                        mdatBytes += frame.size;

                    }

                    this._audioNextDts = curRefDts + refSampleDuration;

                } else {

                    dts = Math.floor(curRefDts);
                    sampleDuration = Math.floor(curRefDts + refSampleDuration) - dts;
                    this._audioNextDts = curRefDts + refSampleDuration;

                }
            } else {
                // keep the original dts calculate algorithm for mp3
                dts = originalDts - dtsCorrection;


                if (i !== samples.length - 1) {
                    let nextDts = samples[i + 1].dts - this._dtsBase - dtsCorrection;
                    sampleDuration = nextDts - dts;
                } else {  // the last sample
                    if (lastSample != null) {  // use stashed sample's dts to calculate sample duration
                        let nextDts = lastSample.dts - this._dtsBase - dtsCorrection;
                        sampleDuration = nextDts - dts;
                    } else if (mp4Samples.length >= 1) {  // use second last sample duration
                        sampleDuration = mp4Samples[mp4Samples.length - 1].duration;
                    } else {  // the only one sample, use reference sample duration
                        sampleDuration = Math.floor(refSampleDuration);
                    }
                }
                this._audioNextDts = dts + sampleDuration;
            }

            if (firstDts === -1) {
                firstDts = dts;
            }
            mp4Samples.push({
                dts: dts,
                pts: dts,
                cts: 0,
                unit: sample.unit,
                size: sample.unit.byteLength,
                duration: sampleDuration,
                originalDts: originalDts,
                flags: {
                    isLeading: 0,
                    dependsOn: 1,
                    isDependedOn: 0,
                    hasRedundancy: 0
                }
            });

            if (needFillSilentFrames) {
                // Silent frames should be inserted after wrong-duration frame
                mp4Samples.push.apply(mp4Samples, silentFrames);
            }
        }

        if (mp4Samples.length === 0) {
            //no samples need to remux
            track.samples = [];
            track.length = 0;
            return;
        }

        // allocate mdatbox
        if (mpegRawTrack) {
            // allocate for raw mpeg buffer
            mdatbox = new Uint8Array(mdatBytes);
        } else {
            // allocate for fmp4 mdat box
            mdatbox = new Uint8Array(mdatBytes);
            // size field
            mdatbox[0] = (mdatBytes >>> 24) & 0xFF;
            mdatbox[1] = (mdatBytes >>> 16) & 0xFF;
            mdatbox[2] = (mdatBytes >>>  8) & 0xFF;
            mdatbox[3] = (mdatBytes) & 0xFF;
            // type field (fourCC)
            mdatbox.set(MP4.types.mdat, 4);
        }

        // Write samples into mdatbox
        for (let i = 0; i < mp4Samples.length; i++) {
            let unit = mp4Samples[i].unit;
            mdatbox.set(unit, offset);
            offset += unit.byteLength;
        }

        let latest = mp4Samples[mp4Samples.length - 1];
        lastDts = latest.dts + latest.duration;
        //this._audioNextDts = lastDts;

        // fill media segment info & add to info list
        let info = new MediaSegmentInfo();
        info.beginDts = firstDts;
        info.endDts = lastDts;
        info.beginPts = firstDts;
        info.endPts = lastDts;
        info.originalBeginDts = mp4Samples[0].originalDts;
        info.originalEndDts = latest.originalDts + latest.duration;
        info.firstSample = new SampleInfo(mp4Samples[0].dts,
                                          mp4Samples[0].pts,
                                          mp4Samples[0].duration,
                                          mp4Samples[0].originalDts,
                                          false);
        info.lastSample = new SampleInfo(latest.dts,
                                         latest.pts,
                                         latest.duration,
                                         latest.originalDts,
                                         false);
        if (!this._isLive) {
            this._audioSegmentInfoList.append(info);
        }

        track.samples = mp4Samples;
        track.sequenceNumber++;

        let moofbox = null;

        if (mpegRawTrack) {
            // Generate empty buffer, because useless for raw mpeg
            moofbox = new Uint8Array();
        } else {
            // Generate moof for fmp4 segment
            moofbox = MP4.moof(track, firstDts);
        }

        track.samples = [];
        track.length = 0;

        let segment = {
            type: 'audio',
            data: this._mergeBoxes(moofbox, mdatbox).buffer,
            sampleCount: mp4Samples.length,
            info: info
        };

        if (mpegRawTrack && firstSegmentAfterSeek) {
            // For MPEG audio stream in MSE, if seeking occurred, before appending new buffer
            // We need explicitly set timestampOffset to the desired point in timeline for mpeg SourceBuffer.
            segment.timestampOffset = firstDts;
        }

        this._onMediaSegment('audio', segment);
    }

    _remuxVideo(videoTrack, force) {
        if (this._videoMeta == null) {
            return;
        }

        let track = videoTrack;
        let samples = track.samples;
        let dtsCorrection = undefined;
        let firstDts = -1, lastDts = -1;
        let firstPts = -1, lastPts = -1;

        if (!samples || samples.length === 0) {
            return;
        }
        if (samples.length === 1 && !force) {
            // If [sample count in current batch] === 1 && (force != true)
            // Ignore and keep in demuxer's queue
            return;
        }  // else if (force === true) do remux

        let offset = 8;
        let mdatbox = null;
        let mdatBytes = 8 + videoTrack.length;


        let lastSample = null;

        // Pop the lastSample and waiting for stash
        if (samples.length > 1) {
            lastSample = samples.pop();
            mdatBytes -= lastSample.length;
        }

        // Insert [stashed lastSample in the previous batch] to the front.
        // Across a timeline discontinuity the stashed sample belongs to the OLD
        // timeline. Keeping it made samples[0] a stale sample, so this batch's
        // dtsCorrection was derived from it and every genuinely new frame was
        // mapped ~(jump) into the past — MSE dropped them and the picture froze
        // on its last frame while audio carried on. Dropping it lets the
        // standard correction anchor the new samples on _videoNextDts.
        if (this._videoStashedLastSample != null) {
            let sample = this._videoStashedLastSample;
            this._videoStashedLastSample = null;
            if (!this._isBackwardDiscontinuity(samples[0], sample, this._videoNextDts)) {
                samples.unshift(sample);
                mdatBytes += sample.length;
            }
            // else: dropped. No mdatBytes adjustment — the stashed sample was
            // never part of this batch's track.length in the first place.
        }

        // Stash the lastSample of current batch, waiting for next batch
        if (lastSample != null) {
            this._videoStashedLastSample = lastSample;
        }


        let firstSampleOriginalDts = samples[0].dts - this._dtsBase;

        // calculate dtsCorrection
        if (this._videoNextDts) {
            dtsCorrection = firstSampleOriginalDts - this._videoNextDts;
        } else {  // this._videoNextDts == undefined
            if (this._videoSegmentInfoList.isEmpty()) {
                dtsCorrection = 0;
            } else {
                let lastSample = this._videoSegmentInfoList.getLastSampleBefore(firstSampleOriginalDts);
                if (lastSample != null) {
                    let distance = (firstSampleOriginalDts - (lastSample.originalDts + lastSample.duration));
                    if (distance <= 3) {
                        distance = 0;
                    }
                    let expectedDts = lastSample.dts + lastSample.duration + distance;
                    dtsCorrection = firstSampleOriginalDts - expectedDts;
                } else { // lastSample == null, cannot found
                    dtsCorrection = 0;
                }
            }
        }

        let info = new MediaSegmentInfo();
        let mp4Samples = [];

        // Correct dts for each sample, and calculate sample duration. Then output to mp4Samples
        let previousOriginalDts = null;

        for (let i = 0; i < samples.length; i++) {
            let sample = samples[i];
            let originalDts = sample.dts - this._dtsBase;

            // A single batch can straddle a stream discontinuity: the source
            // looped or restarted part-way through it. dtsCorrection was derived
            // from samples[0], i.e. the OLD timeline, so from here on it maps
            // every new sample by the size of the jump into the past. MSE drops
            // those, and because the batch's last sample leaves _videoNextDts in
            // the past, every later batch is anchored to that garbage too — the
            // picture freezes for good while audio, which rides its own grid,
            // keeps playing. Re-anchor on the running output timeline instead.
            // Video dts is decode order and monotonic in a well-formed stream
            // (reordering lives in cts), so a large step back is unambiguous.
            if (previousOriginalDts !== null
                    && (originalDts - previousOriginalDts) <= -DTS_DISCONTINUITY_MS) {
                let previousMp4Sample = mp4Samples[mp4Samples.length - 1];
                if (previousMp4Sample != null) {
                    dtsCorrection = originalDts - (previousMp4Sample.dts + previousMp4Sample.duration);
                    if (!this._videoBackwardJumpActive) {
                        this._videoBackwardJumpActive = true;
                        Log.w(this.TAG, `Video DTS jumped backwards mid-batch (originalDts: ${originalDts} ms, ` +
                            `previous: ${previousOriginalDts} ms) — treating as timeline discontinuity, ` +
                            `re-anchoring on the continuous grid.`);
                    }
                }
            } else if (previousOriginalDts !== null) {
                this._videoBackwardJumpActive = false;
            }
            previousOriginalDts = originalDts;

            let isKeyframe = sample.isKeyframe;
            let dts = originalDts - dtsCorrection;
            let cts = sample.cts;
            let pts = dts + cts;

            if (firstDts === -1) {
                firstDts = dts;
                firstPts = pts;
            }

            let sampleDuration = 0;

            // The sample that measures this one's duration is the next in the
            // batch, else the one stashed for the next batch. Across a
            // discontinuity it belongs to another timeline and cannot measure
            // anything — that is what produced segments whose endDts preceded
            // their beginDts — so fall back to a known-good duration.
            let nextSample = (i !== samples.length - 1) ? samples[i + 1] : lastSample;
            if (nextSample != null && (nextSample.dts - sample.dts) <= -DTS_DISCONTINUITY_MS) {
                nextSample = null;
            }

            if (nextSample != null) {
                let nextDts = nextSample.dts - this._dtsBase - dtsCorrection;
                sampleDuration = nextDts - dts;
            } else if (mp4Samples.length >= 1) {  // use second last sample duration
                sampleDuration = mp4Samples[mp4Samples.length - 1].duration;
            } else {  // the only one sample, use reference sample duration
                sampleDuration = Math.floor(this._videoMeta.refSampleDuration);
            }

            if (isKeyframe) {
                let syncPoint = new SampleInfo(dts, pts, sampleDuration, sample.dts, true);
                syncPoint.fileposition = sample.fileposition;
                info.appendSyncPoint(syncPoint);
            }

            mp4Samples.push({
                dts: dts,
                pts: pts,
                cts: cts,
                units: sample.units,
                size: sample.length,
                isKeyframe: isKeyframe,
                duration: sampleDuration,
                originalDts: originalDts,
                flags: {
                    isLeading: 0,
                    dependsOn: isKeyframe ? 2 : 1,
                    isDependedOn: isKeyframe ? 1 : 0,
                    hasRedundancy: 0,
                    isNonSync: isKeyframe ? 0 : 1
                }
            });
        }

        // allocate mdatbox
        mdatbox = new Uint8Array(mdatBytes);
        mdatbox[0] = (mdatBytes >>> 24) & 0xFF;
        mdatbox[1] = (mdatBytes >>> 16) & 0xFF;
        mdatbox[2] = (mdatBytes >>>  8) & 0xFF;
        mdatbox[3] = (mdatBytes) & 0xFF;
        mdatbox.set(MP4.types.mdat, 4);

        // Write samples into mdatbox
        for (let i = 0; i < mp4Samples.length; i++) {
            let units = mp4Samples[i].units;
            while (units.length) {
                let unit = units.shift();
                let data = unit.data;
                mdatbox.set(data, offset);
                offset += data.byteLength;
            }
        }

        let latest = mp4Samples[mp4Samples.length - 1];
        lastDts = latest.dts + latest.duration;
        lastPts = latest.pts + latest.duration;
        this._videoNextDts = lastDts;

        // fill media segment info & add to info list
        info.beginDts = firstDts;
        info.endDts = lastDts;
        info.beginPts = firstPts;
        info.endPts = lastPts;
        info.originalBeginDts = mp4Samples[0].originalDts;
        info.originalEndDts = latest.originalDts + latest.duration;
        info.firstSample = new SampleInfo(mp4Samples[0].dts,
                                          mp4Samples[0].pts,
                                          mp4Samples[0].duration,
                                          mp4Samples[0].originalDts,
                                          mp4Samples[0].isKeyframe);
        info.lastSample = new SampleInfo(latest.dts,
                                         latest.pts,
                                         latest.duration,
                                         latest.originalDts,
                                         latest.isKeyframe);
        if (!this._isLive) {
            this._videoSegmentInfoList.append(info);
        }

        track.samples = mp4Samples;
        track.sequenceNumber++;

        // workaround for chrome < 50: force first sample as a random access point
        // see https://bugs.chromium.org/p/chromium/issues/detail?id=229412
        if (this._forceFirstIDR) {
            let flags = mp4Samples[0].flags;
            flags.dependsOn = 2;
            flags.isNonSync = 0;
        }

        let moofbox = MP4.moof(track, firstDts);
        track.samples = [];
        track.length = 0;

        this._onMediaSegment('video', {
            type: 'video',
            data: this._mergeBoxes(moofbox, mdatbox).buffer,
            sampleCount: mp4Samples.length,
            info: info
        });
    }

    _mergeBoxes(moof, mdat) {
        let result = new Uint8Array(moof.byteLength + mdat.byteLength);
        result.set(moof, 0);
        result.set(mdat, moof.byteLength);
        return result;
    }

}

export default MP4Remuxer;
