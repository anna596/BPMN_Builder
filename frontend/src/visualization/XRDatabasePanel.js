import * as THREE from 'three';
import { makeButton } from './XRButtonFactory.js';
import penSrc from '../utils/images/pen.svg';

// Creates a non-interactive title label mesh.
function createTitleMesh(text) {
    const W = 380, H = 36, DPR = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * DPR; canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, H / 2);
    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.36, 0.034),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false })
    );
    mesh.renderOrder = 998;
    mesh.raycast = () => {};
    return mesh;
}

// Creates a wide text button showing a diagram name and last-updated date.
function createDiagramTextButton(name, date, onClick) {
    const W = 320, H = 56, DPR = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * DPR; canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');

    ctx.scale(DPR, DPR);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    const displayName = name.length > 30 ? name.slice(0, 29) + '…' : name;
    ctx.fillText(displayName, 6, 24);
    ctx.fillStyle = '#aaa';
    ctx.font = '13px sans-serif';
    ctx.fillText(date, 6, 44);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    const btn = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.055, 0.01),
        new THREE.MeshBasicMaterial({ map: texture, depthTest: false, transparent: true, depthWrite: true })
    );
    btn.renderOrder = 999;
    btn.userData.isXRButton = true;
    btn.userData.onClick = onClick;
    return btn;
}

// Creates a small square ✕ button with two-tap confirmation for deleting a diagram row.
// First tap: button turns bright red and shows "Sure?". Second tap: calls onClick.
function createDeleteButton(onClick) {
    const W = 40, H = 40, DPR = 2;

    function drawBtn(confirmed) {
        const canvas = document.createElement('canvas');
        canvas.width = W * DPR; canvas.height = H * DPR;
        const ctx = canvas.getContext('2d');
        ctx.scale(DPR, DPR);
        ctx.fillStyle = confirmed ? '#ff0000' : '#550000';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (confirmed) {
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('Sure?', W / 2, H / 2);
        } else {
            ctx.font = 'bold 22px sans-serif';
            ctx.fillText('✕', W / 2, H / 2);
        }
        return canvas;
    }

    const texture = new THREE.CanvasTexture(drawBtn(false));
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const btn = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.045, 0.008),
        new THREE.MeshBasicMaterial({ map: texture, depthTest: false, transparent: true, depthWrite: true })
    );
    btn.renderOrder = 999;
    btn.userData.isXRButton = true;
    btn.userData._deleteConfirming = false;

    btn.userData.onClick = () => {
        if (!btn.userData._deleteConfirming) {
            // First tap — enter confirmation state
            btn.userData._deleteConfirming = true;
            texture.image = drawBtn(true);
            texture.needsUpdate = true;
            // Auto-reset after 3 seconds if no second tap
            setTimeout(() => {
                if (btn.userData._deleteConfirming) {
                    btn.userData._deleteConfirming = false;
                    texture.image = drawBtn(false);
                    texture.needsUpdate = true;
                }
            }, 3000);
        } else {
            // Second tap — confirmed
            onClick();
        }
    };
    return btn;
}

// Creates a small square pen button with the icon drawn at 60% size (padded) for visual clarity.
function createPenButton(onClick) {
    const S = 0.045, D = 0.008;
    const W = 80, DPR = 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = W * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, W);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;

    const img = new Image();
    img.onload = () => {
        const pad = W * 0.22;
        ctx.drawImage(img, pad, pad, W - pad * 2, W - pad * 2);
        texture.needsUpdate = true;
    };
    img.src = penSrc;

    const btn = new THREE.Mesh(
        new THREE.BoxGeometry(S, S, D),
        new THREE.MeshBasicMaterial({ map: texture, depthTest: false, transparent: true, depthWrite: true })
    );
    btn.renderOrder = 999;
    btn.userData.isXRButton = true;
    btn.userData.onClick = onClick;
    return btn;
}

// Builds a floating 3D panel listing diagrams fetched from the database.
// isActive() is called before async results are applied — returns false if the panel was closed.
export function createDBLoaderPanel(persistence, onLoad, onClose, isActive, onRename) {
    const group = new THREE.Group();

    // Background
    const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.42),
        new THREE.MeshBasicMaterial({ color: 0x222222, opacity: 0.9, transparent: true, depthTest: false })
    );
    bg.renderOrder = 997;
    bg.raycast = () => {};
    group.add(bg);

    // Title
    const title = createTitleMesh('Load Diagram from Database');
    title.position.set(-0.0525, 0.17, 0.005);
    group.add(title);

    // Close button — same size as delete buttons (0.045)
    const closeBtn = makeButton('close', onClose, 0.045, 0.005);
    closeBtn.position.set(0.21, 0.17, 0.005);
    group.add(closeBtn);

    // Tags used to identify list items for removal on refresh
    const _listTag = Symbol('listItem');

    function clearList() {
        const toRemove = group.children.filter(c => c.userData[_listTag]);
        toRemove.forEach(c => group.remove(c));
    }

    function populateList() {
        clearList();

        const loadingEntry = createDiagramTextButton('Loading…', '', null);
        loadingEntry.userData.isXRButton = false;
        loadingEntry.userData[_listTag] = true;
        loadingEntry.position.set(-0.0525, 0, 0.01);
        group.add(loadingEntry);

        persistence.fetchDiagramsList()
            .then(diagrams => {
                if (!isActive()) return;
                clearList();

                if (diagrams.length === 0) {
                    const empty = createDiagramTextButton('No diagrams found', '', null);
                    empty.userData.isXRButton = false;
                    empty.userData[_listTag] = true;
                    empty.position.set(-0.0525, 0, 0.01);
                    group.add(empty);
                    return;
                }

                // Entries start at y=0.10, spaced 0.065 apart — all within panel bounds (±0.21)
                diagrams.slice(0, 5).forEach((d, i) => {
                    const date = new Date(d.updated_at).toLocaleDateString();
                    const y = 0.10 - i * 0.065;

                    const btn = createDiagramTextButton(d.name, date, () => onLoad(d.id));
                    btn.position.set(-0.0525, y, 0.01);
                    btn.userData[_listTag] = true;
                    group.add(btn);

                    const renameBtn = createPenButton(() => onRename?.(d.id, d.name, populateList));
                    renameBtn.position.set(0.16, y, 0.01);
                    renameBtn.userData[_listTag] = true;
                    group.add(renameBtn);

                    const delBtn = createDeleteButton(() => {
                        persistence.deleteDiagram(d.id)
                            .then(() => { if (isActive()) populateList(); })
                            .catch(() => {});
                    });
                    delBtn.position.set(0.21, y, 0.01);
                    delBtn.userData[_listTag] = true;
                    group.add(delBtn);
                });
            })
            .catch(() => {
                if (!isActive()) return;
                clearList();
                const err = createDiagramTextButton('Failed to load diagrams', '', null);
                err.userData.isXRButton = false;
                err.userData[_listTag] = true;
                err.position.set(-0.0525, 0, 0.01);
                group.add(err);
            });
    }

    populateList();
    return group;
}
