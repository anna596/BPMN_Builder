import * as THREE from 'three';
import { ElementValidator } from '../validators/ElementValidator.js';
import { createDBLoaderPanel } from '../visualization/XRDatabasePanel.js';

// Base class for XR interaction modes (direct and indirect).
// Provides shared raycasting, hover feedback, two-hand scaling, and label orientation.
export class XRInteraction {
    constructor(renderer, scene, boardGroup, diagramManager, hands, pointers, onExitXR) {
        this.renderer = renderer;
        this.scene = scene;
        this.boardGroup = boardGroup;
        this.diagramManager = diagramManager;
        this.onExitXR = onExitXR;
        this.hands = hands || [];
        this.handPointers = pointers || [];

        this.twoHandScale = { active: false, initialDist: 0, initialScale: null };

        this.activeButtonGroup = null;  // currently visible XR button group
        this.selectedElement = null;
        this.hoveredElement = null;
        this.hoveredOriginalScale = null;
        this.activeTransformMode = null;  // 'translate' | 'scale' | 'rotate'
        this._testObjects = [];  // objects checked during raycasting, set by subclasses

        // Reusable vector to avoid per-frame allocations 
        this._tmpVec = new THREE.Vector3();

        this.selectionBox = new THREE.BoxHelper(undefined, 0xffff00);
        this.selectionBox.visible = false;
        this.scene.add(this.selectionBox);

        this._dbLoaderPanel = null;
    }

    get state() { return this.diagramManager.state; }

    // Finds the closest valid hit across all test objects for a given pointer.
    // Calls _resolveHit to determine what counts as a valid target — override in subclasses.
    _raycast(pointer) {
        let closestHit = null;
        let closestDist = Infinity;
        for (const obj of this._testObjects) {
            const intersections = pointer.intersectObject(obj, true);
            if (!intersections || intersections.length === 0 || intersections[0].distance >= closestDist) continue;
            closestDist = intersections[0].distance;
            const hit = this._resolveHit(intersections[0].object);
            if (hit) closestHit = hit;
        }
        // 0.3m fallback keeps the cursor visible at a neutral distance when nothing is hit
        return { hit: closestHit, dist: closestHit ? closestDist : 0.3 };
    }

    // Resolves a intersection object to the logical hit target.
    // Override in subclasses to define what counts as a valid hit.
    _resolveHit(_object) { return null; }

    // Highlights the closest hovered button by scaling it up slightly.
    _updateHover() {
        let hoverHit = null;
        for (const pointer of this.handPointers) {
            const { dist, hit } = this._raycast(pointer);
            pointer.setCursor(dist);
            if (hit && !hoverHit) hoverHit = hit;
        }
        if (hoverHit !== this.hoveredElement) {
            if (this.hoveredElement) this.hoveredElement.scale.copy(this.hoveredOriginalScale);
            if (hoverHit) {
                this.hoveredOriginalScale = hoverHit.scale.clone();
                hoverHit.scale.multiplyScalar(1.1);
            }
            this.hoveredElement = hoverHit;
        }
    }

    // Returns the world position of the index finger tip, falling back to the hand origin.
    _getPinchPosition(hand) {
        const tip = hand.joints?.['index-finger-tip'];
        if (tip) tip.getWorldPosition(this._tmpVec);
        else hand.getWorldPosition(this._tmpVec);
        return this._tmpVec;
    }

    // Scales target based on the distance between both pinched hands.
    // Gesture starts when both hands pinch; scale updates continuously until one hand releases.
    _updateTwoHandScale(target, onScale = null) {
        if (!target) { this.twoHandScale.active = false; return; }

        const p0 = this.handPointers[0];
        const p1 = this.handPointers[1];
        if (!p0 || !p1) return;

        const bothPinching = p0.isPinched() && p1.isPinched();

        if (bothPinching) {
            const pos0 = this._getPinchPosition(this.hands[0]).clone();
            const pos1 = this._getPinchPosition(this.hands[1]);
            const dist = pos0.distanceTo(pos1);

            if (!this.twoHandScale.active) {
                // Require hands to be at least 8cm apart to start — rejects tracking glitches
                // where both hands briefly register as pinched at nearly the same position.
                if (dist < 0.08) return;
                // Gesture start — record baseline distance and scale
                this.twoHandScale.active = true;
                this.twoHandScale.initialDist = dist;
                this.twoHandScale.initialScale = target.scale.clone();
            } else {
                // Scale proportional to how much the hands moved apart
                const factor = dist / this.twoHandScale.initialDist;
                const newScale = this.twoHandScale.initialScale.clone().multiplyScalar(factor);
                newScale.clampScalar(0.1, 5);
                target.scale.copy(newScale);
                onScale?.(target);
            }
        } else {
            this.twoHandScale.active = false;
        }
    }

    // Shows a yellow bounding box around the selected element, or hides it if element is null.
    showSelectionBox(element) {
        if (element) {
            this.selectionBox.setFromObject(element);
            this.selectionBox.visible = true;
        } else {
            this.selectionBox.visible = false;
        }
    }

    // Makes all element labels face the XR camera so they're readable from any angle
    _orientLabels() {
        const cam = this.renderer.xr.getCamera();
        cam.getWorldPosition(this._tmpVec);

        for (const el of this.state.elements) {
            if (el.userData.label) el.userData.label.lookAt(this._tmpVec);
            if (ElementValidator.isLabel(el)) el.lookAt(this._tmpVec);
        }
        for (const conn of this.state.connections) {
            if (conn.label) conn.label.lookAt(this._tmpVec);
        }
    }

    // Opens a floating 3D panel listing diagrams from the database.
    // Positioned 0.7m in front of the user and facing them.
    showDBLoader() {
        if (this._dbLoaderPanel) return;
        const panel = createDBLoaderPanel(
            this.diagramManager.persistence,
            (id) => { this.hideDBLoader(); this.diagramManager.loadFromDatabase(id); },
            () => this.hideDBLoader(),
            () => this._dbLoaderPanel === panel,
            (id, currentName, refresh) => {
                this.diagramManager.sceneManager.keyboardManager.promptText(currentName, (newName) => {
                    if (newName && newName !== currentName) {
                        this.diagramManager.persistence.renameDiagram(id, newName)
                            .then(() => { if (this._dbLoaderPanel === panel) refresh(); })
                            .catch(() => {});
                    }
                });
            }
        );
        this._dbLoaderPanel = panel;

        const cam = this.renderer.xr.getCamera();
        const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        panel.position.copy(camPos.clone().addScaledVector(camDir, 0.7));
        panel.lookAt(camPos);
        this.scene.add(panel);
    }

    // Removes and disposes the DB loader panel.
    hideDBLoader() {
        if (!this._dbLoaderPanel) return;
        this.scene.remove(this._dbLoaderPanel);
        this._disposeGroup(this._dbLoaderPanel);
        this._dbLoaderPanel = null;
    }

    // Removes the selectionBox from the scene and frees its GPU resources.
    // Call super.dispose() from subclasses to clean up shared base state.
    dispose() {
        this.hideDBLoader();
        this.scene.remove(this.selectionBox);
        this.selectionBox.geometry?.dispose();
        this.selectionBox.material?.dispose();
    }

    // Frees GPU memory for all geometries and materials in a group
    _disposeGroup(group) {
        if (!group) return;
        group.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => {
                    Object.keys(m).forEach(key => {
                        if (m[key]?.isTexture) m[key].dispose();
                    });
                    m.dispose();
                });
            }
        });
    }
}