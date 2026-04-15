export interface Cea708Caption {
    startTime: number;
    endTime: number;
    text: string;
    service: number;
}
export declare class Cea708Window {
    private visible;
    private rowCount;
    private colCount;
    private startTime;
    private row;
    private col;
    private italics;
    private underline;
    private memory;
    private serviceNumber;
    constructor(windowNum: number, serviceNumber: number);
    defineWindow(visible: boolean, _vAnchor: number, _hAnchor: number, _anchorId: number, _relToggle: boolean, rowCount: number, colCount: number): void;
    resetMemory(): void;
    setCharacter(char: string): void;
    backspace(): void;
    isVisible(): boolean;
    carriageReturn(): void;
    horizontalCarriageReturn(): void;
    forceEmit(endTime: number, serviceNumber: number): Cea708Caption | null;
    setPenLocation(row: number, col: number): void;
    setPenItalics(v: boolean): void;
    setPenUnderline(v: boolean): void;
    setPenTextColor(_c: string): void;
    setPenBackgroundColor(_c: string): void;
    resetPen(): void;
    setJustification(_j: number): void;
    display(): void;
    hide(): void;
    toggle(): void;
    setStartTime(pts: number): void;
    /** Get the current visible text in this window (live display). */
    getDisplayText(): string;
}
