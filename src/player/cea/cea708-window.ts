/*
 * Ported from Shaka Player (lib/cea/cea708_window.js)
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Simplified for mpegts.js — outputs plain text instead of Shaka Cue objects.
 */

const MAX_ROWS = 16;
const MAX_COLS = 42;

export interface Cea708Caption {
    startTime: number;
    endTime: number;
    text: string;
    service: number;
}

export class Cea708Window {
    private visible = false;
    private defined = false;
    private rowCount = 0;
    private colCount = 0;
    private startTime = 0;
    private row = 0;
    private col = 0;
    private italics = false;
    private underline = false;
    private memory: (string | null)[][] = [];
    private serviceNumber: number;

    constructor(windowNum: number, serviceNumber: number) {
        this.serviceNumber = serviceNumber;
        this.resetMemory();
    }

    defineWindow(visible: boolean, _vAnchor: number, _hAnchor: number,
                 _anchorId: number, _relToggle: boolean,
                 rowCount: number, colCount: number): void {
        this.defined = true;
        this.visible = visible;
        this.rowCount = rowCount;
        this.colCount = colCount;
    }

    isDefined(): boolean { return this.defined; }

    resetMemory(): void {
        this.memory = [];
        for (let i = 0; i < MAX_ROWS; i++) {
            const row: (string | null)[] = [];
            for (let j = 0; j < MAX_COLS; j++) row.push(null);
            this.memory.push(row);
        }
    }

    setCharacter(char: string): void {
        if (this.row < 0 || this.row >= this.rowCount ||
            this.col < 0 || this.col >= this.colCount) return;
        this.memory[this.row][this.col] = char;
        this.col++;
    }

    backspace(): void {
        if (this.col <= 0 && this.row <= 0) return;
        if (this.col <= 0) {
            this.col = this.colCount - 1;
            this.row--;
        } else {
            this.col--;
        }
        this.memory[this.row][this.col] = null;
    }

    isVisible(): boolean { return this.visible; }

    carriageReturn(): void {
        if (this.row + 1 >= this.rowCount) {
            // Roll up: move rows up by 1
            for (let i = 1; i < MAX_ROWS; i++) {
                this.memory[i - 1] = this.memory[i];
            }
            const newRow: (string | null)[] = [];
            for (let j = 0; j < MAX_COLS; j++) newRow.push(null);
            this.memory[MAX_ROWS - 1] = newRow;
            this.col = 0;
            return;
        }
        this.row++;
        this.col = 0;
    }

    horizontalCarriageReturn(): void {
        const newRow: (string | null)[] = [];
        for (let j = 0; j < MAX_COLS; j++) newRow.push(null);
        this.memory[this.row] = newRow;
        this.col = 0;
    }

    forceEmit(endTime: number, serviceNumber: number): Cea708Caption | null {
        const lines: string[] = [];
        for (let i = 0; i < this.rowCount; i++) {
            let rowText = '';
            for (let j = 0; j < this.colCount; j++) {
                rowText += this.memory[i][j] || '';
            }
            const trimmed = rowText.trim();
            if (trimmed) lines.push(trimmed);
        }
        if (lines.length === 0) return null;
        const caption: Cea708Caption = {
            startTime: this.startTime,
            endTime,
            text: lines.join('\n'),
            service: serviceNumber,
        };
        this.setStartTime(endTime);
        return caption;
    }

    setPenLocation(row: number, col: number): void {
        this.row = row; this.col = col;
    }

    setPenItalics(v: boolean): void { this.italics = v; }
    setPenUnderline(v: boolean): void { this.underline = v; }
    setPenTextColor(_c: string): void { /* simplified */ }
    setPenBackgroundColor(_c: string): void { /* simplified */ }

    resetPen(): void {
        this.row = 0; this.col = 0;
        this.underline = false; this.italics = false;
    }

    setJustification(_j: number): void { /* simplified */ }
    display(): void { this.visible = true; }
    hide(): void { this.visible = false; }
    toggle(): void { this.visible = !this.visible; }
    setStartTime(pts: number): void { this.startTime = pts; }

    /** Get the current visible text in this window (live display). */
    getDisplayText(): string {
        if (!this.visible) return '';
        const lines: string[] = [];
        for (let i = 0; i < this.rowCount; i++) {
            let rowText = '';
            for (let j = 0; j < this.colCount; j++) {
                rowText += this.memory[i][j] || '';
            }
            const trimmed = rowText.trim();
            if (trimmed) lines.push(trimmed);
        }
        return lines.join('\n');
    }
}
