import { _decorator, AudioClip, AudioSource, Node, Enum, CCFloat, CCInteger } from 'cc';
import { Ply_Singleton } from './Ply_Singleton';
const { ccclass, property } = _decorator;

/**
 * Enum cac loai hieu ung am thanh (FX): moi file SFX trong assets/4.Sounds la mot loai.
 * Nhac nen (bgm.mp3) phat qua AudioSource `bgm1`.
 */
export enum FxType {
    TapTile = 0,
    CollectCombo = 1,
    CustomerDone = 2,
    StarToTable = 3,
    WaitAreaSlot = 4,
    DoorOpen = 5,
    LevelWin = 6,
    LevelLose = 7,
    ClockLast2s = 8,
    CustomerOut = 9,
}
Enum(FxType);

const FX_TYPE_COUNT = 10;

/**
 * Cau hinh du lieu am thanh.
 * Tuong duong voi class SoundData trong Unity gom AudioClip, volume va repeatCount.
 */
@ccclass('SoundData')
class SoundData {
    @property(AudioClip)
    clip: AudioClip | null = null;

    @property({ type: CCFloat, range: [0, 1], slide: true })
    volume: number = 1;

    @property(CCInteger)
    repeatCount: number = 1;
}

/**
 * Cau hinh FX Audio - moi truong la mot file SFX trong assets/4.Sounds (xem FX_FIELDS).
 */
@ccclass('FxAudio')
class FxAudio {
    @property({ type: SoundData, tooltip: 'SFX_Tap_Tile - Cham tile' })
    tapTile: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'SFX_Collect_Combo_01 - Hoan thanh combo' })
    collectCombo: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'SFX_Customer_Done - Khach hoan tat don' })
    customerDone: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'SFX_Star_To_Table - Sao bay ve ban' })
    starToTable: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'SFX_Wait_Area_Slot - Hieu ung o cho' })
    waitAreaSlot: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'SFX_Door_Open - Mo cua' })
    doorOpen: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'SFX_Level_Win - Thang level' })
    levelWin: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'SFX_Level_Lose - Thua level' })
    levelLose: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'Dong ho khach con 2 giay cuoi (tich tac / bao dong)' })
    clockLast2s: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'Khach het gio, gian bo di' })
    customerOut: SoundData = new SoundData();
}

/** Ten truong trong FxAudio theo tung FxType. */
const FX_FIELDS: Record<FxType, keyof FxAudio> = {
    [FxType.TapTile]: 'tapTile',
    [FxType.CollectCombo]: 'collectCombo',
    [FxType.CustomerDone]: 'customerDone',
    [FxType.StarToTable]: 'starToTable',
    [FxType.WaitAreaSlot]: 'waitAreaSlot',
    [FxType.DoorOpen]: 'doorOpen',
    [FxType.LevelWin]: 'levelWin',
    [FxType.LevelLose]: 'levelLose',
    [FxType.ClockLast2s]: 'clockLast2s',
    [FxType.CustomerOut]: 'customerOut',
};

/**
 * Quan ly am thanh duoc chuyen tu Unity Ply_SoundManager.
 * 
 * Cac diem khac biet chinh so voi Unity:
 * - Dung AudioSource component cua Cocos thay vi Unity AudioSource
 * - Dung schedule va callback kiem tra hang cho thay vi Coroutine
 * - Nhac nen (BGM) dung component AudioSource rieng gan qua Inspector
 * - Am thanh FX phat qua AudioSource.playOneShot() hoac play()
 */
@ccclass('Ply_SoundManager')
export class Ply_SoundManager extends Ply_Singleton {

    public static Ins: Ply_SoundManager | null = null;

    @property(FxAudio)
    fxAudio: FxAudio = new FxAudio();

    @property(AudioSource)
    bgm1: AudioSource | null = null;

    private fxSources: (AudioSource | null)[] = new Array(FX_TYPE_COUNT).fill(null);
    private queuedCount: number[] = new Array(FX_TYPE_COUNT).fill(0);
    private queueTimers: (number | null)[] = new Array(FX_TYPE_COUNT).fill(null);
    private sequenceSource: AudioSource | null = null;
    private burstSource: AudioSource | null = null;
    private sequence: FxType[] = [];
    private sequenceIndex = 0;
    private sequenceCallback: (() => void) | null = null;

    private isMute: boolean = false;

    onLoad() {
        super.onLoad();
        Ply_SoundManager.Ins = this;
    }

    /**
     * Phat am thanh hieu ung ngay lap tuc.
     * Neu dang phat, no se phat lai tu dau.
     */
    public playFx(fxType: FxType) {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        const index = fxType as number;
        if (!this.fxSources[index]) {
            this.fxSources[index] = this.createAudioSource(`SoundFX_${FxType[fxType]}`);
        }

        const source = this.fxSources[index]!;
        source.clip = data.clip;
        source.volume = data.volume;
        source.play();

        // Phat lap de tang am luong (giong xu ly trong Unity)
        for (let i = 1; i < data.repeatCount; i++) {
            source.playOneShot(data.clip, data.volume);
        }
    }

    /**
     * Sound thua (LevelLose): neu dang phat do thi DUNG ngay va phat lai tu dau.
     */
    public playFail(): void {
        if (this.isMute) return;
        const index = FxType.LevelLose as number;
        const src = this.fxSources[index];
        if (src && src.playing) src.stop();
        this.playFx(FxType.LevelLose);
    }

    /**
     * Phat am thanh hieu ung dang OneShot (khong cat dut am thanh dang phat, cho phep chong am).
     */
    public playFxOneShot(fxType: FxType, volumeScale: number = 1): void {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        const index = fxType as number;
        if (!this.fxSources[index]) {
            this.fxSources[index] = this.createAudioSource(`SoundFX_${FxType[fxType]}`);
        }

        const source = this.fxSources[index]!;
        source.playOneShot(data.clip, data.volume * volumeScale);
    }

    /**
     * Phat mot chum hieu ung am thanh don dap, chong lop len nhau (burst / stagger).
     * @param fxTypes Mot hoac nhieu loai FX (neu truyen mang se luan phien phat)
     * @param count So luong tieng phat ra
     * @param interval Khoang cach giua cac tieng (giay, mac dinh 0.04s)
     * @param volumeScale He so am luong (0..1)
     */
    public playBurstFx(
        fxTypes: FxType | readonly FxType[],
        count: number,
        interval: number = 0.04,
        volumeScale: number = 1,
    ): void {
        if (this.isMute || count <= 0) return;

        const types = Array.isArray(fxTypes) ? fxTypes : [fxTypes];
        if (types.length === 0) return;

        for (let i = 0; i < count; i++) {
            const delay = i * interval;
            const chosenType = types[i % types.length];
            const volMod = (0.85 + (i % 3) * 0.08) * volumeScale;

            if (delay <= 0) {
                this.playFxOneShot(chosenType, volMod);
            } else {
                this.scheduleOnce(() => {
                    this.playFxOneShot(chosenType, volMod);
                }, delay);
            }
        }
    }

    /**
     * Phat cac FX theo thu tu. FX sau chi bat dau khi FX truoc da phat xong.
     * Goi lai ham nay se huy sequence dang phat va thay bang sequence moi.
     */
    public playFxSequence(fxTypes: readonly FxType[]): void {
        this.stopFxSequence();
        if (this.isMute) return;

        this.sequence = fxTypes.filter((fxType) => {
            const data = this.getSoundData(fxType);
            return !!data?.clip;
        });
        this.sequenceIndex = 0;
        this.playNextFxInSequence();
    }

    private playNextFxInSequence(): void {
        if (this.isMute || this.sequenceIndex >= this.sequence.length) {
            this.stopFxSequence();
            return;
        }

        const fxType = this.sequence[this.sequenceIndex++];
        const data = this.getSoundData(fxType);
        if (!data?.clip) {
            this.playNextFxInSequence();
            return;
        }

        if (!this.sequenceSource) {
            this.sequenceSource = this.createAudioSource('SoundFX_Sequence');
        }

        this.sequenceSource.loop = false;
        this.sequenceSource.clip = data.clip;
        this.sequenceSource.volume = data.volume;
        this.sequenceSource.play();

        const callback = () => {
            if (!this.sequenceSource?.playing) {
                this.unschedule(callback);
                if (this.sequenceCallback === callback) this.sequenceCallback = null;
                this.playNextFxInSequence();
            }
        };
        this.sequenceCallback = callback;
        this.schedule(callback, 0.016);
    }

    /** Dung sequence FX dang phat. */
    public stopFxSequence(): void {
        if (this.sequenceCallback) {
            this.unschedule(this.sequenceCallback);
            this.sequenceCallback = null;
        }
        this.sequenceSource?.stop();
        this.sequence = [];
        this.sequenceIndex = 0;
    }

    /**
     * Phat am thanh hieu ung theo hang cho.
     * Neu dang phat, dua toi da 1 lan vao hang cho.
     * Neu ang ranh, phat ngay va bat dau kiem tra hang cho.
     */
    public playFxQueued(fxType: FxType) {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        const index = fxType as number;
        if (!this.fxSources[index]) {
            this.fxSources[index] = this.createAudioSource(`SoundFX_Queued_${FxType[fxType]}`);
        }

        const source = this.fxSources[index]!;
        source.clip = data.clip;
        source.volume = data.volume;

        if (source.playing) {
            // Neu đang phat, chi cho vao hang cho toi da 1 lan
            this.queuedCount[index] = 1;
        } else {
            // Neu ranh thi phat luon
            source.play();

            // Bat dau qua trinh kiem tra hang cho
            this.startQueueCheck(index);
        }
    }

    /**
     * Kiem tra hang cho dinh ky va phat am thanh tiep theo.
     * Thay the cho CheckQueueRoutine dung Coroutine trong Unity.
     */
    private startQueueCheck(index: number) {
        if (this.queueTimers[index] !== null) {
            this.unschedule(this.checkQueueCallback.bind(this, index));
        }

        const callback = () => {
            const source = this.fxSources[index];
            if (!source) {
                this.unschedule(callback);
                this.queueTimers[index] = null;
                return;
            }

            if (!source.playing) {
                if (this.queuedCount[index] > 0) {
                    this.queuedCount[index] = 0;
                    source.play();
                } else {
                    this.unschedule(callback);
                    this.queueTimers[index] = null;
                }
            }
        };

        this.schedule(callback, 0.016);
    }

    private checkQueueCallback(index: number) {
        // Callback giu tham chieu
    }

    /**
     * Phat am thanh hieu ung lặp lai (loop).
     */
    public playLoopFx(fxType: FxType) {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        const index = fxType as number;
        if (!this.fxSources[index]) {
            this.fxSources[index] = this.createAudioSource(`SoundFX_Loop_${FxType[fxType]}`);
        }

        const source = this.fxSources[index]!;
        source.clip = data.clip;
        source.volume = data.volume;
        source.loop = true;
        source.play();
    }

    /**
     * Dung mot am thanh hieu ung cu the.
     */
    public stopFx(fxType: FxType) {
        const index = fxType as number;
        if (index >= 0 && index < this.fxSources.length && this.fxSources[index]) {
            this.fxSources[index]!.stop();
        }
    }

    /**
     * Phat nhac nen.
     */
    public playBGM1() {
        if (this.isMute) return;
        if (this.bgm1 && !this.bgm1.playing) {
            this.bgm1.play();
        }
    }

    /**
     * Phat nhac nen (alias cho playBGM1).
     */
    public playBGM2() {
        this.playBGM1();
    }

    /**
     * Lay SoundData tuong ung voi FxType.
     */
    private getSoundData(type: FxType): SoundData | null {
        const field = FX_FIELDS[type];
        return field ? this.fxAudio[field] : null;
    }

    /**
     * Tat tieng chi rieng cac am thanh FX.
     */
    public muteFx() {
        this.isMute = true;
        this.stopFxSequence();
        for (let i = 0; i < this.fxSources.length; i++) {
            if (this.fxSources[i]) {
                this.fxSources[i]!.stop();
            }
        }
    }

    /**
     * Tat toan bo am thanh (BGM + FX).
     */
    public mute() {
        this.isMute = true;
        this.stopFxSequence();
        if (this.bgm1) this.bgm1.stop();
        for (let i = 0; i < this.fxSources.length; i++) {
            if (this.fxSources[i]) {
                this.fxSources[i]!.stop();
            }
        }
    }

    /**
     * Bat lai am thanh.
     */
    public unmute() {
        this.isMute = false;
    }

    /**
     * Dung toan bo am thanh (alias cho mute).
     */
    public stopAll(): void {
        this.mute();
    }

    /**
     * Phat nhac nen.
     */
    public playBGM(): void {
        this.playBGM1();
    }

    /**
     * Dung nhac nen.
     */
    public stopBGM(): void {
        if (this.bgm1) {
            this.bgm1.stop();
        }
    }

    /**
     * Phat am thanh theo FxType (alias cho playFx).
     */
    public playSound(fxType: FxType): void {
        this.playFx(fxType);
    }

    /**
     * Tao mot AudioSource component moi tren node con.
     */
    private createAudioSource(name: string): AudioSource {
        const audioNode = new Node(name);
        audioNode.setParent(this.node);
        return audioNode.addComponent(AudioSource);
    }

    /**
     * Phat am thanh FX ngat tieng cu: dung ngay am thanh dang phat tren kenh nay truoc khi phat am thanh moi.
     * Thich hop cho hieu ung burst/loop nhanh ma khong muon chong am lam on.
     */
    public playFxCutoff(fxType: FxType, volumeScale: number = 1): void {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        if (!this.burstSource) {
            this.burstSource = this.createAudioSource('SoundFX_Burst_Cutoff');
        }

        if (this.burstSource.playing) {
            this.burstSource.stop();
        }

        this.burstSource.loop = false;
        this.burstSource.clip = data.clip;
        this.burstSource.volume = data.volume * volumeScale;
        this.burstSource.play();
    }

    /**
     * Dung ngay am thanh dang phat tren kenh cutoff.
     */
    public stopFxCutoff(): void {
        if (this.burstSource && this.burstSource.playing) {
            this.burstSource.stop();
        }
    }

    onDestroy() {
        this.stopFxSequence();
        this.stopFxCutoff();
        super.onDestroy();
        if (Ply_SoundManager.Ins === this) {
            Ply_SoundManager.Ins = null;
        }
    }
}
