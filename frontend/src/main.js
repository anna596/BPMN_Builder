import * as THREE from 'three';
import { SceneManager } from './scene/sceneManager.js';
import { DiagramManager } from './diagram/DiagramManager.js';


let xrErrorShown = false;

let container = document.getElementById('container');
const sceneManager = new SceneManager(container);
const camera = sceneManager.camera;
const scene = sceneManager.scene;
const diagramManager = new DiagramManager(sceneManager, camera, sceneManager.renderer, render);
diagramManager.history.loadSave(); // Restore last saved diagram
// Pre-compile shaders in desktop mode to reduce GPU spike on first XR frames
sceneManager.renderer.compileAsync(scene, camera).catch(e => {
    console.warn('Desktop shader pre-compile failed:', e);
});

// Connect diagramManager to sceneManager for XR hand interaction
sceneManager.setDiagramManager(diagramManager);


// TO DO: remove this function later
// 3D error display for XR debugging
function showXRError(scene, camera, message) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(200, 0, 0, 0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '32px monospace';
    ctx.fillText(message.substring(0, 80), 20, 80);
    ctx.fillText(message.substring(80, 160), 20, 130);

    const texture = new THREE.CanvasTexture(canvas);
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.25),
        new THREE.MeshBasicMaterial({ map: texture, depthTest: false })
    );
    plane.renderOrder = 9999;

    // Place in front of camera
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    plane.position.copy(camera.position).add(dir.multiplyScalar(0.8));
    plane.quaternion.copy(camera.quaternion);

    scene.add(plane);
}


// TO DO: remove later
// XR debug overlay — shows errors as floating text
window.addEventListener('error', (e) => {
    if (!xrErrorShown) {
        xrErrorShown = true;
        const renderer = sceneManager.renderer;
        const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
        showXRError(scene, cam, e.message + ' at ' + e.filename + ':' + e.lineno);
    }
});
sceneManager.renderer.setAnimationLoop(render);



// TO DO: change later (to not display errors)
function render() {
    sceneManager.initFirstXRFrame();
    const renderer = sceneManager.renderer;

    if (!renderer.xr.isPresenting) xrErrorShown = false;

    if (sceneManager.directInteraction) {
        try {
            sceneManager.directInteraction.update();
        } catch (e) {
            console.error('DirectInteraction error:', e);
            if (!xrErrorShown) {
                xrErrorShown = true;
                const xrCam = renderer.xr.getCamera();
                showXRError(scene, xrCam, e.message);
            }
        }
    }

    if (sceneManager.indirectInteraction) {
        try {
            sceneManager.indirectInteraction.update();
        } catch (e) {
            console.error('IndirectInteraction error:', e);
            if (!xrErrorShown) {
                xrErrorShown = true;
                showXRError(scene, renderer.xr.getCamera(), e.message);
            }
        }
    }

    try {
        renderer.render(scene, camera);
    } catch (e) {
        console.error('Render error:', e);
    }
}


