import * as THREE from 'three';
import { createBPMNPanel, removePanel } from '../ui/BPMNPanel.js';
import { TransformControls} from "three/addons/controls/TransformControls.js";
import {Selector} from '../utils/selector.js';
import {updateArrow, updateAssociationArrow} from './ElementCreator.js';
import { createEditorPanel, removeEditorPanel } from "../ui/ObjectEditor.js";
import { DiagramState } from '../state/DiagramState.js';
import { ElementValidator } from "../validators/ElementValidator.js";
import { LabelManager } from "../managers/LabelManager.js";
import { PersistenceManager } from "../managers/PersistenceManager.js";
import{ createFileEditor } from "../ui/FileEditor.js";
import{ HistoryManager } from "../managers/HistoryManager.js";
import { createDatabaseLoader, promptDiagramName } from "../ui/DatabaseLoader.js";


// Manages the diagram lifecycle, selection, transformations, and UI panels
// Uses DiagramState for centralized state management
export class DiagramManager {
    constructor(sceneManager, camera, renderer, renderCallBack) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.scene;
        this.boardGroup = sceneManager.boardGroup; //contains grid, plane, and diagram elements
        
        this.camera = camera;
        this.renderer = renderer;
        this.render = renderCallBack;

        // Initialize state management
        this.state = new DiagramState();
        this.persistence = new PersistenceManager(this.state);
        
        this.transformControl = new TransformControls(camera, renderer.domElement);

        this.selector = new Selector(this.scene, this.camera, this.transformControl, this.state, this);

        this.history = new HistoryManager(this.state, this.boardGroup, this.persistence, this.transformControl, this.render, this.selector, () => renderer.xr.isPresenting);
        this.history.diagramManager = this;

        this.currentDiagramId = null;
        this.currentDiagramName = null;

        this.mode = 'view';
        this.bpmnPanel = null;
        this.editorPanel = null;
        this._editorPanelPos = null;

        this._initFilePanel();
        this._setupEventListeners();
        this.scene.add(this.transformControl.getHelper());

    }

    _initFilePanel() {
        this.filePanel = createFileEditor(this.persistence, {
            onAdd:              () => this.showBPMNPanel(),
            onOpen:             (file) => this.persistence.loadFromFile(file, this.boardGroup),
            onBack:             () => this.history.undo(),
            onForward:          () => this.history.redo(),
            onSave:             () => {
                if (this.currentDiagramId) {
                    this.persistence.updateDiagram(this.currentDiagramId, this.currentDiagramName)
                        .catch(e => this._notify(`Save failed: ${e.message}`));
                } else {
                    promptDiagramName('New Diagram').then(async name => {
                        if (!name) return;
                        try {
                            const result = await this.persistence.saveToDatabase(name);
                            this.currentDiagramId = result.id;
                            this.currentDiagramName = result.name;
                        } catch (e) {
                            this._notify(`Save failed: ${e.message}`);
                        }
                    });
                }
            },
            onSaveToDatabase:   () => this.saveToDatabase(),
            onLoadFromDatabase: () => this.showDatabaseLoader(),
            onNewDiagram:       () => this.newDiagram()
        });

    setInterval(() => {
        if (this.currentDiagramId) this.persistence.updateDiagram(this.currentDiagramId, this.currentDiagramName).catch(() => {});
    }, 15000);

    }

    // Registers transform, pointer, and keyboard event handlers.
    _setupEventListeners() {
        this.transformControl.addEventListener('change', this.render);

        this.transformControl.addEventListener('dragging-changed', (event) => {
            this.sceneManager.controls.enabled = !event.value;
        });

        // Start states saved at mouseDown — used to recompute multi-selection transforms each frame
        this._transformStart = null;

        this.transformControl.addEventListener('objectChange', () => {
            const moved = this.transformControl.object;
            if (!moved) return;

            // Prevent moving behind the grid (grid is at z = -50 in world space).
            // Use world position because labels are nested inside a labelGroup,
            // so their local z is not the same as board z.
            const worldZ = new THREE.Vector3();
            moved.getWorldPosition(worldZ);
            if (worldZ.z < -50) {
                // Convert target world z=-20 back to the object's local space
                const localTarget = moved.parent
                    ? moved.parent.worldToLocal(new THREE.Vector3(worldZ.x, worldZ.y, -20))
                    : new THREE.Vector3(moved.position.x, moved.position.y, -20);
                moved.position.z = localTarget.z;
            }

            // Update primary selection box
            if (this.selector.selected) {
                this.selector.selectionBox.setFromObject(this.selector.selected);
            }

            // Update label offset if it's being moved (applies to both element labels and arrow labels)
            if (moved.userData.isLabel) {
                moved.userData.offset = moved.position.clone();
            }

            // Apply same transform delta to all shift-selected elements.
            // Computed from start state to avoid floating-point drift.
            const ts = this._transformStart;
            if (ts && this.selector.multiSelected.length > 0) {
                const posDelta = new THREE.Vector3().subVectors(moved.position, ts.pos);
                const scaleRatio = new THREE.Vector3(
                    moved.scale.x / ts.scale.x,
                    moved.scale.y / ts.scale.y,
                    moved.scale.z / ts.scale.z,
                );
                const quatDelta = moved.quaternion.clone().multiply(ts.quat.clone().invert());

                for (let i = 0; i < this.selector.multiSelected.length; i++) {
                    const el = this.selector.multiSelected[i];
                    el.position.copy(ts.multiPos[i]).add(posDelta);
                    el.scale.copy(ts.multiScale[i]).multiply(scaleRatio);
                    el.quaternion.copy(ts.multiQuat[i]).premultiply(quatDelta);
                    this.updateConnections(el);
                    this.selector.multiSelectionBoxes[i].setFromObject(el);
                }
            }

            // Update all connections related to moved object
            this.updateConnections(moved);
            this.render();
        });

        // Forward pointer events to selector
        this.renderer.domElement.addEventListener('pointerdown', (event) => {
            if (!this.transformControl.dragging) {
                
                this._handleSelection(event);
            }
        });


        // Save start states for primary and all multi-selected elements
        this.transformControl.addEventListener('mouseDown', () => {
            const obj = this.transformControl.object;
            if (obj) {
                this._transformStart = {
                    pos:        obj.position.clone(),
                    scale:      obj.scale.clone(),
                    quat:       obj.quaternion.clone(),
                    multiPos:   this.selector.multiSelected.map(el => el.position.clone()),
                    multiScale: this.selector.multiSelected.map(el => el.scale.clone()),
                    multiQuat:  this.selector.multiSelected.map(el => el.quaternion.clone()),
                };
                this.history.saveSnapshot('transform element');
            }
        });

        this.renderer.domElement.addEventListener('dblclick', (event) => {
            if (!this.transformControl.dragging) {
                this.selector.onDoubleClick(event);
            }
        });

        window.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key === 'z') {
                this.history.undo();
            } else if (event.ctrlKey && event.key === 'y') {
                this.history.redo();
            } else if (event.ctrlKey && event.key === 's') {
                event.preventDefault();
                this.history.save();
            } else if (event.key === 'Delete' && this.state.selectedElement) {
                this.history.saveSnapshot('delete element');
                const primary = this.state.selectedElement;
                const extras = [...this.selector.multiSelected];
                this.selector.clearMultiSelection();
                for (const el of extras) this.deleteSelected(el, { skipSnapshot: true });
                this.deleteSelected(primary, {
                    skipSnapshot: true,
                    onDismiss: () => {
                        this.transformControl.detach();
                        if (this.selector.selectionBox) this.selector.selectionBox.visible = false;
                        if (this.editorPanel) { removeEditorPanel(this.editorPanel); this.editorPanel = null; }
                        this.render();
                    }
                });
            } else {
                this.selector.handleKeyInput(event);
            }
        });
    }

    // Handle element selection and editor panel management (open/close)
    _handleSelection(event) {
        if (event.shiftKey) {
            const element = this.selector.resolveElement(event);
            if (element) this.selector.shiftSelect(element);
            this.render();
            return;
        }

        const selectedElement = this.selector.onPointerDown(event);
        let selectedArrow = false;

        // Save position before removing old panel
        if (this.editorPanel?.dom.style.left) {
            this._editorPanelPos = {
                left: this.editorPanel.dom.style.left,
                top:  this.editorPanel.dom.style.top
            };
        }
        
        if (selectedElement) {
            this.state.selectedElement = selectedElement;
            selectedArrow = ElementValidator.isArrow(selectedElement);

            // Always rebuild the panel for the new selection so arrows get different options
            if (this.editorPanel) removeEditorPanel(this.editorPanel);

            this.editorPanel = createEditorPanel(
                this.state,
                this.selector,
                this.transformControl,
                this,
                selectedArrow
            );
            // Restore dragged position if panel was moved before
            if (this._editorPanelPos) {
                this.editorPanel.dom.style.left = this._editorPanelPos.left;
                this.editorPanel.dom.style.top  = this._editorPanelPos.top;
            }
        } else {
            this.state.selectedElement = null;
            if (this.editorPanel) {
                removeEditorPanel(this.editorPanel);
                this.editorPanel = null;
            }
        }
    }

    showBPMNPanel() {
        if(this.bpmnPanel) return; //already open
        this.mode = 'edit';
        this.bpmnPanel = createBPMNPanel(this.state, this.boardGroup, this.camera, this.renderer, this.selector, this);
    }

    hideBPMNPanel() {
        if(!this.bpmnPanel) return;
        removePanel(this.bpmnPanel);
        this.bpmnPanel = null;
        this.mode = 'view';
    }

    // Update arrow positions when an element is moved
    // Finds all connections related to the moved element
    updateConnections(moved) {
        const logical = getLogicalElement(moved);
        
        for (const conn of this.state.connections) {
            if (conn.logicalSource === logical || conn.logicalTarget === logical) {
                if (conn.type === 'association') updateAssociationArrow(conn);
                else updateArrow(conn);
            }
        }
    }

    // Update connection references when an element is replaced
    // Used when labels are added/removed from elements
    updateConnectionReferences(oldElement, newElement) {
        const oldLogical = getLogicalElement(oldElement);
        const newLogical = getLogicalElement(newElement);

        for (const conn of this.state.connections) {
            let updated = false;

            if (conn.logicalSource === oldLogical || conn.logicalSource === oldElement) {
                conn.logicalSource = newLogical;
                updated = true;
            }
            if (conn.logicalTarget === oldLogical || conn.logicalTarget === oldElement) {
                conn.logicalTarget = newLogical;
                updated = true;
            }
            if (conn.source === oldElement) {
                conn.source = newElement;
                updated = true;
            }
            if (conn.target === oldElement) {
                conn.target = newElement;
                updated = true;
            }

            if (updated) {
                if (conn.type === 'association') updateAssociationArrow(conn);
                else updateArrow(conn);
            }
        }
    }

    // Handles label add/edit for any element type.
    // openEditor(target, parent) is the mechanism for opening the editor — defaults to the XR keyboard manager,
    // but callers can pass selector.editLabel for desktop use.
    editLabel(selected, { onDismiss, onSelect, openEditor } = {}) {
        if (!selected) return;
        const keyboardManager = this.sceneManager?.keyboardManager;
        // When keyboard closes, restore the edited element as selected so edit buttons reappear.
        const reselect = onSelect ? () => onSelect(selected) : () => {};
        const open = openEditor ?? ((target, parent) => {
            if (keyboardManager) {
                keyboardManager.onLabelUpdated = (label) => {
                    const xr = this.sceneManager?.directInteraction ?? this.sceneManager?.indirectInteraction;
                    xr?.showSelectionBox(label);
                };
            }
            if (ElementValidator.isTask(target)) keyboardManager?.openForTask(target, reselect);
            else keyboardManager?.openForLabel(target, parent, reselect);
        });

        if (ElementValidator.isLabel(selected)) {
            this.history.saveSnapshot('edit label');
            open(selected, selected.parent);
            onDismiss?.();
            onSelect?.(selected);
            return;
        } else if (ElementValidator.isTask(selected)) {
            this.history.saveSnapshot('edit task label');
            open(selected, null);
            onDismiss?.();
            onSelect?.(selected);
            return;
        } else if (ElementValidator.isArrow(selected)) {
            if (ElementValidator.hasLabel(selected)) {
                this.history.saveSnapshot('edit arrow label');
                const arrowLabel = selected.userData.label;
                open(arrowLabel, selected);
                onDismiss?.();
                onSelect?.(arrowLabel);
            } else {
                this.history.saveSnapshot('add arrow label');
                const label = LabelManager.addLabelToArrow(selected, this.state);
                if (label) { open(label, selected); onDismiss?.(); onSelect?.(label); }
                else onDismiss?.();
            }
            return;
        } else if (ElementValidator.hasLabel(selected)) {
            const label = selected.userData.label;
            if (label) {
                this.history.saveSnapshot('edit element label');
                open(label, selected);
                onDismiss?.();
                onSelect?.(label);
                return;
            }
            onDismiss?.();
            return;
        } else if (ElementValidator.canAddLabelToElement(selected)) {
            this.history.saveSnapshot('add element label');
            const labelGroup = LabelManager.addLabelToElement(selected, this.state, this.boardGroup, this);
            if (labelGroup) {
                this.state.selectedElement = labelGroup;
                // Use empty reselect — onSelect(labelGroup) below sets up the UI immediately
                const openLabel = openEditor ?? ((target, parent) => keyboardManager?.openForLabel(target, parent, () => {}));
                openLabel(labelGroup.userData.label, labelGroup);
                onDismiss?.();
                onSelect?.(labelGroup);
                return;
            }
        }
        onDismiss?.();
    }

    // Deletes the selected element, label, or arrow and all its associated connections.
    // Shared by direct interaction, indirect interaction, and the desktop ObjectEditor.
    // Pass skipSnapshot: true when the caller has already saved a snapshot (e.g. batch delete).
    deleteSelected(selected, { onDismiss, skipSnapshot = false } = {}) {
        if (!selected) return;

        if (ElementValidator.isLabel(selected)) {
            const action = selected.parent?.userData?.isArrow ? 'remove arrow label' : 'remove element label';
            if (!skipSnapshot) this.history.saveSnapshot(action);
            LabelManager.removeLabel(selected, this.state, this.boardGroup, this);
            this.state.selectedElement = null;
            onDismiss?.();
            return;
        }

        if (!skipSnapshot) this.history.saveSnapshot('delete element');

        if (ElementValidator.isArrow(selected)) {
            const conn = this.state.connections.find(c => c.group === selected);
            if (conn) this.state.removeConnection(conn);
        } else {
            const logical = getLogicalElement(selected);
            this.state.connections
                .filter(c => c.logicalSource === logical || c.logicalTarget === logical
                          || c.source === selected || c.target === selected)
                .forEach(c => {
                    if (c.group.parent) c.group.parent.remove(c.group);
                    this.state.removeConnection(c);
                });
        }

        this.state.removeElement(selected);
        this.boardGroup.remove(selected);
        this.state.selectedElement = null;
        onDismiss?.();
    }

    // Saves current diagram to database.
    // In XR: always prompts for name (pre-filled with current name) so the user can rename.
    // On desktop: prompts only for new diagrams; existing diagrams update silently.
    async saveToDatabase() {
        if (this._isXRPresenting()) {
            const keyboard = this.sceneManager?.keyboardManager;
            if (!keyboard) {
                console.warn('saveToDatabase: keyboard manager not available');
                return;
            }
            if (this.currentDiagramId) {
                try {
                    await this.persistence.updateDiagram(this.currentDiagramId, this.currentDiagramName);
                    this._notify(`Updated "${this.currentDiagramName}"`);
                } catch (error) {
                    this._notify(`Failed to save diagram: ${error.message}`);
                }
            } else {
                keyboard.promptText('', async (name) => {
                    if (!name) return;
                    try {
                        const result = await this.persistence.saveToDatabase(name);
                        this.currentDiagramId = result.id;
                        this.currentDiagramName = result.name;
                        this._notify(`Saved "${name}"`);
                    } catch (error) {
                        this._notify(`Failed to save diagram: ${error.message}`);
                    }
                });
            }
            return;
        }

        // Desktop path — existing diagram: save silently with notification; new diagram: prompt for name
        if (this.currentDiagramId) {
            try {
                await this.persistence.updateDiagram(this.currentDiagramId, this.currentDiagramName);
                this._notify(`Diagram "${this.currentDiagramName}" saved.`);
            } catch (error) {
                this._notify(`Failed to save diagram: ${error.message}`);
            }
        } else {
            const name = await promptDiagramName('New Diagram');
            if (!name) return;
            try {
                const result = await this.persistence.saveToDatabase(name);
                this.currentDiagramId = result.id;
                this.currentDiagramName = result.name;
                this._notify(`Diagram "${name}" saved to database!`);
            } catch (error) {
                this._notify(`Failed to save diagram: ${error.message}`);
            }
        }
    }

    // Show database loader UI
    showDatabaseLoader() {
        createDatabaseLoader(
            this.persistence,
            (diagramId) => this.loadFromDatabase(diagramId)
        );
    }

    // Load a diagram from database by ID
    async loadFromDatabase(diagramId) {
        try {
            const result = await this.persistence.loadFromDatabase(diagramId, this.boardGroup);
            this.currentDiagramId = result.id;
            this.currentDiagramName = result.name;
            this._clearSelectionState();
            this.render();
        } catch (error) {
            this._notify(`Failed to load diagram: ${error.message}`);
        }
    }

    _notify(message) {
        if (this._isXRPresenting()) {
            this._notifyXR(message);
        } else {
            const toast = document.createElement('div');
            toast.textContent = message;
            toast.style.cssText = [
                'position:fixed', 'bottom:10%', 'left:50%', 'transform:translateX(-50%)',
                'background:rgba(0,0,0,0.78)', 'color:#fff', 'font-size:15px',
                'padding:10px 22px', 'border-radius:10px', 'pointer-events:none',
                'font-family:Arial', 'text-align:center', 'max-width:80%', 'z-index:99999',
            ].join(';');
            document.body.appendChild(toast);
            setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
        }
    }

    // Shows a floating 3D text panel in the XR scene, in front of the camera.
    _notifyXR(message) {
        const W = 512, H = 96, DPR = 2;
        const canvas = document.createElement('canvas');
        canvas.width = W * DPR; canvas.height = H * DPR;
        const ctx = canvas.getContext('2d');
        ctx.scale(DPR, DPR);
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.beginPath();
        ctx.roundRect(0, 0, W, H, 20);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '26px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(message, W / 2, H / 2);

        const texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.5, 0.09),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false })
        );
        mesh.renderOrder = 9999;

        // Position 0.8m in front of the camera, slightly below eye level
        const cam = this.renderer.xr.getCamera();
        const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        mesh.position.copy(camPos).addScaledVector(camDir, 0.8);
        mesh.position.y -= 0.15;
        mesh.lookAt(camPos);

        this.scene.add(mesh);
        setTimeout(() => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.map.dispose();
            mesh.material.dispose();
        }, 4000);
    }

    _isXRPresenting() {
        return this.renderer.xr?.isPresenting ?? false;
    }

    // Clears selection visuals and detaches transform controls.
    _clearSelectionState() {
        this.transformControl?.detach();
        this.state.selectedElement = null;
        if (this.selector) {
            this.selector.selected = null;
            this.selector.clearMultiSelection();
            if (this.selector.selectionBox) this.selector.selectionBox.visible = false;
        }
        if (this.editorPanel) { removeEditorPanel(this.editorPanel); this.editorPanel = null; }
    }

    // Create a new blank diagram
    newDiagram() {
        this.history.saveSnapshot('new diagram');
        this._clearSelectionState();
        this.persistence._resetState(this.boardGroup);
        this.currentDiagramId = null;
        this.currentDiagramName = null;
    }
}

// Get the logical element for connections
// Returns the labelGroup if the object is inside one, otherwise returns the object itself
export function getLogicalElement(obj) {
    if (!obj) return null;
    
    // Inside a labelGroup --> return the group
    if (obj.parent?.userData?.hasLabel) {
        return obj.parent;
    }
    // A labelGroup itself --> return obj
    if (obj.userData?.hasLabel) {
        return obj;
    }
   
    return obj;
}




