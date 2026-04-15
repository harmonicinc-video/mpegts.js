/*
 * Ported from Shaka Player (lib/cea/cea708_service.js)
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DtvccPacket } from './dtvcc-packet';
import { Cea708Window, Cea708Caption } from './cea708-window';

const EXT_CTRL_CODE = 0x10;

/** G2 extended character set */
const G2Charset: Map<number, string> = new Map([
    [0x20, ' '], [0x21, '\u00A0'], [0x25, '…'], [0x2a, 'Š'], [0x2c, 'Œ'],
    [0x30, '█'], [0x31, '\u2018'], [0x32, '\u2019'], [0x33, '\u201C'],
    [0x34, '\u201D'], [0x35, '•'], [0x39, '™'], [0x3a, 'š'], [0x3c, 'œ'],
    [0x3d, '\u2120'], [0x3f, 'Ÿ'], [0x76, '⅛'], [0x77, '⅜'], [0x78, '⅝'],
    [0x79, '⅞'], [0x7a, '│'], [0x7b, '┐'], [0x7c, '└'], [0x7d, '─'],
    [0x7e, '┘'], [0x7f, '┌'],
]);

export class Cea708Service {
    private serviceNumber: number;
    private windows: (Cea708Window | null)[] =
        [null, null, null, null, null, null, null, null];
    private currentWindow: Cea708Window | null = null;
    /** VLC-style: true when visible text has been written since last output */
    public textWaiting: boolean = false;
    /** Set to true when display should be refreshed (like VLC STATUS_OUTPUT) */
    public needsDisplay: boolean = false;

    constructor(serviceNumber: number) {
        this.serviceNumber = serviceNumber;
    }

    handleCea708ControlCode(pkt: DtvccPacket): Cea708Caption[] {
        const block = pkt.readByte();
        let cc = block.value;
        const pts = block.pts;

        if (cc === EXT_CTRL_CODE) {
            cc = (cc << 16) | pkt.readByte().value;
        }

        if (cc >= 0x00 && cc <= 0x1f) return this.handleC0(pkt, cc, pts);
        if (cc >= 0x80 && cc <= 0x9f) {
            // VLC: flush pending text before any C1 command
            if (this.textWaiting) {
                this.needsDisplay = true;
                this.textWaiting = false;
            }
            return this.handleC1(pkt, cc, pts);
        }
        if (cc >= 0x1000 && cc <= 0x101f) { this.handleC2(pkt, cc & 0xff); return []; }
        if (cc >= 0x1080 && cc <= 0x109f) { this.handleC3(pkt, cc & 0xff); return []; }
        if (cc >= 0x20 && cc <= 0x7f) this.handleG0(cc);
        else if (cc >= 0xa0 && cc <= 0xff) this.handleG1(cc);
        else if (cc >= 0x1020 && cc <= 0x107f) this.handleG2(cc & 0xff);
        else if (cc >= 0x10a0 && cc <= 0x10ff) this.handleG3(cc & 0xff);
        return [];
    }

    clear(): void {
        this.currentWindow = null;
        this.windows = [null, null, null, null, null, null, null, null];
    }

    /** Get combined text from all visible windows (live display). */
    getDisplayText(): string {
        const parts: string[] = [];
        for (const w of this.windows) {
            if (!w) continue;
            const t = w.getDisplayText();
            if (t) parts.push(t);
        }
        return parts.join('\n');
    }

    // --- Character groups ---

    private handleG0(cc: number): void {
        if (!this.currentWindow || !this.currentWindow.isDefined()) return;
        this.currentWindow.setCharacter(
            cc === 0x7f ? '♪' : String.fromCharCode(cc));
        // VLC: flush on space (word boundary)
        if (cc === 0x20 && this.textWaiting) {
            this.needsDisplay = true;
        }
        if (this.currentWindow.isVisible()) this.textWaiting = true;
    }

    private handleG1(cc: number): void {
        if (!this.currentWindow || !this.currentWindow.isDefined()) return;
        this.currentWindow.setCharacter(String.fromCharCode(cc));
        if (this.currentWindow.isVisible()) this.textWaiting = true;
    }

    private handleG2(cc: number): void {
        if (!this.currentWindow || !this.currentWindow.isDefined()) return;
        this.currentWindow.setCharacter(G2Charset.get(cc) || '_');
        if (this.currentWindow.isVisible()) this.textWaiting = true;
    }

    private handleG3(cc: number): void {
        if (!this.currentWindow || !this.currentWindow.isDefined()) return;
        this.currentWindow.setCharacter(cc === 0xa0 ? '[CC]' : '_');
        if (this.currentWindow.isVisible()) this.textWaiting = true;
    }

    // --- Control code groups ---

    private handleC0(pkt: DtvccPacket, cc: number, pts: number): Cea708Caption[] {
        if (!this.currentWindow || !this.currentWindow.isDefined()) {
            // Still need to consume P16 bytes
            if (cc === 0x18) { pkt.readByte(); pkt.readByte(); }
            return [];
        }
        if (cc === 0x18) {
            const b1 = pkt.readByte().value;
            const b2 = pkt.readByte().value;
            this.currentWindow.setCharacter(
                String.fromCharCode((b1 << 8) | b2));
            if (this.currentWindow.isVisible()) this.textWaiting = true;
            return [];
        }
        const w = this.currentWindow;
        let cap: Cea708Caption | null = null;
        switch (cc) {
            case 0x03:                              // ETX — End of Text
                if (this.textWaiting) {
                    this.needsDisplay = true;
                    this.textWaiting = false;
                }
                break;
            case 0x08:                              // BS
                w.backspace();
                this.textWaiting = true;
                break;
            case 0x0c:                              // FF
                if (w.isVisible()) cap = w.forceEmit(pts, this.serviceNumber);
                w.resetMemory(); w.setPenLocation(0, 0);
                this.textWaiting = true;
                this.needsDisplay = true;
                break;
            case 0x0d:                              // CR
                w.carriageReturn();
                if (w.isVisible()) {
                    this.needsDisplay = true;
                }
                break;
            case 0x0e:                              // HCR
                w.horizontalCarriageReturn();
                if (w.isVisible()) {
                    this.needsDisplay = true;
                }
                break;
        }
        return cap ? [cap] : [];
    }

    private handleC1(pkt: DtvccPacket, cmd: number, pts: number): Cea708Caption[] {
        if (cmd >= 0x80 && cmd <= 0x87) {
            // CWx — Set current window
            const wn = cmd & 0x07;
            if (this.windows[wn]) this.currentWindow = this.windows[wn];
        } else if (cmd === 0x88) {
            return this.clearWindows(pkt.readByte().value, pts);
        } else if (cmd === 0x89) {
            this.displayWindows(pkt.readByte().value, pts);
        } else if (cmd === 0x8a) {
            return this.hideWindows(pkt.readByte().value, pts);
        } else if (cmd === 0x8b) {
            return this.toggleWindows(pkt.readByte().value, pts);
        } else if (cmd === 0x8c) {
            return this.deleteWindows(pkt.readByte().value, pts);
        } else if (cmd === 0x8f) {
            return this.reset(pts);
        } else if (cmd === 0x90) {
            // SetPenAttributes — 2 bytes
            pkt.skip(1);
            const b2 = pkt.readByte().value;
            if (this.currentWindow) {
                this.currentWindow.setPenItalics((b2 & 0x80) > 0);
                this.currentWindow.setPenUnderline((b2 & 0x40) > 0);
            }
        } else if (cmd === 0x91) {
            // SetPenColor — 3 bytes
            pkt.skip(3);
        } else if (cmd === 0x92) {
            // SetPenLocation — 2 bytes
            const b1 = pkt.readByte().value;
            const b2 = pkt.readByte().value;
            if (this.currentWindow) {
                this.currentWindow.setPenLocation(b1 & 0x0f, b2 & 0x3f);
            }
        } else if (cmd === 0x97) {
            // SetWindowAttributes — 4 bytes
            pkt.skip(4);
        } else if (cmd >= 0x98 && cmd <= 0x9f) {
            this.defineWindow(pkt, (cmd & 0x0f) - 8, pts);
        }
        return [];
    }

    private handleC2(pkt: DtvccPacket, cc: number): void {
        if (cc >= 0x08 && cc <= 0x0f) pkt.skip(1);
        else if (cc >= 0x10 && cc <= 0x17) pkt.skip(2);
        else if (cc >= 0x18 && cc <= 0x1f) pkt.skip(3);
    }

    private handleC3(pkt: DtvccPacket, cc: number): void {
        if (cc >= 0x80 && cc <= 0x87) pkt.skip(4);
        else if (cc >= 0x88 && cc <= 0x8f) pkt.skip(5);
    }

    // --- Window commands ---

    private getWindowIds(bitmap: number): number[] {
        const ids: number[] = [];
        for (let i = 0; i < 8; i++) {
            if ((bitmap & 0x01) && this.windows[i]) ids.push(i);
            bitmap >>= 1;
        }
        return ids;
    }

    private clearWindows(bm: number, pts: number): Cea708Caption[] {
        const caps: Cea708Caption[] = [];
        for (const id of this.getWindowIds(bm)) {
            const w = this.windows[id]!;
            if (w.isVisible()) {
                const c = w.forceEmit(pts, this.serviceNumber);
                if (c) caps.push(c);
            }
            w.resetMemory();
        }
        return caps;
    }

    private displayWindows(bm: number, pts: number): void {
        for (const id of this.getWindowIds(bm)) {
            const w = this.windows[id]!;
            if (!w.isVisible()) w.setStartTime(pts);
            w.display();
        }
    }

    private hideWindows(bm: number, pts: number): Cea708Caption[] {
        const caps: Cea708Caption[] = [];
        for (const id of this.getWindowIds(bm)) {
            const w = this.windows[id]!;
            if (w.isVisible()) {
                const c = w.forceEmit(pts, this.serviceNumber);
                if (c) caps.push(c);
            }
            w.hide();
        }
        return caps;
    }

    private toggleWindows(bm: number, pts: number): Cea708Caption[] {
        const caps: Cea708Caption[] = [];
        for (const id of this.getWindowIds(bm)) {
            const w = this.windows[id]!;
            if (w.isVisible()) {
                const c = w.forceEmit(pts, this.serviceNumber);
                if (c) caps.push(c);
            } else {
                w.setStartTime(pts);
            }
            w.toggle();
        }
        return caps;
    }

    private deleteWindows(bm: number, pts: number): Cea708Caption[] {
        const caps: Cea708Caption[] = [];
        for (const id of this.getWindowIds(bm)) {
            const w = this.windows[id]!;
            if (w.isVisible()) {
                const c = w.forceEmit(pts, this.serviceNumber);
                if (c) caps.push(c);
            }
            this.windows[id] = null;
        }
        return caps;
    }

    private reset(pts: number): Cea708Caption[] {
        const caps = this.deleteWindows(0xff, pts);
        this.clear();
        return caps;
    }

    private defineWindow(pkt: DtvccPacket, wn: number, pts: number): void {
        if (!this.windows[wn]) {
            this.windows[wn] = new Cea708Window(wn, this.serviceNumber);
            this.windows[wn]!.setStartTime(pts);
        }
        const b1 = pkt.readByte().value;
        const b2 = pkt.readByte().value;
        const b3 = pkt.readByte().value;
        const b4 = pkt.readByte().value;
        const b5 = pkt.readByte().value;
        const b6 = pkt.readByte().value;
        const visible = (b1 & 0x20) > 0;
        const vAnchor = b2 & 0x7f;
        const relToggle = (b2 & 0x80) > 0;
        const hAnchor = b3;
        const rowCount = (b4 & 0x0f) + 1;
        const colCount = (b5 & 0x3f) + 1;
        const penStyle = b6 & 0x07;
        const existed = this.windows[wn] !== null;
        if (!existed || penStyle !== 0) {
            this.windows[wn]!.resetPen();
        }
        this.windows[wn]!.defineWindow(
            visible, vAnchor, hAnchor, 0, relToggle, rowCount, colCount);
        this.currentWindow = this.windows[wn];
    }
}
