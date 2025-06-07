// ==============================================
// Copyright (c) 2025 reall3d.com, MIT license
// ==============================================
import { Matrix4, Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, Vector4 } from 'three';
import { Events } from '../events/Events';
import {
    GetCamera,
    GetCanvasSize,
    GetMetaMatrix,
    GetScene,
    GetSplatActivePoints,
    RaycasterRayDistanceToPoint,
    RaycasterRayIntersectPoints,
} from '../events/EventConstants';
import { SplatMesh } from '../meshs/splatmesh/SplatMesh';

export function setupRaycaster(events: Events) {
    const raycaster: Raycaster = new Raycaster();
    const MinPixelDistance: number = 5;

    const on = (key: number, fn?: Function, multiFn?: boolean): Function | Function[] => events.on(key, fn, multiFn);
    const fire = (key: number, ...args: any): any => events.fire(key, ...args);

    on(RaycasterRayIntersectPoints, async (mouseClientX: number, mouseClientY: number): Promise<Vector3[]> => {
        const { width, height, left, top } = fire(GetCanvasSize);
        const mouse = new Vector2();
        mouse.x = ((mouseClientX - left) / width) * 2 - 1;
        mouse.y = ((top - mouseClientY) / height) * 2 + 1;
        const mousePixelX = ((mouse.x + 1) / 2) * width;
        const mousePixelY = ((1 - mouse.y) / 2) * height;

        const camera: PerspectiveCamera = fire(GetCamera);
        raycaster.setFromCamera(mouse, camera);

        const intersectObjs: any[] = [];
        const scene: Scene = fire(GetScene);
        const objectMeshs = [];
        const objectSplats: SplatMesh[] = [];
        scene.traverse(function (child: Object3D) {
            if (child instanceof SplatMesh) {
                objectSplats.push(child);
            } else {
                child['isMesh'] && !child['ignoreIntersect'] && !child['isMark'] && objectMeshs.push(child);
            }
        });

        const intersectMeshs = raycaster.intersectObjects(objectMeshs, true); // 常规mesh交点检测
        for (let i = 0; i < intersectMeshs.length; i++) {
            intersectObjs.push({ point: intersectMeshs[i].point, d: raycaster.ray.distanceToPoint(intersectMeshs[i].point), p: 1 });
        }

        // console.time('raycaster');
        const metaMatrix: Matrix4 = fire(GetMetaMatrix);
        const viewProj: Matrix4 = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
        for (let i = 0; i < objectSplats.length; i++) {
            const rs: any = objectSplats[i].fire(GetSplatActivePoints);
            if (!rs) continue;

            if (rs.length !== undefined) {
                // 坐标数组计算
                const activePoints: Float32Array = rs;
                const cnt = activePoints.length / 3;
                for (let j = 0; j < cnt; j++) {
                    const point: Vector3 = new Vector3(activePoints[3 * j + 0], activePoints[3 * j + 1], activePoints[3 * j + 2]);
                    metaMatrix && point.applyMatrix4(metaMatrix);
                    const projectedPoint = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(viewProj);
                    const pixelX = ((projectedPoint.x / projectedPoint.w + 1) / 2) * width;
                    const pixelY = ((1 - projectedPoint.y / projectedPoint.w) / 2) * height;
                    const pixelDist = Math.sqrt((pixelX - mousePixelX) ** 2 + (pixelY - mousePixelY) ** 2);
                    pixelDist <= MinPixelDistance && intersectObjs.push({ point, d: camera.position.distanceTo(point), p: pixelDist });
                }
            } else {
                // 分块计算
                for (let key of Object.keys(rs)) {
                    const xyzs: string[] = key.split(',');
                    const center: Vector3 = new Vector3(Number(xyzs[0]), Number(xyzs[1]), Number(xyzs[2])); // 边长为2的立方体中心点
                    if (raycaster.ray.distanceToPoint(center) <= 1.4143) {
                        const points: number[] = rs[key];
                        for (let j = 0, cnt = points.length / 3; j < cnt; j++) {
                            const point: Vector3 = new Vector3(points[3 * j + 0], points[3 * j + 1], points[3 * j + 2]);
                            metaMatrix && point.applyMatrix4(metaMatrix);
                            const projectedPoint = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(viewProj);
                            const pixelX = ((projectedPoint.x / projectedPoint.w + 1) / 2) * width;
                            const pixelY = ((1 - projectedPoint.y / projectedPoint.w) / 2) * height;
                            const pixelDist = Math.sqrt((pixelX - mousePixelX) ** 2 + (pixelY - mousePixelY) ** 2);
                            pixelDist <= MinPixelDistance && intersectObjs.push({ point, d: camera.position.distanceTo(point), p: pixelDist });
                        }
                    }
                }
            }
        }
        // console.timeEnd('raycaster');

        if (!intersectObjs.length) return [];

        intersectObjs.sort((a, b) => a.d - b.d);
        const tmps: any[] = [];
        for (let i = 0, minDist = intersectObjs[0].d, max = Math.min(intersectObjs.length, 20); i < max; i++) {
            intersectObjs[i].d - minDist < 0.01 && tmps.push(intersectObjs[i]);
        }
        tmps.sort((a, b) => a.p - b.p);
        return [tmps[0].point];
    });

    on(RaycasterRayDistanceToPoint, (mouseClientX: number, mouseClientY: number, point: Vector3): number => {
        const { width, height, left, top } = fire(GetCanvasSize);
        const mouse = new Vector2();
        mouse.x = ((mouseClientX - left) / width) * 2 - 1;
        mouse.y = ((top - mouseClientY) / height) * 2 + 1;

        const camera: PerspectiveCamera = fire(GetCamera);
        raycaster.setFromCamera(mouse, camera);
        return raycaster.ray.distanceToPoint(point);
    });
}
