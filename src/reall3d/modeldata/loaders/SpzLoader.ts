// ==============================================
// Copyright (c) 2025 reall3d.com, MIT license
// ==============================================
import { Vector3 } from 'three';
import { clipUint8, unGzip } from '../../utils/CommonUtils';
import {
    isMobile,
    SH_C0,
    SplatDataSize32,
    SpxBlockFormatData20,
    SpxBlockFormatSH1,
    SpxBlockFormatSH2,
    SpxBlockFormatSH3,
} from '../../utils/consts/GlobalConstants';
import { ModelStatus, SplatModel } from '../ModelData';
import { parseSpxBlockData } from '../wasm/WasmParser';

const maxProcessCnt = isMobile ? 20480 : 51200;
const SpxHeaderLength = 16;

export async function loadSpz(model: SplatModel) {
    try {
        model.status = ModelStatus.Fetching;
        const signal: AbortSignal = model.abortController.signal;
        const cache = model.opts.fetchReload ? 'reload' : 'default';
        const req = await fetch(model.opts.url, { mode: 'cors', credentials: 'omit', cache, signal });
        if (req.status != 200) {
            console.warn(`fetch error: ${req.status}`);
            model.status === ModelStatus.Fetching && (model.status = ModelStatus.FetchFailed);
            return;
        }
        const reader = req.body.getReader();
        const contentLength = parseInt(req.headers.get('content-length') || '0');
        model.fileSize = contentLength;
        model.downloadSize = 0;
        model.downloadSplatCount = 0;
        model.watermarkData = new Uint8Array(0);

        const datas = new Uint8Array(contentLength);
        while (true) {
            let { done, value } = await reader.read();
            if (done) break;
            datas.set(value, model.downloadSize);
            model.downloadSize += value.length;
        }

        const ui8s = await unGzip(datas);
        if (!ui8s || ui8s.length < 16) {
            console.error(`Invalid spz format`);
            model.status = ModelStatus.Invalid;
            return;
        }

        const header = parseSpzHeader(ui8s);
        model.modelSplatCount = header.numPoints;
        model.dataShDegree = header.shDegree;
        model.splatData = new Uint8Array(Math.min(model.modelSplatCount, model.fetchLimit) * 32);
        await parseSpzAndSetSplatData(header, model, ui8s);
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('Fetch Abort', model.opts.url);
            model.status === ModelStatus.Fetching && (model.status = ModelStatus.FetchAborted);
        } else {
            console.error(e);
            model.status === ModelStatus.Fetching && (model.status = ModelStatus.FetchFailed);
        }
    } finally {
        model.status === ModelStatus.Fetching && (model.status = ModelStatus.FetchDone);
    }

    async function parseSpzAndSetSplatData(header: SpzHeader, model: SplatModel, value: Uint8Array) {
        const positionSize = header.numPoints * 9;
        const alphaSize = header.numPoints;
        const colorSize = header.numPoints * 3;
        const scaleSize = header.numPoints * 3;
        const rotationSize = header.numPoints * 3;

        const offsetpositions = SpxHeaderLength;
        const offsetAlphas = offsetpositions + positionSize;
        const offsetColors = offsetAlphas + alphaSize;
        const offsetScales = offsetColors + colorSize;
        const offsetRotations = offsetScales + scaleSize;
        const offsetShs = offsetRotations + rotationSize;

        const limitCnt = Math.min(header.numPoints, model.fetchLimit);
        const count = Math.ceil(limitCnt / maxProcessCnt);
        for (let i = 0; i < count; i++) {
            let splatCnt = i < count - 1 ? maxProcessCnt : limitCnt - i * maxProcessCnt;
            if (model.dataSplatCount + splatCnt > model.fetchLimit) {
                splatCnt = model.fetchLimit - model.dataSplatCount;
            }
            const datas = new Uint8Array(splatCnt * 20 + 8);
            const u32s = new Uint32Array(2);
            u32s[0] = splatCnt;
            u32s[1] = SpxBlockFormatData20;
            datas.set(new Uint8Array(u32s.buffer), 0);
            let n = 8;
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 0];
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 1];
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 2];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 3];
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 4];
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 5];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 6];
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 7];
                datas[n++] = value[offsetpositions + (i * maxProcessCnt + j) * 9 + 8];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = value[offsetScales + (i * maxProcessCnt + j) * 3];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = value[offsetScales + (i * maxProcessCnt + j) * 3 + 1];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = value[offsetScales + (i * maxProcessCnt + j) * 3 + 2];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = decodeSpzColor(value[offsetColors + (i * maxProcessCnt + j) * 3]);
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = decodeSpzColor(value[offsetColors + (i * maxProcessCnt + j) * 3 + 1]);
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = decodeSpzColor(value[offsetColors + (i * maxProcessCnt + j) * 3 + 2]);
            }

            const wxyz = [];
            for (let j = 0, rx = 0, ry = 0, rz = 0; j < splatCnt; j++) {
                datas[n++] = value[offsetAlphas + (i * maxProcessCnt + j)];

                rx = value[offsetRotations + (i * maxProcessCnt + j) * 3 + 0];
                ry = value[offsetRotations + (i * maxProcessCnt + j) * 3 + 1];
                rz = value[offsetRotations + (i * maxProcessCnt + j) * 3 + 2];
                wxyz.push(decodeSpzRotations(rx, ry, rz));
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = wxyz[j][0];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = wxyz[j][1];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = wxyz[j][2];
            }
            for (let j = 0; j < splatCnt; j++) {
                datas[n++] = wxyz[j][3];
            }

            const spxBlock = await parseSpxBlockData(datas);
            setBlockSplatData(header, model, spxBlock.datas);

            if (header.shDegree === 1) {
                const sh2 = new Uint8Array(splatCnt * 9 + 8);
                const u2s = new Uint32Array(2);
                u2s[0] = splatCnt;
                u2s[1] = SpxBlockFormatSH1;
                sh2.set(new Uint8Array(u2s.buffer), 0);
                for (let j = 0, offset = 8; j < splatCnt; j++) {
                    sh2.set(value.slice(offsetShs + (i * maxProcessCnt + j) * 9, offsetShs + (i * maxProcessCnt + j) * 9 + 9), offset);
                    offset += 9;
                }
                const sh2Block = await parseSpxBlockData(sh2);
                model.sh12Data.push(sh2Block.datas);
            } else if (header.shDegree === 2) {
                const sh2 = new Uint8Array(splatCnt * 24 + 8);
                const u2s = new Uint32Array(2);
                u2s[0] = splatCnt;
                u2s[1] = SpxBlockFormatSH2;
                sh2.set(new Uint8Array(u2s.buffer), 0);
                for (let j = 0, offset = 8; j < splatCnt; j++) {
                    sh2.set(value.slice(offsetShs + (i * maxProcessCnt + j) * 24, offsetShs + (i * maxProcessCnt + j) * 24 + 24), offset);
                    offset += 24;
                }
                const sh2Block = await parseSpxBlockData(sh2);
                model.sh12Data.push(sh2Block.datas);
            } else if (header.shDegree === 3) {
                const sh2 = new Uint8Array(splatCnt * 24 + 8);
                const u2s = new Uint32Array(2);
                u2s[0] = splatCnt;
                u2s[1] = SpxBlockFormatSH2;
                sh2.set(new Uint8Array(u2s.buffer), 0);
                for (let j = 0, offset = 8; j < splatCnt; j++) {
                    sh2.set(value.slice(offsetShs + (i * maxProcessCnt + j) * 45, offsetShs + (i * maxProcessCnt + j) * 45 + 24), offset);
                    offset += 24;
                }
                const sh2Block = await parseSpxBlockData(sh2);
                model.sh12Data.push(sh2Block.datas);

                const sh3 = new Uint8Array(splatCnt * 21 + 8);
                const u3s = new Uint32Array(2);
                u3s[0] = splatCnt;
                u3s[1] = SpxBlockFormatSH3;
                sh3.set(new Uint8Array(u3s.buffer), 0);
                for (let j = 0, offset = 8; j < splatCnt; j++) {
                    sh3.set(value.slice(offsetShs + (i * maxProcessCnt + j) * 45 + 24, offsetShs + (i * maxProcessCnt + j) * 45 + 45), offset);
                    offset += 21;
                }
                const sh3Block = await parseSpxBlockData(sh3);
                model.sh3Data.push(sh3Block.datas);
            }

            if (model.dataSplatCount >= model.fetchLimit) {
                break; // 丢弃超出限制范围外的数据
            }
        }
    }

    function setBlockSplatData(header: SpzHeader, model: SplatModel, data: Uint8Array) {
        let dataCnt = data.byteLength / SplatDataSize32;
        const maxSplatDataCnt = Math.min(model.fetchLimit, header.numPoints);
        if (model.dataSplatCount + dataCnt > maxSplatDataCnt) {
            dataCnt = maxSplatDataCnt - model.dataSplatCount; // 丢弃超出限制的部分
            model.splatData.set(data.slice(0, dataCnt * SplatDataSize32), model.dataSplatCount * SplatDataSize32);
        } else {
            model.splatData.set(data, model.dataSplatCount * SplatDataSize32);
        }

        // 计算当前半径
        const f32s: Float32Array = new Float32Array(data.buffer);
        for (let i = 0, x = 0, y = 0, z = 0; i < dataCnt; i++) {
            x = f32s[i * 8];
            y = f32s[i * 8 + 1];
            z = f32s[i * 8 + 2];
            model.minX = Math.min(model.minX, x);
            model.maxX = Math.max(model.maxX, x);
            model.minY = Math.min(model.minY, y);
            model.maxY = Math.max(model.maxY, y);
            model.minZ = Math.min(model.minZ, z);
            model.maxZ = Math.max(model.maxZ, z);
        }

        model.dataSplatCount += dataCnt;
        model.downloadSplatCount += dataCnt;

        const topY = 0;
        model.currentRadius = Math.sqrt(model.maxX * model.maxX + topY * topY + model.maxZ * model.maxZ); // 当前模型数据范围离高点的最大半径
        model.aabbCenter = new Vector3((model.minX + model.maxX) / 2, (model.minY + model.maxY) / 2, (model.minZ + model.maxZ) / 2);
        model.metaMatrix && model.aabbCenter.applyMatrix4(model.metaMatrix);
    }

    function parseSpzHeader(ui8s: Uint8Array): SpzHeader {
        const value = ui8s.slice(0, SpxHeaderLength);
        const u32s = new Uint32Array(value.buffer);
        const header: SpzHeader = {};
        header.magic = u32s[0];
        header.version = u32s[1];
        header.numPoints = u32s[2];
        header.shDegree = value[12];
        header.fractionalBits = value[13];
        header.flags = value[14];
        header.reserved = value[15];

        if (header.magic !== 1347635022) throw new Error('[SPZ ERROR] header not found');
        if (header.version !== 2) throw new Error('[SPZ ERROR] ersion not supported:' + header.version);
        if (header.shDegree > 3) throw new Error('[SPZ ERROR] unsupported SH degree:' + header.shDegree);
        if (header.fractionalBits !== 12) throw new Error('[SPZ ERROR] unsupported FractionalBits:' + header.fractionalBits); // 仅支持这一种编码方式（坐标24位整数编码）

        let shDim = 0;
        if (header.shDegree === 1) {
            shDim = 9;
        } else if (header.shDegree === 2) {
            shDim = 24;
        } else if (header.shDegree === 3) {
            shDim = 45;
        }
        if (ui8s.length !== SpxHeaderLength + header.numPoints * (19 + shDim)) throw new Error('[SPZ ERROR] invalid spz data');

        return header;
    }
}

interface SpzHeader {
    /** 1347635022 */
    magic?: number;
    /** 2 */
    version?: number;
    /** Number of Gaussian primitives, must be specified */
    numPoints?: number;
    /** 0,1,2,3 */
    shDegree?: number;
    /** Reserved fields */
    fractionalBits?: number;
    /** Reserved fields */
    flags?: number;
    /** 0 */
    reserved?: number;
}

function decodeSpzColor(val: number): number {
    const fColor = (val - 0.5 * 255.0) / (0.15 * 255.0);
    return clipUint8((0.5 + SH_C0 * fColor) * 255.0);
}

function decodeSpzRotations(rx: number, ry: number, rz: number): number[] {
    const r1 = rx / 127.5 - 1.0;
    const r2 = ry / 127.5 - 1.0;
    const r3 = rz / 127.5 - 1.0;
    const r0 = Math.sqrt(Math.max(0, 1.0 - (r1 * r1 + r2 * r2 + r3 * r3)));
    return [clipUint8(r0 * 128.0 + 128.0), clipUint8(r1 * 128.0 + 128.0), clipUint8(r2 * 128.0 + 128.0), clipUint8(r3 * 128.0 + 128.0)];
}
