// ==============================================
// Copyright (c) 2025 reall3d.com, MIT license
// ==============================================
#include <cmath>
#include <cstdint>
#include <emscripten/emscripten.h>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

uint16_t floatToHalf(float value) {
    uint32_t f = *reinterpret_cast<uint32_t *>(&value);

    uint32_t sign = (f >> 31) & 0x0001;
    uint32_t exp = (f >> 23) & 0x00ff;
    uint32_t frac = f & 0x007fffff;

    uint32_t newExp;
    if (exp == 0) {
        newExp = 0;
    } else if (exp < 113) {
        newExp = 0;
        frac |= 0x00800000;
        frac >>= (113 - exp);
        if (frac & 0x01000000) {
            newExp = 1;
            frac = 0;
        }
    } else if (exp < 142) {
        newExp = exp - 112;
    } else {
        newExp = 31;
        frac = 0;
    }

    return (sign << 15) | (newExp << 10) | (frac >> 13);
}

uint32_t packHalf2x16(float x, float y) {
    uint16_t hx = floatToHalf(x);
    uint16_t hy = floatToHalf(y);
    return (uint32_t)hx | ((uint32_t)hy << 16);
}

float decodeLog(float v, int times) {
    if (times < 1) {
        return v;
    }
    float rs = v < 0.0f ? -(std::exp(-v) - 1.0f) : std::exp(v) - 1.0f;
    if (times == 1) {
        return rs;
    }
    return decodeLog(rs, times - 1);
}

/**
 * spx文件头校验
 * @param b: 输入的文件头字节数组（固定长128，最后4位为校验码）
 * @return: 0-成功，1-失败
 */
EXTERN EMSCRIPTEN_KEEPALIVE int H(void *b) {
    uint8_t *ui8sInput = (uint8_t *)b;
    uint32_t *ui32sInput = (uint32_t *)b;

    uint32_t rs = 53653;
    for (int i = 0; i < 124; i++)
        rs = (rs * 33) ^ ui8sInput[i];

    return rs == ui32sInput[31] ? 0 : 1;
}

void computeWriteTexdata(void *b, int offset, float x, float y, float z, float sx, float sy, float sz, float r0, float r1, float r2, float r3, uint32_t rgba) {
    float *f32sOutput = (float *)b;
    uint32_t *ui32sOutput = (uint32_t *)b;

    float norm = std::sqrt(r0 * r0 + r1 * r1 + r2 * r2 + r3 * r3);
    float rot0 = r0 / norm;
    float rot1 = r1 / norm;
    float rot2 = r2 / norm;
    float rot3 = r3 / norm;

    float M0 = (1.0 - 2.0 * (rot2 * rot2 + rot3 * rot3)) * sx;
    float M1 = (2.0 * (rot1 * rot2 + rot0 * rot3)) * sx;
    float M2 = (2.0 * (rot1 * rot3 - rot0 * rot2)) * sx;
    float M3 = (2.0 * (rot1 * rot2 - rot0 * rot3)) * sy;
    float M4 = (1.0 - 2.0 * (rot1 * rot1 + rot3 * rot3)) * sy;
    float M5 = (2.0 * (rot2 * rot3 + rot0 * rot1)) * sy;
    float M6 = (2.0 * (rot1 * rot3 + rot0 * rot2)) * sz;
    float M7 = (2.0 * (rot2 * rot3 - rot0 * rot1)) * sz;
    float M8 = (1.0 - 2.0 * (rot1 * rot1 + rot2 * rot2)) * sz;

    float sigma0 = M0 * M0 + M3 * M3 + M6 * M6;
    float sigma1 = M0 * M1 + M3 * M4 + M6 * M7;
    float sigma2 = M0 * M2 + M3 * M5 + M6 * M8;
    float sigma3 = M1 * M1 + M4 * M4 + M7 * M7;
    float sigma4 = M1 * M2 + M4 * M5 + M7 * M8;
    float sigma5 = M2 * M2 + M5 * M5 + M8 * M8;

    f32sOutput[offset + 0] = x;
    f32sOutput[offset + 1] = y;
    f32sOutput[offset + 2] = z;
    ui32sOutput[offset + 3] = 0;
    ui32sOutput[offset + 4] = packHalf2x16(4 * sigma0, 4 * sigma1);
    ui32sOutput[offset + 5] = packHalf2x16(4 * sigma2, 4 * sigma3);
    ui32sOutput[offset + 6] = packHalf2x16(4 * sigma4, 4 * sigma5);
    ui32sOutput[offset + 7] = rgba;
}

/**
 * splat数据解析为纹理
 * @param b: 字节数组（长32*n）
 * @param n: 高斯点数
 * @return: 0-成功
 */
EXTERN EMSCRIPTEN_KEEPALIVE int s(void *b, int n) {
    uint8_t *ui8sInput = (uint8_t *)b;
    uint32_t *ui32sInput = (uint32_t *)b;
    float *f32sInput = (float *)b;

    float x, y, z, sx, sy, sz, RX, RY, RZ, RW;
    uint32_t rgba;
    uint8_t rw, rx, ry, rz;
    for (int i = 0; i < n; i++) {
        x = (f32sInput[i * 8 + 0]);
        y = (f32sInput[i * 8 + 1]);
        z = (f32sInput[i * 8 + 2]);
        sx = (f32sInput[i * 8 + 3]);
        sy = (f32sInput[i * 8 + 4]);
        sz = (f32sInput[i * 8 + 5]);
        rgba = ui32sInput[i * 8 + 6];

        // xyzw
        rx = ui8sInput[i * 32 + 28];
        ry = ui8sInput[i * 32 + 29];
        rz = ui8sInput[i * 32 + 30];
        rw = ui8sInput[i * 32 + 31];

        RX = ((float)rx - 128.0) / 128.0;
        RY = ((float)ry - 128.0) / 128.0;
        RZ = ((float)rz - 128.0) / 128.0;
        RW = ((float)rw - 128.0) / 128.0;

        computeWriteTexdata(b, i * 8, x, y, z, sx, sy, sz, RX, RY, RZ, RW, rgba);
    }

    return 0;
}

/**
 * 把spx【20】格式的数据块解析为纹理
 * @param o: 输出用字节数组（纹理32*n）
 * @param b: 输入的块字节数组
 *           【20】splat20（点数4 + 格式4 + 数据20*n）
 *           数据排列 [x...]+[y...]+[z...]+[sx...]+[sy...]+[sz...]+[r...]+[g...]+[b...]+[a...]+[rw...]+[rx...]+[ry...]+[rz...]
 * @return: 0-成功
 */
int spxSplat20(void *o, void *b) {
    uint8_t *ui8sInput = (uint8_t *)b;
    uint32_t *ui32sInput = (uint32_t *)b;

    int n = (int)ui32sInput[0];

    int offset = 8;
    float x, y, z, sx, sy, sz, RX, RY, RZ, RW;
    uint32_t rgba;
    uint8_t x0, x1, x2, y0, y1, y2, z0, z1, z2, s0, s1, s2, R, G, B, A, rx, ry, rz, rw;
    int32_t i32x, i32y, i32z;
    for (int i = 0; i < n; i++) {
        x0 = ui8sInput[offset + i * 3 + 0];
        x1 = ui8sInput[offset + i * 3 + 1];
        x2 = ui8sInput[offset + i * 3 + 2];
        y0 = ui8sInput[offset + n * 3 + i * 3 + 0];
        y1 = ui8sInput[offset + n * 3 + i * 3 + 1];
        y2 = ui8sInput[offset + n * 3 + i * 3 + 2];
        z0 = ui8sInput[offset + n * 6 + i * 3 + 0];
        z1 = ui8sInput[offset + n * 6 + i * 3 + 1];
        z2 = ui8sInput[offset + n * 6 + i * 3 + 2];

        s0 = ui8sInput[offset + n * 9 + i];
        s1 = ui8sInput[offset + n * 10 + i];
        s2 = ui8sInput[offset + n * 11 + i];

        R = ui8sInput[offset + n * 12 + i];
        G = ui8sInput[offset + n * 13 + i];
        B = ui8sInput[offset + n * 14 + i];
        A = ui8sInput[offset + n * 15 + i];

        rw = ui8sInput[offset + n * 16 + i];
        rx = ui8sInput[offset + n * 17 + i];
        ry = ui8sInput[offset + n * 18 + i];
        rz = ui8sInput[offset + n * 19 + i];

        i32x = (x0 | (x1 << 8) | (x2 << 16));
        if (i32x & 0x800000)
            i32x |= 0xFF000000;
        i32y = (y0 | (y1 << 8) | (y2 << 16));
        if (i32y & 0x800000)
            i32y |= 0xFF000000;
        i32z = (z0 | (z1 << 8) | (z2 << 16));
        if (i32z & 0x800000)
            i32z |= 0xFF000000;

        x = static_cast<float>(i32x) / 4096.0f;
        y = static_cast<float>(i32y) / 4096.0f;
        z = static_cast<float>(i32z) / 4096.0f;

        sx = std::exp((float)s0 / 16.0f - 10.0f);
        sy = std::exp((float)s1 / 16.0f - 10.0f);
        sz = std::exp((float)s2 / 16.0f - 10.0f);

        rgba = (A << 24) | (B << 16) | (G << 8) | R;

        RW = ((float)rw - 128.0) / 128.0;
        RX = ((float)rx - 128.0) / 128.0;
        RY = ((float)ry - 128.0) / 128.0;
        RZ = ((float)rz - 128.0) / 128.0;

        computeWriteTexdata(o, i * 8, x, y, z, sx, sy, sz, RW, RX, RY, RZ, rgba);
    }

    return 0;
}

/**
 * 把spx【19】格式的数据块解析为纹理
 * @param o: 输出用字节数组（纹理32*n）
 * @param b: 输入的块字节数组
 *           【19】splat19（点数4 + 格式4 + 数据19*n）
 *           数据排列 [x0...]+[y0...]+[z0...]+[x1...]+[y1...]+[z1...]+[x2...]+[y2...]+[z2...]+[sx...]+[sy...]+[sz...]+[r...]+[g...]+[b...]+[a...]+[rx...]+[ry...]+[rz...]
 * @return: 0-成功
 */
int spxSplat19(void *o, void *b, bool isLog3) {
    uint8_t *ui8sInput = (uint8_t *)b;
    uint32_t *ui32sInput = (uint32_t *)b;

    int n = (int)ui32sInput[0];

    int offsetBit8 = 8; // 跳过块头部
    float x, y, z, sx, sy, sz, RX, RY, RZ, RW;
    uint32_t rgba;
    uint8_t x0, x1, x2, y0, y1, y2, z0, z1, z2, s0, s1, s2, R, G, B, A, rx, ry, rz, rw;
    int32_t i32x, i32y, i32z;
    for (int i = 0; i < n; i++) {
        x0 = ui8sInput[offsetBit8 + i];
        y0 = ui8sInput[offsetBit8 + n * 1 + i];
        z0 = ui8sInput[offsetBit8 + n * 2 + i];
        x1 = ui8sInput[offsetBit8 + n * 3 + i];
        y1 = ui8sInput[offsetBit8 + n * 4 + i];
        z1 = ui8sInput[offsetBit8 + n * 5 + i];
        x2 = ui8sInput[offsetBit8 + n * 6 + i];
        y2 = ui8sInput[offsetBit8 + n * 7 + i];
        z2 = ui8sInput[offsetBit8 + n * 8 + i];

        s0 = ui8sInput[offsetBit8 + n * 9 + i];
        s1 = ui8sInput[offsetBit8 + n * 10 + i];
        s2 = ui8sInput[offsetBit8 + n * 11 + i];

        R = ui8sInput[offsetBit8 + n * 12 + i];
        G = ui8sInput[offsetBit8 + n * 13 + i];
        B = ui8sInput[offsetBit8 + n * 14 + i];
        A = ui8sInput[offsetBit8 + n * 15 + i];

        rx = ui8sInput[offsetBit8 + n * 16 + i];
        ry = ui8sInput[offsetBit8 + n * 17 + i];
        rz = ui8sInput[offsetBit8 + n * 18 + i];

        i32x = (x0 | (x1 << 8) | (x2 << 16));
        if (i32x & 0x800000)
            i32x |= 0xFF000000;
        i32y = (y0 | (y1 << 8) | (y2 << 16));
        if (i32y & 0x800000)
            i32y |= 0xFF000000;
        i32z = (z0 | (z1 << 8) | (z2 << 16));
        if (i32z & 0x800000)
            i32z |= 0xFF000000;

        x = static_cast<float>(i32x) / 4096.0f;
        y = static_cast<float>(i32y) / 4096.0f;
        z = static_cast<float>(i32z) / 4096.0f;
        if (isLog3) {
            x = decodeLog(x, 3);
            y = decodeLog(y, 3);
            z = decodeLog(z, 3);
        }

        sx = std::exp((float)s0 / 16.0f - 10.0f);
        sy = std::exp((float)s1 / 16.0f - 10.0f);
        sz = std::exp((float)s2 / 16.0f - 10.0f);

        rgba = (A << 24) | (B << 16) | (G << 8) | R;

        RX = ((float)rx - 128.0f) / 128.0f;
        RY = ((float)ry - 128.0f) / 128.0f;
        RZ = ((float)rz - 128.0f) / 128.0f;
        RW = 1.0f - (RX * RX + RY * RY + RZ * RZ);
        RW = RW < 0.0f ? 0.0f : std::sqrt(RW);

        computeWriteTexdata(o, i * 8, x, y, z, sx, sy, sz, RW, RX, RY, RZ, rgba);
    }

    return 0;
}

/**
 * 把spx球谐系数【1】格式的数据块解析为纹理
 * @param o: 输出用字节数组（纹理16*n）
 * @param b: 输入的块字节数组
 *           【1】每点含9字节的1级球谐系数（点数4 + 格式4 + 数据9*n）
 * @return: 0-成功
 */
int spxSh1(void *o, void *b) {
    uint8_t *ui8sInput = (uint8_t *)b;
    uint32_t *ui32sInput = (uint32_t *)b;
    uint8_t *ui8sOutput = (uint8_t *)o;
    uint32_t *ui32sOutput = (uint32_t *)o;

    int n = (int)ui32sInput[0];

    int offset = 8;
    uint32_t sh0, sh1, sh2, sh3, sh4, sh5, sh6, sh7, sh8;
    for (int i = 0; i < n; i++) {
        sh0 = (uint32_t)(ui8sInput[offset + i * 9] >> 3);
        sh1 = (uint32_t)(ui8sInput[offset + i * 9 + 1] >> 3);
        sh2 = (uint32_t)(ui8sInput[offset + i * 9 + 2] >> 3);
        sh3 = (uint32_t)(ui8sInput[offset + i * 9 + 3] >> 3);
        sh4 = (uint32_t)(ui8sInput[offset + i * 9 + 4] >> 3);
        sh5 = (uint32_t)(ui8sInput[offset + i * 9 + 5] >> 3);
        sh6 = (uint32_t)(ui8sInput[offset + i * 9 + 6] >> 3);
        sh7 = (uint32_t)(ui8sInput[offset + i * 9 + 7] >> 3);
        sh8 = (uint32_t)(ui8sInput[offset + i * 9 + 8] >> 3);

        ui32sOutput[i * 4] = (sh0 << 27) | (sh1 << 22) | (sh2 << 17) | (sh3 << 12) | (sh4 << 7) | (sh5 << 2) | (sh6 >> 3);
        ui32sOutput[i * 4 + 1] = (sh6 << 29) | (sh7 << 24) | (sh8 << 19);
        ui32sOutput[i * 4 + 2] = 0;
        ui32sOutput[i * 4 + 3] = 1;
    }

    return 0;
}

/**
 * 把spx球谐系数【2】格式的数据块解析为纹理
 * @param o: 输出用字节数组（纹理16*n）
 * @param b: 输入的块字节数组
 *           【2】每点含24字节的1级加2级球谐系数（点数4 + 格式4 + 数据(9+15)*n）
 * @return: 0-成功
 */
int spxSh12(void *o, void *b) {
    uint8_t *ui8sInput = (uint8_t *)b;
    uint32_t *ui32sInput = (uint32_t *)b;
    uint32_t *ui32sOutput = (uint32_t *)o;

    int n = (int)ui32sInput[0];

    int offset = 8;
    uint32_t sh0, sh1, sh2, sh3, sh4, sh5, sh6, sh7, sh8, sh9, sh10, sh11, sh12, sh13, sh14, sh15, sh16, sh17, sh18, sh19, sh20, sh21, sh22, sh23;
    for (int i = 0; i < n; i++) {
        sh0 = (uint32_t)(ui8sInput[offset + i * 24] >> 3);
        sh1 = (uint32_t)(ui8sInput[offset + i * 24 + 1] >> 3);
        sh2 = (uint32_t)(ui8sInput[offset + i * 24 + 2] >> 3);
        sh3 = (uint32_t)(ui8sInput[offset + i * 24 + 3] >> 3);
        sh4 = (uint32_t)(ui8sInput[offset + i * 24 + 4] >> 3);
        sh5 = (uint32_t)(ui8sInput[offset + i * 24 + 5] >> 3);
        sh6 = (uint32_t)(ui8sInput[offset + i * 24 + 6] >> 3);
        sh7 = (uint32_t)(ui8sInput[offset + i * 24 + 7] >> 3);
        sh8 = (uint32_t)(ui8sInput[offset + i * 24 + 8] >> 3);
        sh9 = (uint32_t)(ui8sInput[offset + i * 24 + 9] >> 3);
        sh10 = (uint32_t)(ui8sInput[offset + i * 24 + 10] >> 3);
        sh11 = (uint32_t)(ui8sInput[offset + i * 24 + 11] >> 3);
        sh12 = (uint32_t)(ui8sInput[offset + i * 24 + 12] >> 3);
        sh13 = (uint32_t)(ui8sInput[offset + i * 24 + 13] >> 3);
        sh14 = (uint32_t)(ui8sInput[offset + i * 24 + 14] >> 3);
        sh15 = (uint32_t)(ui8sInput[offset + i * 24 + 15] >> 3);
        sh16 = (uint32_t)(ui8sInput[offset + i * 24 + 16] >> 3);
        sh17 = (uint32_t)(ui8sInput[offset + i * 24 + 17] >> 3);
        sh18 = (uint32_t)(ui8sInput[offset + i * 24 + 18] >> 3);
        sh19 = (uint32_t)(ui8sInput[offset + i * 24 + 19] >> 3);
        sh20 = (uint32_t)(ui8sInput[offset + i * 24 + 20] >> 3);
        sh21 = (uint32_t)(ui8sInput[offset + i * 24 + 21] >> 3);
        sh22 = (uint32_t)(ui8sInput[offset + i * 24 + 22] >> 3);
        sh23 = (uint32_t)(ui8sInput[offset + i * 24 + 23] >> 3);

        ui32sOutput[i * 4] = (sh0 << 27) | (sh1 << 22) | (sh2 << 17) | (sh3 << 12) | (sh4 << 7) | (sh5 << 2) | (sh6 >> 3);
        ui32sOutput[i * 4 + 1] = (sh6 << 29) | (sh7 << 24) | (sh8 << 19) | (sh9 << 14) | (sh10 << 9) | (sh11 << 4) | (sh12 >> 1);
        ui32sOutput[i * 4 + 2] = (sh12 << 31) | (sh13 << 26) | (sh14 << 21) | (sh15 << 16) | (sh16 << 11) | (sh17 << 6) | (sh18 << 1) | (sh19 >> 4);
        ui32sOutput[i * 4 + 3] = (sh19 << 28) | (sh20 << 23) | (sh21 << 18) | (sh22 << 13) | (sh23 << 8) | 0x1;
    }

    return 0;
}

/**
 * 把spx球谐系数【3】格式的数据块解析为纹理
 * @param o: 输出用字节数组（纹理16*n）
 * @param b: 输入的块字节数组
 *           【3】每点含21字节的3级球谐系数（点数4 + 格式4 + 数据(21)*n）
 * @return: 0-成功
 */
int spxSh3(void *o, void *b) {
    uint8_t *ui8sInput = (uint8_t *)b;
    uint32_t *ui32sInput = (uint32_t *)b;
    uint32_t *ui32sOutput = (uint32_t *)o;

    int n = (int)ui32sInput[0];

    int offset = 8;
    uint32_t sh0, sh1, sh2, sh3, sh4, sh5, sh6, sh7, sh8, sh9, sh10, sh11, sh12, sh13, sh14, sh15, sh16, sh17, sh18, sh19, sh20;
    for (int i = 0; i < n; i++) {
        sh0 = (uint32_t)(ui8sInput[offset + i * 21] >> 3);
        sh1 = (uint32_t)(ui8sInput[offset + i * 21 + 1] >> 3);
        sh2 = (uint32_t)(ui8sInput[offset + i * 21 + 2] >> 3);
        sh3 = (uint32_t)(ui8sInput[offset + i * 21 + 3] >> 3);
        sh4 = (uint32_t)(ui8sInput[offset + i * 21 + 4] >> 3);
        sh5 = (uint32_t)(ui8sInput[offset + i * 21 + 5] >> 3);
        sh6 = (uint32_t)(ui8sInput[offset + i * 21 + 6] >> 3);
        sh7 = (uint32_t)(ui8sInput[offset + i * 21 + 7] >> 3);
        sh8 = (uint32_t)(ui8sInput[offset + i * 21 + 8] >> 3);
        sh9 = (uint32_t)(ui8sInput[offset + i * 21 + 9] >> 3);
        sh10 = (uint32_t)(ui8sInput[offset + i * 21 + 10] >> 3);
        sh11 = (uint32_t)(ui8sInput[offset + i * 21 + 11] >> 3);
        sh12 = (uint32_t)(ui8sInput[offset + i * 21 + 12] >> 3);
        sh13 = (uint32_t)(ui8sInput[offset + i * 21 + 13] >> 3);
        sh14 = (uint32_t)(ui8sInput[offset + i * 21 + 14] >> 3);
        sh15 = (uint32_t)(ui8sInput[offset + i * 21 + 15] >> 3);
        sh16 = (uint32_t)(ui8sInput[offset + i * 21 + 16] >> 3);
        sh17 = (uint32_t)(ui8sInput[offset + i * 21 + 17] >> 3);
        sh18 = (uint32_t)(ui8sInput[offset + i * 21 + 18] >> 3);
        sh19 = (uint32_t)(ui8sInput[offset + i * 21 + 19] >> 3);
        sh20 = (uint32_t)(ui8sInput[offset + i * 21 + 20] >> 3);

        ui32sOutput[i * 4] = (sh0 << 27) | (sh1 << 22) | (sh2 << 17) | (sh3 << 12) | (sh4 << 7) | (sh5 << 2) | (sh6 >> 3);
        ui32sOutput[i * 4 + 1] = (sh6 << 29) | (sh7 << 24) | (sh8 << 19) | (sh9 << 14) | (sh10 << 9) | (sh11 << 4) | (sh12 >> 1);
        ui32sOutput[i * 4 + 2] = (sh12 << 31) | (sh13 << 26) | (sh14 << 21) | (sh15 << 16) | (sh16 << 11) | (sh17 << 6) | (sh18 << 1) | (sh19 >> 4);
        ui32sOutput[i * 4 + 3] = (sh19 << 28) | (sh20 << 23) | 0x1;
    }

    return 0;
}

/**
 * 把spx格式的数据块解析为纹理
 * @param o: 输出用字节数组（纹理32*n或球谐系数16*n）
 * @param b: 输入的块字节数组
 *           【19,10019】splat19（点数4 + 格式4 + 数据19*n）
 *           【20】splat20（点数4 + 格式4 + 数据20*n）
 *           【1】每点含9字节的1级球谐系数（点数4 + 格式4 + 数据9*n）
 *           【2】每点含24字节的1级加2级球谐系数（点数4 + 格式4 + 数据(9+15)*n）
 *           【3】每点含21字节的3级球谐系数（点数4 + 格式4 + 数据(21)*n）
 * @return: 0-成功，1-失败(不支持的版本)
 */
EXTERN EMSCRIPTEN_KEEPALIVE int D(void *o, void *b) {
    uint32_t *ui32sInput = (uint32_t *)b;

    if (ui32sInput[1] == 10019)
        return spxSplat19(o, b, true);
    else if (ui32sInput[1] == 19)
        return spxSplat19(o, b, false);
    else if (ui32sInput[1] == 20)
        return spxSplat20(o, b);
    else if (ui32sInput[1] == 1)
        return spxSh1(o, b);
    else if (ui32sInput[1] == 2)
        return spxSh12(o, b);
    else if (ui32sInput[1] == 3)
        return spxSh3(o, b);

    return 1;
}
