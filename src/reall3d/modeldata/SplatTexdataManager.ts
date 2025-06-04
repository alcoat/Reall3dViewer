// ==============================================
// Copyright (c) 2025 reall3d.com, MIT license
// ==============================================
import { Matrix4, Vector3, Vector4 } from 'three';
import {
    OnFetchStart,
    SplatTexdataManagerDispose,
    SplatTexdataManagerAddModel,
    GetMaxRenderCount,
    SplatMeshCycleZoom,
    SplatTexdataManagerDataChanged,
    OnFetching,
    OnFetchStop,
    Information,
    IsBigSceneMode,
    SetGaussianText,
    GetGaussianText,
    RunLoopByFrame,
    UploadSplatTexture,
    SplatUpdateTopY,
    GetSplatActivePoints,
    GetOptions,
    StopAutoRotate,
    GetShTexheight,
    SplatUpdateSh12Texture,
    SplatUpdateSh3Texture,
    GetModelShDegree,
    SplatUpdateShDegree,
    GetAabbCenter,
    UploadSplatTextureDone,
    GetViewProjectionMatrix,
    GetCameraPosition,
    GetCameraLookAt,
    IsCameraChangedNeedUpdate,
} from '../events/EventConstants';
import { Events } from '../events/Events';
import { CutData, MetaData, ModelStatus, SplatModel } from './ModelData';
import { ModelOptions } from './ModelOptions';
import { loadPly } from './loaders/PlyLoader';
import { loadSplat } from './loaders/SplatLoader';
import { loadSpx } from './loaders/SpxLoader';
import { loadSpz } from './loaders/SpzLoader';
import { isNeedReload } from '../utils/CommonUtils';
import { SplatMeshOptions } from '../meshs/splatmesh/SplatMeshOptions';
import { isMobile, MobileDownloadLimitSplatCount, PcDownloadLimitSplatCount } from '../utils/consts/GlobalConstants';

export function setupSplatTextureManager(events: Events) {
    const on = (key: number, fn?: Function, multiFn?: boolean): Function | Function[] => events.on(key, fn, multiFn);
    const fire = (key: number, ...args: any): any => events.fire(key, ...args);

    let disposed: boolean;
    let lastPostDataTime: number = Date.now() + 60 * 60 * 1000;

    let textWatermarkData: Uint8Array = null; // 水印数据
    let splatModel: SplatModel;
    let texture0: SplatTexdata = { index: 0, version: 0 };
    let texture1: SplatTexdata = { index: 1, version: 0 };
    let mergeRunning: boolean = false;
    const isBigSceneMode: boolean = fire(IsBigSceneMode);

    on(GetAabbCenter, () => splatModel?.aabbCenter || new Vector3());

    let fnResolveModelSplatCount: (value: unknown) => void;
    const promiseModelSplatCount: Promise<number> = new Promise(resolve => (fnResolveModelSplatCount = resolve));
    on(GetMaxRenderCount, async (): Promise<number> => {
        const opts: SplatMeshOptions = fire(GetOptions);
        let rs = isMobile ? opts.maxRenderCountOfMobile : opts.maxRenderCountOfPc;
        if (!opts.bigSceneMode) {
            let modelCnt = await promiseModelSplatCount;
            rs = Math.min(modelCnt, rs) + 10240; // 小场景如果模型数据点数小于最大渲染数，用模型数据点数计算以节省内存，10240为预留的动态文字水印数
        }
        return rs;
    });

    on(GetShTexheight, async (shDegree: number): Promise<number> => {
        const opts: SplatMeshOptions = fire(GetOptions);
        if (opts.bigSceneMode) return 1; // 大场景不支持

        let cnt = isMobile ? opts.maxRenderCountOfMobile : opts.maxRenderCountOfPc;
        let modelCnt = await promiseModelSplatCount;
        cnt = Math.min(modelCnt, cnt);

        if (!splatModel.dataShDegree) return 1; // splat
        if (shDegree >= 3) {
            if (splatModel.dataShDegree < 3) return 1; // 无SH3数据
        } else if (shDegree >= 1) {
            if (splatModel.dataShDegree < 1) return 1; // 无SH12数据
        } else {
            return 1;
        }

        const texwidth = 1024 * 2;
        const texheight = Math.ceil(cnt / texwidth);
        return texheight;
    });

    on(GetModelShDegree, async (): Promise<number> => {
        const opts: SplatMeshOptions = fire(GetOptions);
        if (opts.bigSceneMode) return 0; // 大场景不支持

        await promiseModelSplatCount;
        return splatModel.dataShDegree;
    });

    on(SetGaussianText, async (text: string, isY: boolean = true) => {
        try {
            await promiseModelSplatCount;
            const isNgativeY = !!splatModel.header?.Flag2; // Flag2为非0时视为倒立（superedit打开呈现倒立）
            textWatermarkData = await fire(GetGaussianText, text, isY, isNgativeY);
            splatModel && (splatModel.textWatermarkVersion = Date.now());
        } catch (e) {
            console.info('failed to generate watermark');
        }
    });

    on(UploadSplatTextureDone, (index: number) => {
        if (isBigSceneMode) {
            if (index) {
                !texture1.active && (texture1.activeTime = Date.now());
                texture1.active = true;
            } else {
                !texture0.active && (texture0.activeTime = Date.now());
                texture0.active = true;
            }
        }
    });

    on(GetSplatActivePoints, () => {
        // 大场景按动态计算
        if (isBigSceneMode) return texture0.version <= texture1.version ? texture0.xyz : texture1.xyz;

        // 小场景下载完成后按分块
        if (splatModel?.status === ModelStatus.FetchDone || splatModel?.status === ModelStatus.FetchAborted) {
            if (splatModel.activePoints && splatModel.activePoints.length === undefined) return splatModel.activePoints;
            const obj = {};
            const xyzs: Float32Array = texture0.xyz;
            for (let i = 0, count = xyzs.length / 3, x = 0, y = 0, z = 0, key = ''; i < count; i++) {
                x = xyzs[i * 3];
                y = xyzs[i * 3 + 1];
                z = xyzs[i * 3 + 2];
                key = `${Math.floor(x / 2) * 2 + 1},${Math.floor(y / 2) * 2 + 1},${Math.floor(z / 2) * 2 + 1}`;
                (obj[key] = obj[key] || []).push(x, y, z);
            }
            return (splatModel.activePoints = obj);
        }

        // 小场景没下载完，不分块
        return texture0.xyz;
    });

    async function mergeAndUploadData(isBigSceneMode: boolean) {
        if (disposed) return;
        if (splatModel && (splatModel.status === ModelStatus.Invalid || splatModel.status === ModelStatus.FetchFailed)) {
            (fire(GetOptions) as SplatMeshOptions).viewerEvents?.fire(StopAutoRotate);
            return fire(OnFetchStop, 0) || fire(Information, { renderSplatCount: 0, visibleSplatCount: 0, modelSplatCount: 0 }); // 无效
        }
        if (!splatModel || !splatModel.downloadSize) return; // 尚未下载

        const downloadDone = splatModel.status !== ModelStatus.FetchReady && splatModel.status !== ModelStatus.Fetching;
        if (downloadDone) {
            // 已下载完，通知一次进度条
            const downloadCount = Math.min(splatModel.fetchLimit, splatModel.downloadSplatCount);
            !splatModel.notifyFetchStopDone && (splatModel.notifyFetchStopDone = true) && fire(OnFetchStop, downloadCount);
        } else {
            // 没下载完，更新下载进度条
            fire(OnFetching, (100 * splatModel.downloadSize) / splatModel.fileSize);
        }

        if (!splatModel.downloadSplatCount) return; // 尚无高斯数据

        if (mergeRunning) return;
        mergeRunning = true;
        setTimeout(async () => {
            isBigSceneMode ? await mergeAndUploadLargeSceneData(downloadDone) : await mergeAndUploadSmallSceneData(downloadDone);
            mergeRunning = false;
        });
    }

    async function mergeAndUploadSmallSceneData(downloadDone: boolean) {
        if (disposed) return;
        const texture = texture0;
        const maxRenderCount = await fire(GetMaxRenderCount);

        const txtWatermarkData = textWatermarkData;
        let dataSplatCount = splatModel.dataSplatCount;
        let watermarkCount = downloadDone ? splatModel.watermarkCount : 0;
        let textWatermarkCount = splatModel.meta.showWatermark && downloadDone ? (txtWatermarkData?.byteLength || 0) / 32 : 0; // 动态输入的文字水印数
        splatModel.renderSplatCount = dataSplatCount + watermarkCount + textWatermarkCount; // 渲染数

        if (splatModel.renderSplatCount >= maxRenderCount) {
            // 中断下载等特殊情况
            splatModel.renderSplatCount = maxRenderCount;
            watermarkCount = 0;
            textWatermarkCount = 0;
            dataSplatCount > maxRenderCount && (dataSplatCount = maxRenderCount);
        }

        fire(Information, { visibleSplatCount: splatModel.renderSplatCount, modelSplatCount: splatModel.modelSplatCount + textWatermarkCount }); // 可见数=模型数据总点数

        if (Date.now() - texture.textureReadyTime < (isMobile ? 600 : 300)) return; // 悠哉
        if (splatModel.smallSceneUploadDone && splatModel.lastTextWatermarkVersion == splatModel.textWatermarkVersion) return; // 已传完(模型数据 + 动态文字水印)

        if (!texture.version) {
            fire(SplatUpdateTopY, (splatModel.header?.Flag2 ? splatModel.header.MaxTopY : splatModel.header?.MinTopY) || 0); // 初次传入高点

            let ver: string = splatModel.opts.format;
            if (splatModel.opts.format == 'spx') {
                ver = 'spx' + (splatModel.header.ExclusiveId ? (' ' + splatModel.header.ExclusiveId).substring(0, 6) : '');
            }
            fire(Information, { scene: `small (${ver})` }); // 初次提示场景模型版本
        }

        splatModel.lastTextWatermarkVersion = splatModel.textWatermarkVersion;
        texture.textureReady = false;

        // 合并（模型数据 + 动态文字水印）
        const texwidth = 1024 * 2;
        const texheight = Math.ceil((2 * maxRenderCount) / texwidth);

        const ui32s = new Uint32Array(texwidth * texheight * 4);
        const f32s = new Float32Array(ui32s.buffer);
        const mergeSplatData = new Uint8Array(ui32s.buffer);
        mergeSplatData.set(splatModel.splatData.slice(0, dataSplatCount * 32), 0);
        watermarkCount && mergeSplatData.set(splatModel.watermarkData.slice(0, watermarkCount * 32), dataSplatCount * 32);
        textWatermarkCount && mergeSplatData.set(txtWatermarkData.slice(0, textWatermarkCount * 32), (dataSplatCount + watermarkCount) * 32);

        const xyz = new Float32Array(splatModel.renderSplatCount * 3);
        for (let i = 0, n = 0; i < splatModel.renderSplatCount; i++) {
            xyz[i * 3] = f32s[i * 8];
            xyz[i * 3 + 1] = f32s[i * 8 + 1];
            xyz[i * 3 + 2] = f32s[i * 8 + 2];
        }

        const sysTime = Date.now();
        texture.version = sysTime;
        texture.txdata = ui32s;
        texture.xyz = xyz;
        texture.renderSplatCount = splatModel.renderSplatCount;
        texture.visibleSplatCount = splatModel.downloadSplatCount + textWatermarkCount;
        texture.modelSplatCount = splatModel.downloadSplatCount + textWatermarkCount;
        texture.watermarkCount = watermarkCount + textWatermarkCount;
        texture.minX = splatModel.minX;
        texture.maxX = splatModel.maxX;
        texture.minY = splatModel.minY;
        texture.maxY = splatModel.maxY;
        texture.minZ = splatModel.minZ;
        texture.maxZ = splatModel.maxZ;

        // TODO MaxRadius?
        fire(UploadSplatTexture, texture, splatModel.currentRadius, splatModel.currentRadius);
        lastPostDataTime = sysTime;

        if (downloadDone && !splatModel.smallSceneUploadDone) {
            splatModel.smallSceneUploadDone = true;
            fire(SplatUpdateSh12Texture, splatModel.sh12Data);
            fire(SplatUpdateSh3Texture, splatModel.sh3Data);
            splatModel.sh12Data = null;
            splatModel.sh3Data = null;
            const opts: SplatMeshOptions = fire(GetOptions);
            fire(SplatUpdateShDegree, opts.shDegree === undefined ? 3 : opts.shDegree);
            fire(GetSplatActivePoints); // 小场景下载完时主动触发一次坐标分块
        }
        fire(Information, { renderSplatCount: splatModel.renderSplatCount });
    }

    async function mergeAndUploadLargeSceneData(downloadDone: boolean) {
        if (disposed) return;

        const maxRenderCount = await fire(GetMaxRenderCount);
        const texwidth = 1024 * 2;
        const texheight = Math.ceil((2 * maxRenderCount) / texwidth);
        const txtWatermarkData = textWatermarkData;
        const watermarkCount = 0; // model.watermarkCount; // 待合并的水印数（模型数据部分）
        const textWatermarkCount = (txtWatermarkData?.byteLength || 0) / 32; // 待合并的水印数（可动态变化的文字水印部分）
        const maxDataMergeCount = maxRenderCount - watermarkCount - textWatermarkCount; // 最大数据合并点数

        fire(Information, { modelSplatCount: splatModel.downloadSplatCount + textWatermarkCount });

        let texture: SplatTexdata = texture0.version <= texture1.version ? texture0 : texture1;
        if (texture0.version && ((!texture.index && !texture1.active) || (texture.index && !texture0.active))) return; // 待渲染
        if (Date.now() - texture.activeTime < (isMobile ? 400 : 200)) return;

        if (downloadDone) {
            // 文件下载完，相机没有变化，不必重复刷数据
            const ve = (fire(GetOptions) as SplatMeshOptions).viewerEvents;
            if (ve && !ve.fire(IsCameraChangedNeedUpdate)) return;
        }

        if (!texture.version) {
            let ver: string = splatModel.opts.format;
            if (splatModel.opts.format == 'spx') {
                ver = 'spx' + (splatModel.header.ExclusiveId ? (' ' + splatModel.header.ExclusiveId).substring(0, 6) : '');
            }
            fire(Information, { scene: `large (${ver})` }); // 初次提示场景模型版本
        }

        const sysTime = Date.now();
        texture.version = sysTime;
        texture.active = false;

        // 计算合并
        let currentTotalVisibleCnt = 0; // 当前可见块的总数据点数
        const cuts: CutData[] = [];
        const viewProjMatrix: Matrix4 = fire(GetViewProjectionMatrix);
        const cameraPosition: Vector3 = fire(GetCameraPosition);
        const cameraTarget: Vector3 = fire(GetCameraLookAt);
        for (const cut of splatModel.map.values()) {
            if (checkCutDataVisible(viewProjMatrix, cameraPosition, cameraTarget, cut)) {
                cuts.push(cut);
                cut.currentRenderCnt = cut.splatCount;
                currentTotalVisibleCnt += cut.splatCount;
            }
        }

        fire(Information, { cuts: `${cuts.length} / ${splatModel.map.size}` });

        const perLimit = Math.min(maxDataMergeCount / currentTotalVisibleCnt, 1); // 最大不超100%
        if (perLimit > 0.95) {
            // 最大合并数占比大于95%时按比例简化概算
            for (const cut of cuts) cut.currentRenderCnt = (cut.splatCount * perLimit) | 0;
        } else {
            // 占比较小时按距离计算
            cuts.sort((a, b) => a.distance - b.distance);
            // 微调
            for (const cut of cuts) {
                if (cut.distance < 5) {
                    cut.distance *= 0.5;
                } else if (cut.distance < 4) {
                    cut.distance *= 0.4;
                } else if (cut.distance < 3) {
                    cut.distance *= 0.3;
                } else if (cut.distance < 2) {
                    cut.distance *= 0.1;
                }
            }
            // 分配
            allocatePoints(cuts, maxDataMergeCount);

            // 检查、调整
            let totalCurrentRenderCnt = 0;
            for (let cut of cuts) totalCurrentRenderCnt += cut.currentRenderCnt;

            if (totalCurrentRenderCnt > maxDataMergeCount) {
                // 检查
                let delCnt = totalCurrentRenderCnt - maxDataMergeCount;
                for (let i = cuts.length - 1; i >= 0; i--) {
                    if (delCnt <= 0) break;
                    const cut = cuts[i];
                    if (cut.currentRenderCnt >= delCnt) {
                        cut.currentRenderCnt -= delCnt;
                        delCnt = 0;
                    } else {
                        delCnt -= cut.currentRenderCnt;
                        cut.currentRenderCnt = 0;
                    }
                }
            } else if (totalCurrentRenderCnt < maxDataMergeCount) {
                // 调整
                let addCnt = maxDataMergeCount - totalCurrentRenderCnt;
                for (let i = 0; i < cuts.length; i++) {
                    if (addCnt <= 0) break;
                    let cut = cuts[i];
                    if (cut.splatCount > cut.currentRenderCnt) {
                        if (cut.splatCount - cut.currentRenderCnt >= addCnt) {
                            cut.currentRenderCnt += addCnt;
                            addCnt = 0;
                        } else {
                            const add = cut.splatCount - cut.currentRenderCnt;
                            cut.currentRenderCnt += add;
                            addCnt -= add;
                        }
                    }
                }
            }
        }

        // 合并
        const ui32s = new Uint32Array(texwidth * texheight * 4);
        const f32s = new Float32Array(ui32s.buffer);
        const mergeSplatData = new Uint8Array(ui32s.buffer);
        let mergeDataCount = 0;
        for (let cut of cuts) {
            mergeSplatData.set(cut.splatData.slice(0, cut.currentRenderCnt * 32), mergeDataCount * 32);
            mergeDataCount += cut.currentRenderCnt;
        }
        if (watermarkCount) {
            mergeSplatData.set(splatModel.watermarkData.slice(0, watermarkCount * 32), mergeDataCount * 32);
        }
        if (textWatermarkCount) {
            mergeSplatData.set(txtWatermarkData.slice(0, textWatermarkCount * 32), (mergeDataCount + watermarkCount) * 32);
        }

        // 保险起见以最终数据数量为准
        const totalRenderSplatCount = mergeDataCount + watermarkCount + textWatermarkCount;
        const xyz = new Float32Array(totalRenderSplatCount * 3);
        for (let i = 0, n = 0; i < totalRenderSplatCount; i++) {
            xyz[i * 3] = f32s[i * 8];
            xyz[i * 3 + 1] = f32s[i * 8 + 1];
            xyz[i * 3 + 2] = f32s[i * 8 + 2];
        }

        texture.txdata = ui32s;
        texture.xyz = xyz;
        texture.renderSplatCount = totalRenderSplatCount;
        texture.visibleSplatCount = currentTotalVisibleCnt + splatModel.watermarkCount + textWatermarkCount;
        texture.modelSplatCount = splatModel.downloadSplatCount + textWatermarkCount;
        texture.watermarkCount = watermarkCount + textWatermarkCount;
        texture.minX = splatModel.header.MinX;
        texture.maxX = splatModel.header.MaxX;
        texture.minY = splatModel.header.MinY;
        texture.maxY = splatModel.header.MaxY;
        texture.minZ = splatModel.header.MinZ;
        texture.maxZ = splatModel.header.MaxZ;

        fire(UploadSplatTexture, texture);
        lastPostDataTime = sysTime;

        fire(Information, { visibleSplatCount: texture.visibleSplatCount, modelSplatCount: texture.modelSplatCount });
    }

    function allocatePoints(cuts: CutData[], maxPoints: number): void {
        const weights = cuts.map(cut => 1 / (cut.distance + 1e-6));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let totalRenderSplatCount = 0;
        cuts.forEach((cut, index) => {
            cut.currentRenderCnt = Math.min(Math.floor((weights[index] / totalWeight) * maxPoints), cut.splatCount);
            totalRenderSplatCount += cut.currentRenderCnt;
        });
        if (totalRenderSplatCount < maxPoints) {
            const remainingPoints = maxPoints - totalRenderSplatCount;
            const remainingWeights = cuts.map((cut, index) => (cut.currentRenderCnt < cut.splatCount ? weights[index] : 0));
            const remainingTotalWeight = remainingWeights.reduce((sum, weight) => sum + weight, 0);

            cuts.forEach((cut, index) => {
                if (remainingTotalWeight > 0 && cut.currentRenderCnt < cut.splatCount) {
                    const additionalPoints = Math.min(
                        Math.floor((remainingWeights[index] / remainingTotalWeight) * remainingPoints),
                        cut.splatCount - cut.currentRenderCnt,
                    );
                    cut.currentRenderCnt += additionalPoints;
                }
            });
        }
    }

    function checkCutDataVisible(viewProjMatrix: Matrix4, cameraPosition: Vector3, cameraTarget: Vector3, cut: CutData): boolean {
        cut.distance = Math.max(cut.center.distanceTo(cameraPosition) - cut.radius, 0);
        if (!cut.distance || cut.center.distanceTo(cameraTarget) <= 2 * cut.radius) return true;

        const pos2d = new Vector4(cut.center.x, cut.center.y, cut.center.z, 1).applyMatrix4(viewProjMatrix);
        const clip = 3 * pos2d.w;
        return !(pos2d.z < -clip || pos2d.x < -clip || pos2d.x > clip || pos2d.y < -clip || pos2d.y > clip);
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        splatModel?.abortController?.abort();
        splatModel?.map?.clear();
        splatModel = null;
        textWatermarkData = null;
        texture0 = null;
        texture1 = null;
    }

    function loadSplatModel(model: SplatModel) {
        if (model.opts.format === 'spx') {
            loadSpx(model);
        } else if (model.opts.format === 'splat') {
            loadSplat(model);
        } else if (model.opts.format === 'ply') {
            loadPly(model);
        } else if (model.opts.format === 'spz') {
            loadSpz(model);
        } else {
            return false;
        }
        return true;
    }

    async function add(opts: ModelOptions, meta: MetaData) {
        if (disposed) return;
        const splatMeshOptions: SplatMeshOptions = fire(GetOptions);
        const maxRenderCount: number = isMobile ? splatMeshOptions.maxRenderCountOfMobile : splatMeshOptions.maxRenderCountOfPc;
        const isBigSceneMode: boolean = fire(IsBigSceneMode);

        opts.fetchReload = isNeedReload(meta.updateDate || 0); // 7天内更新的重新下载

        splatModel = new SplatModel(opts, meta);

        // 计算设定下载限制
        if (isBigSceneMode && meta.autoCut) {
            const pcDownloadLimitCount = meta.pcDownloadLimitSplatCount || PcDownloadLimitSplatCount;
            const mobileDownloadLimitCount = meta.mobileDownloadLimitSplatCount || MobileDownloadLimitSplatCount;
            const bigSceneDownloadLimit = isMobile ? mobileDownloadLimitCount : pcDownloadLimitCount;
            splatModel.fetchLimit = Math.min(meta.autoCut * meta.autoCut * maxRenderCount + maxRenderCount, bigSceneDownloadLimit);
        } else {
            splatModel.fetchLimit = maxRenderCount;
        }

        const startTime: number = Date.now();
        const fnCheckModelSplatCount = () => {
            if (!splatModel || splatModel.status == ModelStatus.Invalid || splatModel.status == ModelStatus.FetchFailed) {
                return fnResolveModelSplatCount(0);
            }
            if (splatModel.modelSplatCount >= 0) {
                fnResolveModelSplatCount(splatModel.modelSplatCount);
                setTimeout(() => fire(SplatMeshCycleZoom), 5);
            } else if (Date.now() - startTime >= 3000) {
                return fnResolveModelSplatCount(0); // 超3秒还取不到模型数量，放弃，将按配置的最大渲染数计算
            } else {
                setTimeout(fnCheckModelSplatCount, 10);
            }
        };
        fnCheckModelSplatCount();

        if (!loadSplatModel(splatModel)) {
            console.error('Unsupported format:', opts.format);
            fire(OnFetchStop, 0);
            return;
        }
        fire(OnFetchStart);
        fire(Information, { cuts: `` });
    }

    on(SplatTexdataManagerAddModel, async (opts: ModelOptions, meta: MetaData) => await add(opts, meta));
    on(SplatTexdataManagerDataChanged, (msDuring: number = 10000) => Date.now() - lastPostDataTime < msDuring);
    on(SplatTexdataManagerDispose, () => dispose());

    fire(
        RunLoopByFrame,
        async () => await mergeAndUploadData(isBigSceneMode),
        () => !disposed,
    );
}
