import * as THREE from 'three';

export class XRDebugPanel {
    constructor(scene, camera, maxLines = 8) {
        this.scene = scene;
        this.camera = camera;
        this.maxLines = maxLines;
        this.lines = [];

        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 512;

        this.texture = new THREE.CanvasTexture(this.canvas);
        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            depthTest: false
        });

        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.8, 0.4),
            material
        );
        this.mesh.renderOrder = 9999;
        this.scene.add(this.mesh);

        // Reusable vector to avoid per-frame allocation in update()
        this._dir = new THREE.Vector3();
    }

    log(...args) {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        this.lines.push(msg);
        if (this.lines.length > this.maxLines) this.lines.shift();
        this._render();
    }

    _render() {
        const ctx = this.canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = '#00ff00';
        ctx.font = '24px monospace';

        this.lines.forEach((line, i) => {
            ctx.fillText(line.substring(0, 60), 10, 30 + i * 30);
        });

        this.texture.needsUpdate = true;
    }

    update() {
        // Follow camera — place in front of view
        const cam = this.camera;
        this._dir.set(0, 0, -1).applyQuaternion(cam.quaternion);
        this.mesh.position.copy(cam.position).add(this._dir.multiplyScalar(1.0));
        this.mesh.position.y -= 0.3; // slightly below eye level
        this.mesh.quaternion.copy(cam.quaternion);
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.texture.dispose();
    }

    clear() {
        this.lines = [];
        this._render();
    }
}
