import * as THREE from 'three';
import { ElementValidator } from '../validators/ElementValidator.js';
import { createArrow, createAssociationArrow } from '../diagram/ElementCreator.js';
import { getLogicalElement } from '../diagram/DiagramManager.js';
import { createPanel, createPersistentButtons, createElementEditButtons, createTranslateButtons, createScaleButtons, createRotateButtons, createIndirectAddButtons, layoutTransformButtons } from '../visualization/indirect/PanelCreator.js';
import { XRInteraction } from './XRInteraction.js';
import { layoutButtons } from '../visualization/XRButtonFactory.js';

/**
 * Indirect XR interaction: user navigates elements via arrow buttons on a floating panel
 * and confirms selection with a select button.
 */
export class IndirectInteraction extends XRInteraction {
    constructor(renderer, scene, boardGroup, diagramManager, hands, pointers, onExitXR, onSwitchMode) {
        super(renderer, scene, boardGroup, diagramManager, hands, pointers, onExitXR);

        this.onSwitchMode = onSwitchMode;

        this._pointerWasPinched = [false, false]; // previous frame pinch state, one per hand
        this._pinchFreeForScale = [false, false]; // true while hand is pinching without hitting any button/drag handle

        this.arrowSource = null; // source element while user picks an arrow/association target
        this.arrowType = 'arrow'; // 'arrow' | 'association'
        this.navElement = null; // element highlighted by navigation, not yet confirmed
        this._returnToMainView = null; // callback to return from a transform sub-view

        this.arrowSourceBox = new THREE.BoxHelper(undefined, 0xffff00); // highlights arrow source
        this.arrowSourceBox.visible = false;
        this.scene.add(this.arrowSourceBox);

        this._dragging = false; // panel drag state
        this._dragHand = -1;
        this._dragOffset = new THREE.Vector3();

        // Controller target ray spaces give correct world-space rays for far/indirect interaction.
        // OculusHandPointerModel mis-applies a world-space quaternion in local hand space, which
        // causes the ray to drift off-target when the arm is extended away from the body.
        this._controllers = [0, 1].map(i => this.renderer.xr.getController(i));
        this._controllerRaycaster = new THREE.Raycaster();
        this._tmpMatrix = new THREE.Matrix4();

        this._initButtons();

        this.panel = this._createInteractionPanel();
        this._updateLeftButtons(); // set initial layout (no element selected)
    }

    // Creates all persistent panel buttons (reused across layout updates)
    _initButtons() {
        Object.assign(this, createPersistentButtons(this.diagramManager, {
            onAdd:        () => this._onAddBtn(),
            onUndo:       () => this._onHistoryAction(() => this.diagramManager.history.undo()),
            onRedo:       () => this._onHistoryAction(() => this.diagramManager.history.redo()),
            onViewBack:   () => this._returnToMainView?.(),
            onNewDiagram: () => this._onNewDiagram(),
            onLoadDB:     () => this._onLoadDBBtn(),
        }));

        // Element-specific buttons — recreated each time an element is confirmed
        this.labelBtn = this.deleteBtn = this.translateBtn = this.scaleBtn = this.rotateBtn = null;
    }

    // Undo / redo with selection restore
    _onHistoryAction(action){
        const prevId = this.selectedElement?.uuid;
        action();
        this._clearSelection();
        if (prevId) {
            const restored = this.state.elements.find(e => e.uuid === prevId);
            if (restored) { this.navElement = restored; this._navConfirm(); }
        }
    }

    _onNewDiagram() {
        this._clearSelection();
        this.diagramManager.newDiagram();
    }

    // Opens the shared 3D database loader panel (defined in XRInteraction base class).
    _onLoadDBBtn() {
        this.showDBLoader();
    }

    // Hides the interaction panel before opening the DB loader, then restores it on close.
    showDBLoader() {
        this.panel.visible = false;
        super.showDBLoader();
    }

    hideDBLoader() {
        super.hideDBLoader();
        this.panel.visible = true;
    }

    // --- Left button layout ---

    // Rebuilds the left panel area. Pass transformButtons to enter a transform sub-view.
    _updateLeftButtons(transformButtons = null) {
        const leftGroup = this.panel.userData.leftGroup;
        const arrowBtns = this.panel.userData.arrowBtns;

        // Restore arrow nav (may have been hidden by transform view)
        if (arrowBtns && !arrowBtns.parent) this.panel.add(arrowBtns);

        // Clear left group
        while (leftGroup.children.length > 0) leftGroup.remove(leftGroup.children[0]);

        const selected = this.selectedElement;
        const pos = new THREE.Vector3(-0.32, 0.22, 0.01);
        let buttons, cols;

        if (transformButtons) {
            // Hide arrow nav during transform
            if (arrowBtns?.parent) this.panel.remove(arrowBtns);

            leftGroup.position.set(0, 0, 0);

            // viewBackBtn in the bottom right corner
            this.viewBackBtn.position.set(0.32, -0.22, 0.01);
            leftGroup.add(this.viewBackBtn);

            if (transformButtons.length === 6) {
                // Cross layout for translate / rotate
                layoutTransformButtons(transformButtons);
                transformButtons.forEach(btn => leftGroup.add(btn));
            } else {
                // Scale: 2 buttons centered in the panel
                const s = 0.12;
                transformButtons[0].position.set(-s / 2, 0, 0.01);
                transformButtons[1].position.set( s / 2, 0, 0.01);
                transformButtons.forEach(btn => leftGroup.add(btn));
            }
            return;
        } else if (!selected) {
            buttons = [this.addBtn, this.backBtn, this.forwardBtn, this.loadDBBtn, this.saveDBBtn, this.newDiagramBtn];
            cols = 3;
        } else if (ElementValidator.isArrow(selected)) {
            buttons = [this.backBtn, this.forwardBtn, this.labelBtn, this.deleteBtn];
            cols = 2;
        } else if (ElementValidator.isLabel(selected)) {
            buttons = [this.backBtn, this.forwardBtn, this.translateBtn, this.scaleBtn, this.labelBtn, this.deleteBtn];
            cols = 2;
        } else {
            // BPMN element
            buttons = [this.addBtn, this.backBtn, this.forwardBtn, this.translateBtn, this.scaleBtn, this.rotateBtn, this.labelBtn, this.deleteBtn];
            cols = 3;
        }

        layoutButtons(leftGroup, buttons, pos, cols, null, 'topLeft');
    }

    // Creates element-specific buttons for the currently selected element.
    _createEditButtons() {
        const selected = this.selectedElement;
        Object.assign(this, createElementEditButtons(selected, this.diagramManager, {
            onDismiss:   () => this._clearSelection(),
            onSelect:    (el) => {
                this.selectedElement = el;
                this.state.selectedElement = el;
                this._createEditButtons();
                this._updateLeftButtons();
                this.showSelectionBox(el);
            },
            onTranslate: () => {
                this.diagramManager.history.saveSnapshot('translate');
                this._returnToMainView = () => this._updateLeftButtons();
                this._updateLeftButtons(createTranslateButtons(selected, this.diagramManager));
            },
            onScale: () => {
                this.diagramManager.history.saveSnapshot('scale');
                this._returnToMainView = () => this._updateLeftButtons();
                this._updateLeftButtons(createScaleButtons(selected, this.diagramManager));
            },
            onRotate: () => {
                this.diagramManager.history.saveSnapshot('rotate');
                this._returnToMainView = () => this._updateLeftButtons();
                this._updateLeftButtons(createRotateButtons(selected, this.diagramManager));
            },
        }));
    }
    
    // Shows the add submenu in the left group.
    _onAddBtn() {
        this.arrowSource = null;
        this.arrowSourceBox.visible = false;

        const leftGroup = this.panel.userData.leftGroup;
        while (leftGroup.children.length > 0) leftGroup.remove(leftGroup.children[0]);
        leftGroup.position.set(0, 0, 0);

        // viewBackBtn at bottom right in panel
        this.viewBackBtn.position.set(0.32, -0.22, 0.01);
        leftGroup.add(this.viewBackBtn);

        const selected = this.selectedElement;  // null if nothing selected
        const addBtns = createIndirectAddButtons(
            this.diagramManager, this.boardGroup, this.state,
            {
                selectedElement: selected,
                onCreated: (element) => {
                    if (selected) this._createArrowBetween(selected, element); // auto-connect new element to previously selected one
                    this.navElement = element;  
                    this._navConfirm();
                },
                // arrow option only available when a plain BPMN element is selected (arrows and labels can't be connected through arrows)
                onArrow: selected && !ElementValidator.isArrow(selected) && !ElementValidator.isLabel(selected)
                    ? () => {
                        this._clearSelection();
                        this.arrowSource = selected;
                        this.arrowType = 'arrow';
                        this.navElement = selected;
                        this.arrowSourceBox.setFromObject(selected);
                        this.arrowSourceBox.visible = true;
                        this.showSelectionBox(selected);
                    }
                    : null,
                onAssociation: selected && !ElementValidator.isArrow(selected) && !ElementValidator.isLabel(selected)
                    ? () => {
                        this._clearSelection();
                        this.arrowSource = selected;
                        this.arrowType = 'association';
                        this.navElement = selected;
                        this.arrowSourceBox.setFromObject(selected);
                        this.arrowSourceBox.visible = true;
                        this.showSelectionBox(selected);
                    }
                    : null
            }
        );
        
        // Sub-group so layoutButtons doesn't move leftGroup
        const addGroup = new THREE.Group();
        layoutButtons(addGroup, addBtns, new THREE.Vector3(-0.32, 0.22, 0.01), 3, null, 'topLeft');
        leftGroup.add(addGroup);

        this._returnToMainView = () => this._updateLeftButtons();
    }

    // --- Navigation ---

    // Moves the navigation cursor in the given direction.
    _navMove(direction) {
        if (this._returnToMainView) {
            // Exit transform sub-view and return to element edit buttons without clearing selection
            this._returnToMainView();
            this._returnToMainView = null;
        } else if (this.selectedElement) {
            // Navigating away from a confirmed selection: drop edit buttons but keep nav cursor there
            const seed = this.selectedElement;
            this._clearSelection();
            this.navElement = seed;
        }

        // Seed the nav cursor from the current selection so navigation starts there
        if (!this.navElement && this.selectedElement) {
            this.navElement = this.selectedElement;
        }

        // Build the list of navigable targets depending on mode
        let elements = this.state.elements;
        const arrowGroups = this.state.connections.map(c => c.group);
        if (this.arrowSource) {
            // Arrow creation mode: exclude labels, only BPMN elements as targets
            elements = elements.filter(e => !ElementValidator.isLabel(e));
        } else {
            // Normal mode: include labels and arrows as additional targets
            const labelMeshes = this.state.elements
                .filter(e => e.userData.hasLabel && e.userData.label)
                .map(e => e.userData.label);
            const arrowLabelMeshes = this.state.connections
                .filter(c => c.label)
                .map(c => c.label);
            elements = [...elements, ...labelMeshes, ...arrowLabelMeshes, ...arrowGroups];
        }

        if (!elements.length) return;

        // No element highlighted yet — pick the top-left element as starting point
        if (!this.navElement) {
            // Pre-compute positions once to avoid allocating vectors inside the sort comparator
            const positions = new Map(elements.map(e => {
                const p = new THREE.Vector3();
                e.getWorldPosition(p);
                return [e, p];
            }));
            elements.sort((a, b) => {
                const pa = positions.get(a), pb = positions.get(b);
                if (Math.abs(pa.y - pb.y) > 0.005) return pb.y - pa.y; // top to bottom
                return pa.x - pb.x; // left to right
            });
            this.navElement = elements[0];
            this.showSelectionBox(this.navElement);
            this.selectionBox.material.color.set(0x0088ff);
            return;
        }

        // Find the best candidate in the given direction using a weighted score.
        // Primary: distance along the movement axis. Secondary: perpendicular offset.
        const cur = new THREE.Vector3();
        this.navElement.getWorldPosition(cur);

        const pos = new THREE.Vector3();
        let best = null, bestScore = Infinity;
        for (const el of elements) {
            if (el === this.navElement) continue;
            el.getWorldPosition(pos);
            const dx = pos.x - cur.x, dy = pos.y - cur.y;
            // 45° cone: element must be more in the pressed direction than perpendicular
            let valid = false;
            switch (direction) {
                case 'right': valid = dx > Math.abs(dy); break;
                case 'left':  valid = -dx > Math.abs(dy); break;
                case 'up':    valid = dy > Math.abs(dx); break;
                case 'down':  valid = -dy > Math.abs(dx); break;
            }
            if (!valid) continue;
            const score = dx * dx + dy * dy; // nearest within cone wins
            if (score < bestScore) { bestScore = score; best = el; }
        }

        // No candidate found — wrap around to the opposite edge
        if (!best) {
            const others = elements.filter(e => e !== this.navElement);
            if (others.length > 0) {
                best = others.reduce((a, b) => {
                    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
                    a.getWorldPosition(pa); b.getWorldPosition(pb);
                    switch (direction) {
                        case 'right': return pa.x < pb.x ? a : b; // wrap to leftmost
                        case 'left':  return pa.x > pb.x ? a : b; // wrap to rightmost
                        case 'down':  return pa.y > pb.y ? a : b; // wrap to highest
                        case 'up':    return pa.y < pb.y ? a : b; // wrap to lowest
                    }
                });
            }
        }

        if (best) {
            this.navElement = best;
            this.showSelectionBox(this.navElement);
            this.selectionBox.material.color.set(0x0088ff);
        }
    }

    // Confirms the currently highlighted element. If in arrow mode, completes the connection.
    // Otherwise, selects the element and shows its edit and transform buttons.
    _navConfirm() {
        if (!this.navElement) return;

        if (this.arrowSource) {
            if (this.navElement !== this.arrowSource) {
                this.diagramManager.history.saveSnapshot('create arrow');
                const target = this.navElement;
                this._createArrowBetween(this.arrowSource, target, this.arrowType);
                this._clearSelection();
                this.selectedElement = target;
                this.state.selectedElement = target;
                this._createEditButtons();
                this._updateLeftButtons();
                this.showSelectionBox(this.selectedElement);
                this.selectionBox.material.color.set(0xffff00);
            }
            // If navElement === arrowSource, stay in connection mode — user still needs to pick a target
            return;
        }

        this.selectedElement = this.navElement;
        this.state.selectedElement = this.navElement;
        this._createEditButtons();
        this._updateLeftButtons();
        this.showSelectionBox(this.selectedElement);
        this.selectionBox.material.color.set(0xffff00);
    }

    // Resets all interaction state: removes buttons, clears selection and arrow mode.
    _clearSelection() {
        this._returnToMainView = null;
        this.arrowSource = null;
        this.arrowType = 'arrow';
        this.selectedElement = null;
        this.navElement = null;
        this.state.selectedElement = null;
        if (this.arrowSourceBox) this.arrowSourceBox.visible = false;
        this.showSelectionBox(null);
        // Dispose element-specific buttons to free GPU memory (recreated per selection)
        for (const btn of [this.labelBtn, this.deleteBtn, this.translateBtn, this.scaleBtn, this.rotateBtn]) {
            if (!btn) continue;
            btn.geometry?.dispose();
            const mats = Array.isArray(btn.material) ? btn.material : (btn.material ? [btn.material] : []);
            mats.forEach(m => m?.dispose());
        }
        this.labelBtn = this.deleteBtn = this.translateBtn = this.scaleBtn = this.rotateBtn = null;
        this._updateLeftButtons(); // return to default layout
    }

    // Creates a directed arrow (or association) between two elements. Skips if the connection already exists.
    _createArrowBetween(source, target, type = 'arrow') {
        source.updateWorldMatrix(true, true);
        target.updateWorldMatrix(true, true);
        const logicalSource = getLogicalElement(source);
        const logicalTarget = getLogicalElement(target);
        if (logicalSource === logicalTarget) return;
        if (type === 'arrow') {
            const getType = obj => obj?.userData?.elementType ?? obj?.userData?.element?.userData?.elementType;
            if (getType(logicalSource) === 'dataObject' || getType(logicalTarget) === 'dataObject') type = 'association';
        }
        const exists = this.state.connections.some(c =>
            c.logicalSource === logicalSource && c.logicalTarget === logicalTarget && c.type === (type || 'arrow')
        );
        if (exists) return;
        const conn = type === 'association'
            ? createAssociationArrow(source, target, this.boardGroup)
            : createArrow(source, target, this.boardGroup);
        conn.logicalSource = logicalSource;
        conn.logicalTarget = logicalTarget;
        conn.group.userData.isBPMNElement = true;
        this.boardGroup.add(conn.group);
        this.state.addConnection(conn);
    }
    
    // Builds and returns the floating interaction panel with all button callbacks wired up.
    _createInteractionPanel() {
        const panel = createPanel({
            onExit:       () => this.onExitXR(),
            onSwitchMode: () => this.onSwitchMode?.(),
            onNav: {
                onLeft:    () => this._navMove('left'),
                onRight:   () => this._navMove('right'),
                onUp:      () => this._navMove('up'),
                onDown:    () => this._navMove('down'),
                onConfirm: () => this._navConfirm()
            }
        });

        this.scene.add(panel);
        return panel;
    }
    
    // Resolves a raw mesh to an XR button by walking up the parent chain.
    // Indirect mode only has buttons — BPMN elements are not directly pinchable.
    _resolveHit(object) {
        let current = object;
        while (current) {
            if (current.userData.isXRButton) return current;
            current = current.parent;
        }
        return null;
    }

    // Override base raycast to use the XR controller's target ray space directly.
    // The controller's world matrix is the canonical far-interaction ray; it avoids
    // the OculusHandPointerModel bug where a world-space quaternion is applied in
    // local hand space, drifting the ray at extended-arm distances.
    _raycast(pointer) {
        const i = this.handPointers.indexOf(pointer);
        const controller = this._controllers[i];
        if (!controller) return super._raycast(pointer);

        controller.updateWorldMatrix(true, false);
        this._controllerRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this._controllerRaycaster.ray.direction
            .set(0, 0, -1)
            .applyMatrix4(this._tmpMatrix.extractRotation(controller.matrixWorld));

        let closestHit = null;
        let closestDist = Infinity;
        for (const obj of this._testObjects) {
            const hits = this._controllerRaycaster.intersectObject(obj, true);
            if (!hits.length || hits[0].distance >= closestDist) continue;
            closestDist = hits[0].distance;
            const hit = this._resolveHit(hits[0].object);
            if (hit) closestHit = hit;
        }
        return { hit: closestHit, dist: closestHit ? closestDist : 1.2 };
    }

    // Called every frame from the render loop.
    // Performs raycasting from each hand and handles pinch/tap logic.
    update() {
        if (!this.renderer.xr.isPresenting) return;

        if (this.selectionBox.visible) this.selectionBox.update();
        if (this.arrowSourceBox?.visible) this.arrowSourceBox.update();
        
        // make labels and panel always face the camera
        this._orientLabels();
        this.renderer.xr.getCamera().getWorldPosition(this._tmpVec);
        if (this._dragging) this.panel.lookAt(this._tmpVec);

        this._testObjects = [...this.panel.children];
        if (this._dbLoaderPanel) this._testObjects.push(...this._dbLoaderPanel.children);

        this._updateHover();

        // Pinch detection — one hand at a time.
        // buttonFiredThisFrame prevents both hands from triggering separate actions in the same frame,
        let buttonFiredThisFrame = false;
        for (let i = 0; i < this.handPointers.length; i++) {
            const pointer = this.handPointers[i];
            const hand = this.hands[i];
            const isPinched = pointer.isPinched();

            // Only true on the single frame the pinch starts or ends
            const justPinched  = isPinched && !this._pointerWasPinched[i];
            const justReleased = !isPinched && this._pointerWasPinched[i];

            if (justPinched) {
                const { hit } = this._raycast(pointer);
                if (hit?.userData?.isDragHandle) {
                    // Start dragging the panel — record which hand and the offset from panel centre
                    this._dragging = true;
                    this._dragHand = i;
                    const pointerPos = this._getPinchPosition(hand);
                    this._dragOffset.copy(this.panel.position).sub(pointerPos);
                    this._pinchFreeForScale[i] = false; // drag consumes this pinch
                } else if (!buttonFiredThisFrame && hit?.userData?.isXRButton && hit.userData.onClick) {
                    // Per-button 300ms debounce: XR hand tracking can briefly drop and re-detect
                    // a pinch within a few frames, creating a spurious second justPinched edge.
                    const now = performance.now();
                    if (now - (hit.userData._lastFireTime ?? 0) > 300) {
                        hit.userData._lastFireTime = now;
                        hit.userData.onClick();
                        buttonFiredThisFrame = true;
                    }
                    this._pinchFreeForScale[i] = false; // button press consumes this pinch
                } else {
                    // Explicitly intersect the panel background (excluded from normal raycasting
                    // to avoid hover effects). Temporarily restore its raycast method for this check.
                    const bg = this.panel.userData.panelBackground;
                    let onPanel = false;
                    if (bg) {
                        const saved = bg.raycast;
                        bg.raycast = THREE.Mesh.prototype.raycast.bind(bg);
                        onPanel = pointer.intersectObject(bg).length > 0;
                        bg.raycast = saved;
                    }
                    this._pinchFreeForScale[i] = onPanel;
                }
            }

            if (justReleased) {
                this._pinchFreeForScale[i] = false;
                if (this._dragHand === i) {
                    this._dragging = false;
                    this._dragHand = -1;
                }
            }

            if (this._dragging && this._dragHand === i && isPinched) {
                // Move panel to follow the pinch position, keeping the initial grab offset
                const pointerPos = this._getPinchPosition(hand);
                this.panel.position.copy(pointerPos).add(this._dragOffset);
            }

            this._pointerWasPinched[i] = isPinched;
        }

        // Two-hand scale only when both hands started a free pinch (no button or drag handle hit)
        const canScale = this._pinchFreeForScale[0] && this._pinchFreeForScale[1];
        this._updateTwoHandScale(canScale ? this.panel : null);
    }

    // Removes all scene objects and frees GPU resources.
    dispose() {
        if (this.panel) {
            this.scene.remove(this.panel);
            this._disposeGroup(this.panel);
        }
        if (this.arrowSourceBox) {
            this.scene.remove(this.arrowSourceBox);
            this.arrowSourceBox.geometry?.dispose();
            this.arrowSourceBox.material?.dispose();
        }
        super.dispose(); // remove selection box  
    }

}
