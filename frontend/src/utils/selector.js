import * as THREE from 'three';
import {updateLabel, updateTaskLabel} from '../diagram/ElementCreator.js';
import { ElementValidator } from '../validators/ElementValidator.js';

/**
 * Manages element selection via raycasting
 * Handles selection box visualization and transform control attachment
 * Uses DiagramState to track selected elements
 */
export class Selector {
    constructor(scene, camera, transformControls, state, diagramManager) {
        this.scene = scene;
        this.camera = camera;
        this.transformControls = transformControls;
        this.state = state;
        this.diagramManager = diagramManager;

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.selected = null;
        this.activeLabel = null;

        this.selectionBox = new THREE.BoxHelper(undefined, 0xffff00);
        this.selectionBox.visible = false;
        this.scene.add(this.selectionBox);

        this.multiSelected = [];       // additional shift-selected elements
        this.multiSelectionBoxes = []; // one BoxHelper per extra element

        this.arrowMode = false;
    }

   
    // Enable/disable arrow creation mode
    // In arrow mode, transform controls are disabled
    setArrowMode(enabled) {
        this.arrowMode = enabled;   
    }

    // Get all BPMN elements the pointer intersected with via raycasting
    getPointerIntersects(event) {
        // Normalize pointer coordinates 
        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);

        // Get all elements and connections from state
        const elements = this.state.elements;
        const connections = this.state.getConnectionGroups();
    
        const allObjects = [...elements, ...connections];
        
        const intersects = this.raycaster.intersectObjects(allObjects, true);

        return intersects;
    }

    // Clears the extra shift-selected elements and removes their boxes.
    clearMultiSelection() {
        for (const box of this.multiSelectionBoxes) {
            this.scene.remove(box);
            box.geometry?.dispose();
        }
        this.multiSelected = [];
        this.multiSelectionBoxes = [];
    }

    // Toggles an element in the multi-selection set (Shift+click).
    shiftSelect(object) {
        if (!object) return;
        const idx = this.multiSelected.indexOf(object);
        if (idx !== -1) {
            const box = this.multiSelectionBoxes[idx];
            this.scene.remove(box);
            box.geometry?.dispose();
            this.multiSelected.splice(idx, 1);
            this.multiSelectionBoxes.splice(idx, 1);
        } else {
            const box = new THREE.BoxHelper(object, 0xffff00);
            box.setFromObject(object);
            box.scale.multiplyScalar(1.02);
            this.scene.add(box);
            this.multiSelected.push(object);
            this.multiSelectionBoxes.push(box);
        }
    }

    // Select an object and show selection visuals
    // Attaches transform control if allowed
    select(object, allowTransform = true) {
        if (this.arrowMode) allowTransform = false;

        // Element already selected
        if (this.selected === object) {
            return;
        }

        this.clearMultiSelection();
        this.selectionBox.visible = false;
        this.selected = object;
        
        // If selected an object, display selectionBox and attach transform controls
        if (object) {
            this.selectionBox.setFromObject(object);
            this.selectionBox.scale.multiplyScalar(1.02);
            this.selectionBox.visible = true;

            if(ElementValidator.isArrow(object)){
                allowTransform = false;
            }
            if (allowTransform) {
                this.transformControls.attach(object);
            } else {
                this.transformControls.detach();
            }
        } else {
            this.transformControls.detach();
        }
    }

    // Resolves the topmost BPMN element under the pointer without changing selection.
    resolveElement(event) {
        const intersects = this.getPointerIntersects(event);
        if (intersects.length === 0) return null;

        let hit = intersects[0].object;
        if (ElementValidator.isLabel(hit) || ElementValidator.isTask(hit)) return hit;

        let current = hit;
        while (current.parent && !ElementValidator.isValidBPMNElement(current)) current = current.parent;

        if (ElementValidator.isValidBPMNElement(current)) {
            if (!current.userData.hasLabel && current.parent?.userData?.hasLabel) current = current.parent;
            return current;
        }
        return null;
    }

    // Handle pointer down event - select element at cursor
    onPointerDown(event) {
        if (this.activeLabel) this.activeLabel = null;

        const resolved = this.resolveElement(event);
        this.select(resolved);
        return resolved;
    }

    // Handle double click event - enter label edit mode
    onDoubleClick(event) {
        const intersects = this.getPointerIntersects(event);
        if (intersects.length === 0) return;

        let object = intersects[0].object;
        
        // Traverse up to find label or task
        while (object.parent && !ElementValidator.isLabel(object) && !ElementValidator.isTask(object) && !ElementValidator.isValidBPMNElement(object)) {
            object = object.parent;
        }

        // Enter edit mode for labels and tasks
        if (ElementValidator.isLabel(object) || ElementValidator.isTask(object)) {
            this.diagramManager?.history.saveSnapshot('edit label');
            this.editLabel(object);
            return;
        }
    }

    // Handle keyboard input while editing a label
    // Supports text input, backspace, and enter to finish editing
    handleKeyInput(event) {
        if (!this.activeLabel) return;

        if (event.key === "Backspace") {
            this.activeLabel.userData.text = this.activeLabel.userData.text.slice(0, -1);
        } else if (event.key === "Enter") {
            this.activeLabel = null; 
            return;
        } else if (event.key.length === 1) {
            if (this.activeLabel.userData.text.length < 200)
                this.activeLabel.userData.text += event.key;
        }

        // Update the label texture based on type
        if (ElementValidator.isTask(this.activeLabel)) {
            updateTaskLabel(this.activeLabel, this.activeLabel.userData.text);
        } else if (ElementValidator.isLabel(this.activeLabel)) {
            updateLabel(this.activeLabel, this.activeLabel.userData.text, 200, 0.5);
        }

        // Refresh selection box to match updated geometry and position
        if (this.selectionBox.visible) {
            this.activeLabel.updateWorldMatrix(true, true);
            this.selectionBox.setFromObject(this.activeLabel);
            this.selectionBox.scale.multiplyScalar(1.02);
        }
    }

    // Enter label edit mode
    // Detaches transform controls and activates keyboard input for text editing
    editLabel(labelMesh) {
        this.selectionBox.visible = false;
        labelMesh.updateWorldMatrix(true, true);
        this.selectionBox.setFromObject(labelMesh);
        this.selectionBox.scale.multiplyScalar(1.02);
        this.selectionBox.visible = true;

        this.transformControls.detach();
        this.activeLabel = labelMesh;
        
        if (!this.activeLabel.userData.text) {
            this.activeLabel.userData.text = "";
        }
    }
}
