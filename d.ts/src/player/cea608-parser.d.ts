/**
 * CEA-608 Parser
 *
 * Ported from hls.js (https://github.com/video-dev/hls.js)
 * Originally from dash.js (https://github.com/Dash-Industry-Forum/dash.js)
 *
 * BSD License - Copyright (c) 2015-2016, DASH Industry Forum. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  1. Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  2. Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
export interface OutputFilter {
    newCue(startTime: number, endTime: number, screen: CaptionScreen): void;
    dispatchCue?(): void;
    reset(): void;
}
declare const enum VerboseLevel {
    ERROR = 0,
    TEXT = 1,
    WARNING = 2,
    INFO = 2,
    DEBUG = 3,
    DATA = 3
}
declare class CaptionsLogger {
    time: number | null;
    verboseLevel: VerboseLevel;
    log(severity: VerboseLevel, msg: string | (() => string)): void;
}
type PenStyles = {
    foreground: string | null;
    underline: boolean;
    italics: boolean;
    background: string;
    flash: boolean;
};
declare class PenState {
    foreground: string;
    underline: boolean;
    italics: boolean;
    background: string;
    flash: boolean;
    reset(): void;
    setStyles(styles: Partial<PenStyles>): void;
    isDefault(): boolean;
    equals(other: PenState): boolean;
    copy(newPenState: PenState): void;
}
declare class StyledUnicodeChar {
    uchar: string;
    penState: PenState;
    reset(): void;
    setChar(uchar: string, newPenState: PenState): void;
    setPenState(newPenState: PenState): void;
    equals(other: StyledUnicodeChar): boolean;
    copy(newChar: StyledUnicodeChar): void;
    isEmpty(): boolean;
}
export declare class Row {
    chars: StyledUnicodeChar[];
    pos: number;
    currPenState: PenState;
    cueStartTime: number | null;
    private logger;
    constructor(logger: CaptionsLogger);
    equals(other: Row): boolean;
    copy(other: Row): void;
    isEmpty(): boolean;
    setCursor(absPos: number): void;
    moveCursor(relPos: number): void;
    backSpace(): void;
    insertChar(byte: number): void;
    clearFromPos(startPos: number): void;
    clear(): void;
    clearToEndOfRow(): void;
    getTextString(): string;
    setPenStyles(styles: Partial<PenStyles>): void;
}
export declare class CaptionScreen {
    rows: Row[];
    currRow: number;
    nrRollUpRows: number | null;
    lastOutputScreen: CaptionScreen | null;
    logger: CaptionsLogger;
    constructor(logger: CaptionsLogger);
    reset(): void;
    equals(other: CaptionScreen): boolean;
    copy(other: CaptionScreen): void;
    isEmpty(): boolean;
    backSpace(): void;
    clearToEndOfRow(): void;
    insertChar(char: number): void;
    setPen(styles: Partial<PenStyles>): void;
    moveCursor(relPos: number): void;
    setCursor(absPos: number): void;
    setPAC(pacData: PACData): void;
    setBkgData(bkgData: Partial<PenStyles>): void;
    setRollUpRows(nrRows: number | null): void;
    rollUp(): void;
    getDisplayText(asOneRow?: boolean): string;
    getTextAndFormat(): Row[];
}
type CaptionModes = 'MODE_ROLL-UP' | 'MODE_POP-ON' | 'MODE_PAINT-ON' | 'MODE_TEXT' | null;
declare class Cea608Channel {
    chNr: number;
    outputFilter: OutputFilter;
    mode: CaptionModes;
    verbose: number;
    displayedMemory: CaptionScreen;
    nonDisplayedMemory: CaptionScreen;
    lastOutputScreen: CaptionScreen;
    currRollUpRow: Row;
    writeScreen: CaptionScreen;
    cueStartTime: number | null;
    logger: CaptionsLogger;
    constructor(channelNumber: number, outputFilter: OutputFilter, logger: CaptionsLogger);
    reset(): void;
    getHandler(): OutputFilter;
    setHandler(newHandler: OutputFilter): void;
    setPAC(pacData: PACData): void;
    setBkgData(bkgData: Partial<PenStyles>): void;
    setMode(newMode: CaptionModes): void;
    insertChars(chars: number[]): void;
    ccRCL(): void;
    ccBS(): void;
    ccAOF(): void;
    ccAON(): void;
    ccDER(): void;
    ccRU(nrRows: number | null): void;
    ccFON(): void;
    ccRDC(): void;
    ccTR(): void;
    ccRTD(): void;
    ccEDM(): void;
    ccCR(): void;
    ccENM(): void;
    ccEOC(): void;
    ccTO(nrCols: number): void;
    ccMIDROW(secondByte: number): void;
    outputDataUpdate(dispatch?: boolean): void;
    cueSplitAtTime(t: number): void;
}
interface PACData {
    row: number;
    indent: number | null;
    color: string | null;
    underline: boolean;
    italics: boolean;
}
type SupportedField = 1 | 3;
type Channels = 0 | 1 | 2;
type CmdHistory = {
    a: number | null;
    b: number | null;
};
declare class Cea608Parser {
    channels: Array<Cea608Channel | null>;
    currentChannel: Channels;
    cmdHistory: CmdHistory;
    logger: CaptionsLogger;
    constructor(field: SupportedField, out1: OutputFilter, out2: OutputFilter);
    getHandler(channel: number): OutputFilter;
    setHandler(channel: number, newHandler: OutputFilter): void;
    addData(time: number | null, byteList: number[]): void;
    parseCmd(a: number, b: number): boolean;
    parseMidrow(a: number, b: number): boolean;
    parsePAC(a: number, b: number): boolean;
    interpretPAC(row: number, byte: number): PACData;
    parseChars(a: number, b: number): number[] | null;
    parseBackgroundAttributes(a: number, b: number): boolean;
    reset(): void;
    cueSplitAtTime(t: number): void;
}
export default Cea608Parser;
