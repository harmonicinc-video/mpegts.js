export type WorkerCommandOp = 'logging_config' | 'init' | 'destroy' | 'initialize_mse' | 'shutdown_mse' | 'load' | 'unload' | 'unbuffered_seek' | 'timeupdate' | 'readystatechange' | 'pause_transmuxer' | 'resume_transmuxer' | 'set_audio_pid';
export type WorkerCommandPacket = {
    cmd: WorkerCommandOp;
};
export type WorkerCommandPacketInit = WorkerCommandPacket & {
    cmd: 'init';
    media_data_source: any;
    config: any;
};
export type WorkerCommandPacketLoggingConfig = WorkerCommandPacket & {
    cmd: 'logging_config';
    logging_config: any;
};
export type WorkerCommandPacketUnbufferedSeek = WorkerCommandPacket & {
    cmd: 'unbuffered_seek';
    milliseconds: number;
};
export type WorkerCommandPacketTimeUpdate = WorkerCommandPacket & {
    cmd: 'timeupdate';
    current_time: number;
};
export type WorkerCommandPacketReadyStateChange = WorkerCommandPacket & {
    cmd: 'readystatechange';
    ready_state: number;
};
export type WorkerCommandPacketSetAudioPID = WorkerCommandPacket & {
    cmd: 'set_audio_pid';
    pid: number;
};
