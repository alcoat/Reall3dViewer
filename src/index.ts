// ================================
// Copyright (c) 2025 reall3d.com
// ================================
import './reall3d/style/style.less';
import 'virtual:svg-icons-register';

import { Reall3dViewer } from './reall3d/viewer/Reall3dViewer';
import { Reall3dViewerOptions } from './reall3d/viewer/Reall3dViewerOptions';

const params: URLSearchParams = new URLSearchParams(location.search);
let url = params.get('url');
const debugMode = !!params.get('debug');

let viewer: Reall3dViewer;
if (url) {
    viewer = new Reall3dViewer({ debugMode });
    viewer.addModel(url);
    debugMode && initDevMode(true);
} else {
    viewer = new Reall3dViewer({ debugMode: true });
    viewer.addModel(`https://reall3d.com/demo-models/yz.spx`);

    initDevMode();
}

// 以下仅开发模式使用
function initDevMode(infoOnly = false) {
    document.querySelectorAll('.prd-mode').forEach(dom => dom['style'].removeProperty('display'));
    let spans: NodeListOf<HTMLSpanElement> = document.querySelectorAll('#gsviewer .operation span');
    let jsHeapSizeLimit = (performance['memory'] || { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 }).jsHeapSizeLimit;
    !jsHeapSizeLimit && document.querySelectorAll('.tr-memory').forEach(dom => dom.classList.toggle('hidden'));
    navigator.userAgent.includes('Mobi') && document.querySelectorAll('.tr-pc-only').forEach(dom => dom.classList.toggle('hidden'));
    document.querySelectorAll('.dev-panel').forEach(dom => dom['style'].removeProperty('display'));
    !infoOnly &&
        Array.from(spans).forEach(span => {
            span.addEventListener('click', function (e: MouseEvent) {
                let target: HTMLSpanElement = e.target as HTMLSpanElement;
                fnClick(target.className);
            });
        });
    infoOnly && document.querySelectorAll('.operation').forEach(dom => (dom['style'].display = 'none'));

    const gstext: HTMLInputElement = document.querySelector('.gstext');
    if (gstext) {
        gstext.addEventListener('keyup', function (e: Event) {
            window['$api']?.setWaterMark(gstext.value, false);
        });
    }
}

function fnClick(className: string) {
    if (className == 'switch-debug') {
        let txt = document.querySelector('#gsviewer .debug').classList.toggle('hidden') ? '＋' : '－';
        document.querySelector('#gsviewer .switch-debug').innerHTML = txt;
    } else if (className == 'op-show') {
        let txt = document.querySelector('#gsviewer .operation table').classList.toggle('plus') ? '＋' : '－';
        document.querySelector('#gsviewer .op-show').innerHTML = txt;
    } else if (className == 'demo1') {
        viewer.reset({ debugMode: true });
        setTimeout(() => viewer.addModel(`https://reall3d.com/demo-models/yz.meta.json`), 50); // Let it GC
    } else if (className == 'demo2') {
        viewer.reset({ debugMode: true });
        setTimeout(() => viewer.addModel(`https://reall3d.com/demo-models/jtstjg.spx`), 50); // Let it GC
    } else if (className == 'demo3') {
        viewer.reset({ debugMode: true });
        setTimeout(() => viewer.addModel(`https://reall3d.com/demo-models/djj.spx`), 50); // Let it GC
    } else if (className == 'demo4') {
        viewer.reset({ debugMode: true });
        setTimeout(() => viewer.addModel(`https://reall3d.com/demo-models/bzg.spx`), 50); // Let it GC
    } else if (className == 'big-lod') {
        // TODO 大场景LOD，重构改进使用spx
        // setTimeout(() => viewer.addScene(`https://reall3d.com/demo-models/lod-demo-spx.scene.json`), 50); // Let it GC
    } else if (className == 'switch-rotate') {
        let opts: Reall3dViewerOptions = viewer.options();
        viewer.options({ autoRotate: !opts.autoRotate });
    } else if (className == 'switch-pointcloudMode') {
        viewer.options({ pointcloudMode: !viewer.options().pointcloudMode });
    } else if (className == 'switch-deiplay-mode') {
        viewer.switchDeiplayMode();
    } else if (className == 'add-lightFactor') {
        viewer.options({ lightFactor: viewer.options().lightFactor + 0.1 });
    } else if (className == 'default-lightFactor') {
        viewer.options({ lightFactor: 1 });
    } else if (className == 'sub-lightFactor') {
        let opts: Reall3dViewerOptions = viewer.options();
        viewer.options({ lightFactor: opts.lightFactor - 0.1 });
    } else if (className == 'show-watermark') {
        viewer.fire(1, 1);
    } else if (className == 'hide-watermark') {
        viewer.fire(1, 0);
    } else if (className == 'mark-show') {
        viewer.options({ markVisible: true });
    } else if (className == 'mark-hide') {
        viewer.options({ markVisible: false });
    } else if (className == 'mark-save') {
        viewer.fire(6);
    } else if (className == 'mark-del') {
        viewer.fire(7);
    } else if (className == 'mark-point') {
        viewer.options({ markMode: true, markType: 'point' });
    } else if (className == 'mark-lines') {
        viewer.options({ markMode: true, markType: 'lines' });
    } else if (className == 'mark-plans') {
        viewer.options({ markMode: true, markType: 'plans' });
    } else if (className == 'mark-distance') {
        viewer.options({ markMode: true, markType: 'distance' });
    } else if (className == 'mark-circle') {
        viewer.options({ markMode: true, markType: 'circle' });
    } else if (className == 'add-pos') {
        viewer.fire(2);
    } else if (className == 'fly') {
        viewer.fire(3);
    } else if (className == 'clear-pos') {
        viewer.fire(4);
    } else if (className == 'fly-save') {
        viewer.fire(5);
    } else if (className == 'add-sh') {
        viewer.fire(8, 1);
    } else if (className == 'default-sh') {
        viewer.fire(8);
    } else if (className == 'sub-sh') {
        viewer.fire(8, -1);
    }
}
