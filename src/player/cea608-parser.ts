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

import Log from '../utils/logger';

// OutputFilter interface — implemented by CaptionOutputFilter
export interface OutputFilter {
    newCue(startTime: number, endTime: number, screen: CaptionScreen): void;
    dispatchCue?(): void;
    reset(): void;
}

/**
 * Exceptions from regular ASCII. CodePoints are mapped to UTF-16 codes
 */
const specialCea608CharsCodes: Record<number, number> = {
    0x2a: 0xe1, 0x5c: 0xe9, 0x5e: 0xed, 0x5f: 0xf3,
    0x60: 0xfa, 0x7b: 0xe7, 0x7c: 0xf7, 0x7d: 0xd1,
    0x7e: 0xf1, 0x7f: 0x2588,
    0x80: 0xae, 0x81: 0xb0, 0x82: 0xbd, 0x83: 0xbf,
    0x84: 0x2122, 0x85: 0xa2, 0x86: 0xa3, 0x87: 0x266a,
    0x88: 0xe0, 0x89: 0x20, 0x8a: 0xe8, 0x8b: 0xe2,
    0x8c: 0xea, 0x8d: 0xee, 0x8e: 0xf4, 0x8f: 0xfb,
    0x90: 0xc1, 0x91: 0xc9, 0x92: 0xd3, 0x93: 0xda,
    0x94: 0xdc, 0x95: 0xfc, 0x96: 0x2018, 0x97: 0xa1,
    0x98: 0x2a, 0x99: 0x2019, 0x9a: 0x2501, 0x9b: 0xa9,
    0x9c: 0x2120, 0x9d: 0x2022, 0x9e: 0x201c, 0x9f: 0x201d,
    0xa0: 0xc0, 0xa1: 0xc2, 0xa2: 0xc7, 0xa3: 0xc8,
    0xa4: 0xca, 0xa5: 0xcb, 0xa6: 0xeb, 0xa7: 0xce,
    0xa8: 0xcf, 0xa9: 0xef, 0xaa: 0xd4, 0xab: 0xd9,
    0xac: 0xf9, 0xad: 0xdb, 0xae: 0xab, 0xaf: 0xbb,
    0xb0: 0xc3, 0xb1: 0xe3, 0xb2: 0xcd, 0xb3: 0xcc,
    0xb4: 0xec, 0xb5: 0xd2, 0xb6: 0xf2, 0xb7: 0xd5,
    0xb8: 0xf5, 0xb9: 0x7b, 0xba: 0x7d, 0xbb: 0x5c,
    0xbc: 0x5e, 0xbd: 0x5f, 0xbe: 0x7c, 0xbf: 0x223c,
    0xc0: 0xc4, 0xc1: 0xe4, 0xc2: 0xd6, 0xc3: 0xf6,
    0xc4: 0xdf, 0xc5: 0xa5, 0xc6: 0xa4, 0xc7: 0x2503,
    0xc8: 0xc5, 0xc9: 0xe5, 0xca: 0xd8, 0xcb: 0xf8,
    0xcc: 0x250f, 0xcd: 0x2513, 0xce: 0x2517, 0xcf: 0x251b,
};

const getCharForByte = (byte: number) =>
    String.fromCharCode(specialCea608CharsCodes[byte] || byte);

const NR_ROWS = 15;
const NR_COLS = 100;

const rowsLowCh1: Record<number, number> = {
    0x11: 1, 0x12: 3, 0x15: 5, 0x16: 7, 0x17: 9, 0x10: 11, 0x13: 12, 0x14: 14,
};
const rowsHighCh1: Record<number, number> = {
    0x11: 2, 0x12: 4, 0x15: 6, 0x16: 8, 0x17: 10, 0x13: 13, 0x14: 15,
};
const rowsLowCh2: Record<number, number> = {
    0x19: 1, 0x1a: 3, 0x1d: 5, 0x1e: 7, 0x1f: 9, 0x18: 11, 0x1b: 12, 0x1c: 14,
};
const rowsHighCh2: Record<number, number> = {
    0x19: 2, 0x1a: 4, 0x1d: 6, 0x1e: 8, 0x1f: 10, 0x1b: 13, 0x1c: 15,
};

const backgroundColors = [
    'white', 'green', 'blue', 'cyan', 'red', 'yellow', 'magenta', 'black', 'transparent',
];

const enum VerboseLevel { ERROR = 0, TEXT = 1, WARNING = 2, INFO = 2, DEBUG = 3, DATA = 3 }

class CaptionsLogger {
    public time: number | null = null;
    public verboseLevel: VerboseLevel = VerboseLevel.ERROR;

    log(severity: VerboseLevel, msg: string | (() => string)): void {
        if (this.verboseLevel >= severity) {
            const m: string = typeof msg === 'function' ? msg() : msg;
            Log.v('Cea608Parser', `${this.time} [${severity}] ${m}`);
        }
    }
}

const numArrayToHexArray = function (numArray: number[]): string[] {
    const hexArray: string[] = [];
    for (let j = 0; j < numArray.length; j++) {
        hexArray.push(numArray[j].toString(16));
    }
    return hexArray;
};

type PenStyles = {
    foreground: string | null;
    underline: boolean;
    italics: boolean;
    background: string;
    flash: boolean;
};

class PenState {
    public foreground: string = 'white';
    public underline: boolean = false;
    public italics: boolean = false;
    public background: string = 'black';
    public flash: boolean = false;

    reset() {
        this.foreground = 'white'; this.underline = false;
        this.italics = false; this.background = 'black'; this.flash = false;
    }

    setStyles(styles: Partial<PenStyles>) {
        const attribs = ['foreground', 'underline', 'italics', 'background', 'flash'];
        for (let i = 0; i < attribs.length; i++) {
            const style = attribs[i];
            if (styles.hasOwnProperty(style)) { this[style] = styles[style]; }
        }
    }

    isDefault() {
        return this.foreground === 'white' && !this.underline && !this.italics &&
            this.background === 'black' && !this.flash;
    }

    equals(other: PenState) {
        return this.foreground === other.foreground && this.underline === other.underline &&
            this.italics === other.italics && this.background === other.background &&
            this.flash === other.flash;
    }

    copy(newPenState: PenState) {
        this.foreground = newPenState.foreground; this.underline = newPenState.underline;
        this.italics = newPenState.italics; this.background = newPenState.background;
        this.flash = newPenState.flash;
    }
}

class StyledUnicodeChar {
    uchar: string = ' ';
    penState: PenState = new PenState();

    reset() { this.uchar = ' '; this.penState.reset(); }

    setChar(uchar: string, newPenState: PenState) {
        this.uchar = uchar; this.penState.copy(newPenState);
    }

    setPenState(newPenState: PenState) { this.penState.copy(newPenState); }

    equals(other: StyledUnicodeChar) {
        return this.uchar === other.uchar && this.penState.equals(other.penState);
    }

    copy(newChar: StyledUnicodeChar) {
        this.uchar = newChar.uchar; this.penState.copy(newChar.penState);
    }

    isEmpty(): boolean { return this.uchar === ' ' && this.penState.isDefault(); }
}

export class Row {
    public chars: StyledUnicodeChar[] = [];
    public pos: number = 0;
    public currPenState: PenState = new PenState();
    public cueStartTime: number | null = null;
    private logger: CaptionsLogger;

    constructor(logger: CaptionsLogger) {
        for (let i = 0; i < NR_COLS; i++) { this.chars.push(new StyledUnicodeChar()); }
        this.logger = logger;
    }

    equals(other: Row) {
        for (let i = 0; i < NR_COLS; i++) {
            if (!this.chars[i].equals(other.chars[i])) { return false; }
        }
        return true;
    }

    copy(other: Row) {
        for (let i = 0; i < NR_COLS; i++) { this.chars[i].copy(other.chars[i]); }
    }

    isEmpty(): boolean {
        for (let i = 0; i < NR_COLS; i++) {
            if (!this.chars[i].isEmpty()) { return false; }
        }
        return true;
    }

    setCursor(absPos: number) {
        if (this.pos !== absPos) { this.pos = absPos; }
        if (this.pos < 0) { this.pos = 0; }
        else if (this.pos >= NR_COLS) { this.pos = NR_COLS - 1; }
    }

    moveCursor(relPos: number) {
        const newPos = Math.min(this.pos + relPos, NR_COLS);
        if (relPos > 1) {
            for (let i = this.pos + 1; i < newPos; i++) {
                this.chars[i].setPenState(this.currPenState);
            }
        }
        this.setCursor(newPos);
    }

    backSpace() { this.moveCursor(-1); this.chars[this.pos].setChar(' ', this.currPenState); }

    insertChar(byte: number) {
        if (byte >= 0x90) { this.backSpace(); }
        const char = getCharForByte(byte);
        if (this.pos >= NR_COLS) { return; }
        this.chars[this.pos].setChar(char, this.currPenState);
        this.moveCursor(1);
    }

    clearFromPos(startPos: number) {
        for (let i = startPos; i < NR_COLS; i++) { this.chars[i].reset(); }
    }

    clear() { this.clearFromPos(0); this.pos = 0; this.currPenState.reset(); }

    clearToEndOfRow() { this.clearFromPos(this.pos); }

    getTextString() {
        const chars: string[] = [];
        let empty = true;
        for (let i = 0; i < NR_COLS; i++) {
            const char = this.chars[i].uchar;
            if (char !== ' ') { empty = false; }
            chars.push(char);
        }
        return empty ? '' : chars.join('');
    }

    setPenStyles(styles: Partial<PenStyles>) {
        this.currPenState.setStyles(styles);
        this.chars[this.pos].setPenState(this.currPenState);
    }
}

export class CaptionScreen {
    rows: Row[] = [];
    currRow: number = NR_ROWS - 1;
    nrRollUpRows: number | null = null;
    lastOutputScreen: CaptionScreen | null = null;
    logger: CaptionsLogger;

    constructor(logger: CaptionsLogger) {
        for (let i = 0; i < NR_ROWS; i++) { this.rows.push(new Row(logger)); }
        this.logger = logger;
    }

    reset() {
        for (let i = 0; i < NR_ROWS; i++) { this.rows[i].clear(); }
        this.currRow = NR_ROWS - 1;
    }

    equals(other: CaptionScreen): boolean {
        for (let i = 0; i < NR_ROWS; i++) {
            if (!this.rows[i].equals(other.rows[i])) { return false; }
        }
        return true;
    }

    copy(other: CaptionScreen) {
        for (let i = 0; i < NR_ROWS; i++) { this.rows[i].copy(other.rows[i]); }
    }

    isEmpty(): boolean {
        for (let i = 0; i < NR_ROWS; i++) {
            if (!this.rows[i].isEmpty()) { return false; }
        }
        return true;
    }

    backSpace() { this.rows[this.currRow].backSpace(); }
    clearToEndOfRow() { this.rows[this.currRow].clearToEndOfRow(); }
    insertChar(char: number) { this.rows[this.currRow].insertChar(char); }
    setPen(styles: Partial<PenStyles>) { this.rows[this.currRow].setPenStyles(styles); }
    moveCursor(relPos: number) { this.rows[this.currRow].moveCursor(relPos); }
    setCursor(absPos: number) { this.rows[this.currRow].setCursor(absPos); }

    setPAC(pacData: PACData) {
        let newRow = pacData.row - 1;
        if (this.nrRollUpRows && newRow < this.nrRollUpRows - 1) {
            newRow = this.nrRollUpRows - 1;
        }
        if (this.nrRollUpRows && this.currRow !== newRow) {
            for (let i = 0; i < NR_ROWS; i++) { this.rows[i].clear(); }
            const topRowIndex = this.currRow + 1 - this.nrRollUpRows;
            const lastOutputScreen = this.lastOutputScreen;
            if (lastOutputScreen) {
                const prevLineTime = lastOutputScreen.rows[topRowIndex].cueStartTime;
                const time = this.logger.time;
                if (prevLineTime !== null && time !== null && prevLineTime < time) {
                    for (let i = 0; i < this.nrRollUpRows; i++) {
                        this.rows[newRow - this.nrRollUpRows + i + 1].copy(
                            lastOutputScreen.rows[topRowIndex + i],
                        );
                    }
                }
            }
        }
        this.currRow = newRow;
        const row = this.rows[this.currRow];
        if (pacData.indent !== null) {
            const indent = pacData.indent;
            const prevPos = Math.max(indent - 1, 0);
            row.setCursor(pacData.indent);
            pacData.color = row.chars[prevPos].penState.foreground;
        }
        const styles: PenStyles = {
            foreground: pacData.color, underline: pacData.underline,
            italics: pacData.italics, background: 'black', flash: false,
        };
        this.setPen(styles);
    }

    setBkgData(bkgData: Partial<PenStyles>) {
        this.backSpace(); this.setPen(bkgData); this.insertChar(0x20);
    }

    setRollUpRows(nrRows: number | null) { this.nrRollUpRows = nrRows; }

    rollUp() {
        if (this.nrRollUpRows === null) { return; }
        const topRowIndex = this.currRow + 1 - this.nrRollUpRows;
        const topRow = this.rows.splice(topRowIndex, 1)[0];
        topRow.clear();
        this.rows.splice(this.currRow, 0, topRow);
    }

    getDisplayText(asOneRow?: boolean) {
        asOneRow = asOneRow || false;
        const displayText: string[] = [];
        for (let i = 0; i < NR_ROWS; i++) {
            const rowText = this.rows[i].getTextString();
            if (rowText) {
                if (asOneRow) { displayText.push('Row ' + (i + 1) + ": '" + rowText + "'"); }
                else { displayText.push(rowText.trim()); }
            }
        }
        if (displayText.length > 0) {
            return asOneRow ? '[' + displayText.join(' | ') + ']' : displayText.join('\n');
        }
        return '';
    }

    getTextAndFormat() { return this.rows; }
}

type CaptionModes = 'MODE_ROLL-UP' | 'MODE_POP-ON' | 'MODE_PAINT-ON' | 'MODE_TEXT' | null;

class Cea608Channel {
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

    constructor(channelNumber: number, outputFilter: OutputFilter, logger: CaptionsLogger) {
        this.chNr = channelNumber;
        this.outputFilter = outputFilter;
        this.mode = null;
        this.verbose = 0;
        this.displayedMemory = new CaptionScreen(logger);
        this.nonDisplayedMemory = new CaptionScreen(logger);
        this.lastOutputScreen = new CaptionScreen(logger);
        this.currRollUpRow = this.displayedMemory.rows[NR_ROWS - 1];
        this.writeScreen = this.displayedMemory;
        this.cueStartTime = null;
        this.logger = logger;
    }

    reset() {
        this.mode = null;
        this.displayedMemory.reset(); this.nonDisplayedMemory.reset();
        this.lastOutputScreen.reset(); this.outputFilter.reset();
        this.currRollUpRow = this.displayedMemory.rows[NR_ROWS - 1];
        this.writeScreen = this.displayedMemory;
        this.cueStartTime = null;
    }

    getHandler(): OutputFilter { return this.outputFilter; }
    setHandler(newHandler: OutputFilter) { this.outputFilter = newHandler; }
    setPAC(pacData: PACData) { this.writeScreen.setPAC(pacData); }
    setBkgData(bkgData: Partial<PenStyles>) { this.writeScreen.setBkgData(bkgData); }

    setMode(newMode: CaptionModes) {
        if (newMode === this.mode) { return; }
        this.mode = newMode;
        if (this.mode === 'MODE_POP-ON') {
            this.writeScreen = this.nonDisplayedMemory;
        } else {
            this.writeScreen = this.displayedMemory;
            this.writeScreen.reset();
        }
        if (this.mode !== 'MODE_ROLL-UP') {
            this.displayedMemory.nrRollUpRows = null;
            this.nonDisplayedMemory.nrRollUpRows = null;
        }
    }

    insertChars(chars: number[]) {
        for (let i = 0; i < chars.length; i++) { this.writeScreen.insertChar(chars[i]); }
        if (this.mode === 'MODE_PAINT-ON' || this.mode === 'MODE_ROLL-UP') {
            this.outputDataUpdate();
        }
    }

    ccRCL() { this.setMode('MODE_POP-ON'); }
    ccBS() {
        if (this.mode === 'MODE_TEXT') { return; }
        this.writeScreen.backSpace();
        if (this.writeScreen === this.displayedMemory) { this.outputDataUpdate(); }
    }
    ccAOF() {} ccAON() {}
    ccDER() { this.writeScreen.clearToEndOfRow(); this.outputDataUpdate(); }
    ccRU(nrRows: number | null) {
        this.writeScreen = this.displayedMemory;
        this.setMode('MODE_ROLL-UP');
        this.writeScreen.setRollUpRows(nrRows);
    }
    ccFON() { this.writeScreen.setPen({ flash: true }); }
    ccRDC() { this.setMode('MODE_PAINT-ON'); }
    ccTR() { this.setMode('MODE_TEXT'); }
    ccRTD() { this.setMode('MODE_TEXT'); }
    ccEDM() { this.displayedMemory.reset(); this.outputDataUpdate(true); }
    ccCR() { this.writeScreen.rollUp(); this.outputDataUpdate(true); }
    ccENM() { this.nonDisplayedMemory.reset(); }
    ccEOC() {
        if (this.mode === 'MODE_POP-ON') {
            const tmp = this.displayedMemory;
            this.displayedMemory = this.nonDisplayedMemory;
            this.nonDisplayedMemory = tmp;
            this.writeScreen = this.nonDisplayedMemory;
        }
        this.outputDataUpdate(true);
    }
    ccTO(nrCols: number) { this.writeScreen.moveCursor(nrCols); }

    ccMIDROW(secondByte: number) {
        const styles: Partial<PenStyles> = { flash: false };
        styles.underline = secondByte % 2 === 1;
        styles.italics = secondByte >= 0x2e;
        if (!styles.italics) {
            const colorIndex = Math.floor(secondByte / 2) - 0x10;
            const colors = ['white', 'green', 'blue', 'cyan', 'red', 'yellow', 'magenta'];
            styles.foreground = colors[colorIndex];
        } else {
            styles.foreground = 'white';
        }
        this.writeScreen.setPen(styles);
    }

    outputDataUpdate(dispatch: boolean = false) {
        const time = this.logger.time;
        if (time === null) { return; }
        if (this.outputFilter) {
            if (this.cueStartTime === null && !this.displayedMemory.isEmpty()) {
                this.cueStartTime = time;
            } else {
                if (!this.displayedMemory.equals(this.lastOutputScreen)) {
                    this.outputFilter.newCue(this.cueStartTime!, time, this.lastOutputScreen);
                    if (dispatch && this.outputFilter.dispatchCue) {
                        this.outputFilter.dispatchCue();
                    }
                    this.cueStartTime = this.displayedMemory.isEmpty() ? null : time;
                }
            }
            this.lastOutputScreen.copy(this.displayedMemory);
        }
    }

    cueSplitAtTime(t: number) {
        if (this.outputFilter) {
            if (!this.displayedMemory.isEmpty()) {
                if (this.outputFilter.newCue) {
                    this.outputFilter.newCue(this.cueStartTime!, t, this.displayedMemory);
                }
                this.cueStartTime = t;
            }
        }
    }
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
type CmdHistory = { a: number | null; b: number | null; };

class Cea608Parser {
    channels: Array<Cea608Channel | null>;
    currentChannel: Channels = 0;
    cmdHistory: CmdHistory = createCmdHistory();
    logger: CaptionsLogger;

    constructor(field: SupportedField, out1: OutputFilter, out2: OutputFilter) {
        const logger = (this.logger = new CaptionsLogger());
        this.channels = [
            null,
            new Cea608Channel(field, out1, logger),
            new Cea608Channel(field + 1, out2, logger),
        ];
    }

    getHandler(channel: number) { return (this.channels[channel] as Cea608Channel).getHandler(); }
    setHandler(channel: number, newHandler: OutputFilter) {
        (this.channels[channel] as Cea608Channel).setHandler(newHandler);
    }

    addData(time: number | null, byteList: number[]) {
        this.logger.time = time;
        for (let i = 0; i < byteList.length; i += 2) {
            const a = byteList[i] & 0x7f;
            const b = byteList[i + 1] & 0x7f;
            let cmdFound: boolean = false;
            let charsFound: number[] | null = null;

            if (a === 0 && b === 0) { continue; }

            const cmdHistory = this.cmdHistory;
            const isControlCode = a >= 0x10 && a <= 0x1f;
            if (isControlCode) {
                if (hasCmdRepeated(a, b, cmdHistory)) {
                    setLastCmd(null, null, cmdHistory);
                    continue;
                }
                setLastCmd(a, b, this.cmdHistory);
                cmdFound = this.parseCmd(a, b);
                if (!cmdFound) { cmdFound = this.parseMidrow(a, b); }
                if (!cmdFound) { cmdFound = this.parsePAC(a, b); }
                if (!cmdFound) { cmdFound = this.parseBackgroundAttributes(a, b); }
            } else {
                setLastCmd(null, null, cmdHistory);
            }
            if (!cmdFound) {
                charsFound = this.parseChars(a, b);
                if (charsFound) {
                    const currChNr = this.currentChannel;
                    if (currChNr && currChNr > 0) {
                        const channel = this.channels[currChNr] as Cea608Channel;
                        channel.insertChars(charsFound);
                    }
                }
            }
        }
    }

    parseCmd(a: number, b: number): boolean {
        const cond1 = (a === 0x14 || a === 0x1c || a === 0x15 || a === 0x1d) && b >= 0x20 && b <= 0x2f;
        const cond2 = (a === 0x17 || a === 0x1f) && b >= 0x21 && b <= 0x23;
        if (!(cond1 || cond2)) { return false; }

        const chNr = a === 0x14 || a === 0x15 || a === 0x17 ? 1 : 2;
        const channel = this.channels[chNr] as Cea608Channel;

        if (a === 0x14 || a === 0x15 || a === 0x1c || a === 0x1d) {
            if (b === 0x20) { channel.ccRCL(); }
            else if (b === 0x21) { channel.ccBS(); }
            else if (b === 0x22) { channel.ccAOF(); }
            else if (b === 0x23) { channel.ccAON(); }
            else if (b === 0x24) { channel.ccDER(); }
            else if (b === 0x25) { channel.ccRU(2); }
            else if (b === 0x26) { channel.ccRU(3); }
            else if (b === 0x27) { channel.ccRU(4); }
            else if (b === 0x28) { channel.ccFON(); }
            else if (b === 0x29) { channel.ccRDC(); }
            else if (b === 0x2a) { channel.ccTR(); }
            else if (b === 0x2b) { channel.ccRTD(); }
            else if (b === 0x2c) { channel.ccEDM(); }
            else if (b === 0x2d) { channel.ccCR(); }
            else if (b === 0x2e) { channel.ccENM(); }
            else if (b === 0x2f) { channel.ccEOC(); }
        } else {
            channel.ccTO(b - 0x20);
        }
        this.currentChannel = chNr as Channels;
        return true;
    }

    parseMidrow(a: number, b: number): boolean {
        let chNr: number = 0;
        if ((a === 0x11 || a === 0x19) && b >= 0x20 && b <= 0x2f) {
            chNr = a === 0x11 ? 1 : 2;
            if (chNr !== this.currentChannel) { return false; }
            const channel = this.channels[chNr];
            if (!channel) { return false; }
            channel.ccMIDROW(b);
            return true;
        }
        return false;
    }

    parsePAC(a: number, b: number): boolean {
        let row: number;
        const case1 = ((a >= 0x11 && a <= 0x17) || (a >= 0x19 && a <= 0x1f)) && b >= 0x40 && b <= 0x7f;
        const case2 = (a === 0x10 || a === 0x18) && b >= 0x40 && b <= 0x5f;
        if (!(case1 || case2)) { return false; }

        const chNr: Channels = a <= 0x17 ? 1 : 2;
        if (b >= 0x40 && b <= 0x5f) {
            row = chNr === 1 ? rowsLowCh1[a] : rowsLowCh2[a];
        } else {
            row = chNr === 1 ? rowsHighCh1[a] : rowsHighCh2[a];
        }
        const channel = this.channels[chNr];
        if (!channel) { return false; }
        channel.setPAC(this.interpretPAC(row, b));
        this.currentChannel = chNr;
        return true;
    }

    interpretPAC(row: number, byte: number): PACData {
        let pacIndex;
        const pacData: PACData = { color: null, italics: false, indent: null, underline: false, row: row };
        pacIndex = byte > 0x5f ? byte - 0x60 : byte - 0x40;
        pacData.underline = (pacIndex & 1) === 1;
        if (pacIndex <= 0xd) {
            pacData.color = ['white','green','blue','cyan','red','yellow','magenta','white'][Math.floor(pacIndex / 2)];
        } else if (pacIndex <= 0xf) {
            pacData.italics = true; pacData.color = 'white';
        } else {
            pacData.indent = Math.floor((pacIndex - 0x10) / 2) * 4;
        }
        return pacData;
    }

    parseChars(a: number, b: number): number[] | null {
        let channelNr: Channels;
        let charCodes: number[] | null = null;
        let charCode1: number | null = null;

        if (a >= 0x19) { channelNr = 2; charCode1 = a - 8; }
        else { channelNr = 1; charCode1 = a; }

        if (charCode1 >= 0x11 && charCode1 <= 0x13) {
            let oneCode;
            if (charCode1 === 0x11) { oneCode = b + 0x50; }
            else if (charCode1 === 0x12) { oneCode = b + 0x70; }
            else { oneCode = b + 0x90; }
            charCodes = [oneCode];
        } else if (a >= 0x20 && a <= 0x7f) {
            charCodes = b === 0 ? [a] : [a, b];
        }
        return charCodes;
    }

    parseBackgroundAttributes(a: number, b: number): boolean {
        const case1 = (a === 0x10 || a === 0x18) && b >= 0x20 && b <= 0x2f;
        const case2 = (a === 0x17 || a === 0x1f) && b >= 0x2d && b <= 0x2f;
        if (!(case1 || case2)) { return false; }

        const bkgData: Partial<PenStyles> = {};
        if (a === 0x10 || a === 0x18) {
            const index = Math.floor((b - 0x20) / 2);
            bkgData.background = backgroundColors[index];
            if (b % 2 === 1) { bkgData.background = bkgData.background + '_semi'; }
        } else if (b === 0x2d) {
            bkgData.background = 'transparent';
        } else {
            bkgData.foreground = 'black';
            if (b === 0x2f) { bkgData.underline = true; }
        }
        const chNr: Channels = a <= 0x17 ? 1 : 2;
        const channel: Cea608Channel = this.channels[chNr] as Cea608Channel;
        channel.setBkgData(bkgData);
        return true;
    }

    reset() {
        for (let i = 0; i < Object.keys(this.channels).length; i++) {
            const channel = this.channels[i];
            if (channel) { channel.reset(); }
        }
        setLastCmd(null, null, this.cmdHistory);
    }

    cueSplitAtTime(t: number) {
        for (let i = 0; i < this.channels.length; i++) {
            const channel = this.channels[i];
            if (channel) { channel.cueSplitAtTime(t); }
        }
    }
}

function setLastCmd(a: number | null, b: number | null, cmdHistory: CmdHistory) {
    cmdHistory.a = a; cmdHistory.b = b;
}

function hasCmdRepeated(a: number, b: number, cmdHistory: CmdHistory) {
    return cmdHistory.a === a && cmdHistory.b === b;
}

function createCmdHistory(): CmdHistory {
    return { a: null, b: null };
}

export default Cea608Parser;
