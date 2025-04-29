// ================================
// Copyright (c) 2025 reall3d.com
// ================================
import {
    SplatDataSize16,
    SplatDataSize32,
    SpxBlockFormatSH1,
    SpxBlockFormatSH2,
    SpxBlockFormatSH3,
    WasmBlockSize,
} from '../../utils/consts/GlobalConstants';
import { SpxHeader } from '../ModelData';

const WasmBase64 =
    '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';
const WasmOpenBase64 =
    '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';

export async function parseSpxHeader(header: Uint8Array): Promise<SpxHeader> {
    const ui32s = new Uint32Array(header.buffer);
    const f32s = new Float32Array(header.buffer);
    const head = new SpxHeader();
    head.Fixed = String.fromCharCode(header[0]) + String.fromCharCode(header[1]) + String.fromCharCode(header[2]);
    head.Version = header[3];
    head.SplatCount = ui32s[1];
    head.MinX = f32s[2];
    head.MaxX = f32s[3];
    head.MinY = f32s[4];
    head.MaxY = f32s[5];
    head.MinZ = f32s[6];
    head.MaxZ = f32s[7];
    head.MinTopY = f32s[8];
    head.MaxTopY = f32s[9];
    head.CreateDate = ui32s[10];
    head.CreaterId = ui32s[11];
    head.ExclusiveId = ui32s[12];
    head.ShDegree = header[52];
    head.Flag1 = header[53];
    head.Flag2 = header[54];
    head.Flag3 = header[55];
    head.Reserve1 = ui32s[14];
    head.Reserve2 = ui32s[15];

    let comment: string = '';
    for (let i = 64; i < 124; i++) {
        comment += String.fromCharCode(header[i]);
    }
    head.Comment = comment.trim();

    head.HashCheck = true;
    if (head.Fixed !== 'spx' && head.Version !== 1) {
        return null;
    }

    // 哈希校验（检查模型是否由特定工具生成）
    const wasmBase64 = head.CreaterId == 1202056903 ? WasmOpenBase64 : WasmBase64;
    const wasmModule = WebAssembly.compile(Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0)).buffer);
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
    const instance = await WebAssembly.instantiate(await wasmModule, { env: { memory, expf } });
    const headerParser: any = instance.exports.H;

    const wasmMemory = new Uint8Array(memory.buffer);
    wasmMemory.set(header, 0);
    const code: number = headerParser(0);
    if (code) {
        head.HashCheck = false;
    }

    return head;
}

interface SpxBlockResult {
    splatCount: number;
    blockFormat: number;
    datas?: Uint8Array;
    isSplat?: boolean;
    isSh?: boolean;
    isSh1?: boolean;
    isSh2?: boolean;
    isSh3?: boolean;
    success: boolean;
}

export async function parseSpxBlockData(data: Uint8Array): Promise<SpxBlockResult> {
    const ui32s = new Uint32Array(data.slice(0, 8).buffer);
    const splatCount = ui32s[0];
    const blockFormat = ui32s[1];
    const isSh1: boolean = SpxBlockFormatSH1 == blockFormat;
    const isSh2: boolean = SpxBlockFormatSH2 == blockFormat;
    const isSh3: boolean = SpxBlockFormatSH3 == blockFormat;
    const isSh: boolean = isSh1 || isSh2 || isSh3;
    const isSplat: boolean = !isSh;

    const wasmBase64 = blockFormat == 20 || isSh ? WasmOpenBase64 : WasmBase64;
    const resultByteLength = splatCount * (isSh ? SplatDataSize16 : SplatDataSize32);
    const wasmModule = WebAssembly.compile(Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0)).buffer);
    const blockCnt: number = Math.floor((resultByteLength + data.byteLength) / WasmBlockSize) + 2;
    const memory = new WebAssembly.Memory({ initial: blockCnt, maximum: blockCnt });
    const instance = await WebAssembly.instantiate(await wasmModule, { env: { memory, expf } });
    const dataParser: any = instance.exports.D;

    const wasmMemory = new Uint8Array(memory.buffer);
    wasmMemory.set(data, resultByteLength);
    const code = dataParser(0, resultByteLength);
    if (code) return { splatCount, blockFormat, success: false };
    return { splatCount, blockFormat, success: true, datas: wasmMemory.slice(0, resultByteLength), isSplat, isSh, isSh1, isSh2, isSh3 };
}

export async function parseSplatToTexdata(data: Uint8Array, splatCount: number): Promise<Uint8Array> {
    const wasmModule = WebAssembly.compile(Uint8Array.from(atob(WasmOpenBase64), c => c.charCodeAt(0)).buffer);
    const blockCnt = Math.floor((splatCount * SplatDataSize32) / WasmBlockSize) + 2;
    const memory = new WebAssembly.Memory({ initial: blockCnt, maximum: blockCnt });
    const instance = await WebAssembly.instantiate(await wasmModule, { env: { memory, expf } });
    const dataParser: any = instance.exports.s;

    const wasmMemory = new Uint8Array(memory.buffer);
    wasmMemory.set(data.slice(0, splatCount * SplatDataSize32), 0);
    const code: number = dataParser(0, splatCount);
    if (code) {
        console.error('splat data parser failed:', code);
        return new Uint8Array(0);
    }

    return wasmMemory.slice(0, splatCount * SplatDataSize32);
}

export async function parseWordToTexdata(x: number, y0z: number, isY: boolean = true, isNgativeY: boolean = true): Promise<Uint8Array> {
    const wasmModule = WebAssembly.compile(Uint8Array.from(atob(WasmBase64), c => c.charCodeAt(0)).buffer);
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
    const instance = await WebAssembly.instantiate(await wasmModule, { env: { memory, expf } });
    const dataSplat: any = instance.exports.w;

    const wasmMemory = new Uint8Array(memory.buffer);
    const f32s = new Float32Array(wasmMemory.buffer);
    const ngativeY = isNgativeY ? -1 : 1;
    f32s[0] = x;
    isY ? (f32s[1] = ngativeY * y0z) : (f32s[2] = ngativeY * y0z);
    dataSplat(0, isY ? 1 : 0);
    return wasmMemory.slice(0, SplatDataSize32);
}

function expf(v: number) {
    return Math.exp(v);
}
