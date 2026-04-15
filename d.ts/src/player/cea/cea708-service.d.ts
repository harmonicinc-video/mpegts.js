import { DtvccPacket } from './dtvcc-packet';
import { Cea708Caption } from './cea708-window';
export declare class Cea708Service {
    private serviceNumber;
    private windows;
    private currentWindow;
    constructor(serviceNumber: number);
    handleCea708ControlCode(pkt: DtvccPacket): Cea708Caption[];
    clear(): void;
    /** Get combined text from all visible windows (live display). */
    getDisplayText(): string;
    private handleG0;
    private handleG1;
    private handleG2;
    private handleG3;
    private handleC0;
    private handleC1;
    private handleC2;
    private handleC3;
    private getWindowIds;
    private clearWindows;
    private displayWindows;
    private hideWindows;
    private toggleWindows;
    private deleteWindows;
    private reset;
    private defineWindow;
}
