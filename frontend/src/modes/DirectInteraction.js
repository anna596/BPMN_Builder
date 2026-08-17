import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createTransformControlButtons, createLeftHandButtons, createRightHandButtons, createEditButtons } from '../visualization/direct/ButtonCreator.js';
import { ElementValidator } from '../validators/ElementValidator.js';
import { createElement, createArrow, createAssociationArrow } from '../diagram/ElementCreator.js';
import { getLogicalElement } from '../diagram/DiagramManager.js';
import { XRInteraction } from './XRInteraction.js';

/**
 * Manages direct hand interaction in XR.
 * Handles hand tracking, element selection via pinch gestures,
 * single/double tap detection, and 3D button display.
 */
export class DirectInteraction extends XRInteraction {
    constructor(renderer, scene, boardGroup, diagramManager, hands, pointers, onExitXR, onSwitchMode) {
        super(renderer, scene, boardGroup, diagramManager, hands, pointers, onExitXR);

        this.onSwitchMode = onSwitchMode;

        this.pendingElementType = null;
        this.pendingSourceElement = null;
        this.arrowSource = null;

        this._initHandStates();
        this._initButtonSelectionBox();
    }

    // Initialises per-hand gesture state and timing constants
    _initHandStates() {
        const makeHandState = () => ({
            wasPinched: false,
            tapCount: 0,
            tapTimer: null,
            lastIntersected: null,
            // Transform tracking
            isTransforming: false,
            transformTarget: null,
            pendingTransform: false,
            transformStartPosition: null,
            transformStartElementWorldPos: null,
            transformStartElementScale: null,
            transformStartElementRot: null,
            rotationLockedAxis: null
        });
        this.handStates = [makeHandState(), makeHandState()];

        this.leftHandGroup = null;
        this.leftHandRef = null;
        this.rightHandGroup = null;
        this.rightHandRef = null;

        this.longPinchTimer = null;
        this.LONG_PINCH_DELAY = 500; // ms
        this.PINCH_DELAY = 500; // ms to wait for double tap
    }

    // Outline highlighting the active button (transform mode or pending element type).
    // Built from EdgesGeometry on a unit box, then scaled/oriented per-button each frame
    // so the outline is always tight around the button regardless of wrist rotation.
    _initButtonSelectionBox() {
        const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
        const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo);
        edgesGeo.dispose();
        this.buttonSelectionBox = new LineSegments2(
            lineGeo,
            new LineMaterial({ color: 0xffff00, linewidth: 3, depthTest: false })
        );
        this.buttonSelectionBox.renderOrder = 1000;
        this.buttonSelectionBox.raycast = () => {};
        this.buttonSelectionBox.visible = false;
        this._highlightedButton = null;
        this._btnWS = new THREE.Vector3();
        this.scene.add(this.buttonSelectionBox);
    }

    // Snaps the outline to btn's exact world transform + geometry dimensions.
    _fitOutlineToButton(btn) {
        this._highlightedButton = btn;
        btn.updateWorldMatrix(true, false);
        const p = btn.geometry.parameters;
        btn.matrixWorld.decompose(
            this.buttonSelectionBox.position,
            this.buttonSelectionBox.quaternion,
            this._btnWS
        );
        this.buttonSelectionBox.scale.set(
            p.width  * this._btnWS.x,
            p.height * this._btnWS.y,
            p.depth  * this._btnWS.z
        );
        this.buttonSelectionBox.visible = true;
    }

    // Set the active XR transform mode.
    setXRTransformMode(mode) {
        this.activeTransformMode = mode;
        this._highlightModeButton(mode);
    }

    // Moves the outline onto the button for the active transform mode.
    _highlightModeButton(mode) {
        const btn = this.activeButtonGroup?.userData?.modeButtons?.[mode];
        if (btn) {
            if (!this.buttonSelectionBox.parent) this.scene.add(this.buttonSelectionBox);
            this._fitOutlineToButton(btn);
        } else {
            this.buttonSelectionBox.visible = false;
            this._highlightedButton = null;
        }
    }

    // Called every frame from the render loop.
    // Performs raycasting from each hand and handles pinch/tap logic.
    update() {
        if (!this.renderer.xr.isPresenting) return;

        if (this.buttonSelectionBox.visible && this._highlightedButton) this._fitOutlineToButton(this._highlightedButton);

        // make labels always face the camera
        this._orientLabels();
        const cam = this.renderer.xr.getCamera();
        cam.getWorldPosition(this._tmpVec);
        if (this.activeButtonGroup) this.activeButtonGroup.lookAt(this._tmpVec);
         
        this._buildTestObjects();
        this._updateHandGroupPosition(this.leftHandGroup, this.leftHandRef, cam);
        this._updateHandGroupPosition(this.rightHandGroup, this.rightHandRef, cam);

        // Update cursors and find hover target
        // Hover feedback - only for first hand that has a hit
        let hoverHit = null;
        for (let i = 0; i < this.handPointers.length; i++) {
            const pointer = this.handPointers[i];

            const { dist, hit } = this._raycast(pointer);
            pointer.setCursor(dist);
            if (hit && !hoverHit) hoverHit = hit;
        }

        // Upscale hovered element
        if (hoverHit !== this.hoveredElement) {
            if (this.hoveredElement) {
                this.hoveredElement.scale.copy(this.hoveredOriginalScale);
            }
            if (hoverHit) {
                this.hoveredOriginalScale = hoverHit.scale.clone();
                hoverHit.scale.multiplyScalar(1.1);
            }
            this.hoveredElement = hoverHit;
        }

        // Pinch detection
        for (let i = 0; i < this.handPointers.length; i++) {
            const pointer = this.handPointers[i];
            const hand = this.hands[i];
            const handState = this.handStates[i];

            const isPinched = pointer.isPinched();
            const justPinched = isPinched && !handState.wasPinched;
            const justReleased = !isPinched && handState.wasPinched;

            // Begin transform on sustained pinch (held, not just tapped)
            if (!justPinched && isPinched && handState.pendingTransform && 
                this.activeTransformMode && !handState.isTransforming) {
                this._beginTransform(i, hand, this.selectedElement);
                handState.pendingTransform = false;
            }

            // Apply continuous transform while pinching
            if (handState.isTransforming && isPinched) {
                if (this.activeTransformMode === 'scale') {
                    // scale handled exclusively by two-hand gesture — both pinches must be on the element
                } else {
                    this._applyTransform(i, hand);
                }
            }

            // End transform on release
            if (justReleased) {
                handState.pendingTransform = false;
                if (handState.isTransforming) {
                    this._endTransform(i);
                }
            }

            // Handle new pinch
            if (justPinched) this._handlePinch(hand, pointer, handState);
            
            if (justReleased) {
                // Cancel the timer if the hand released before the menu appeared
                if (this.longPinchTimer) {
                    clearTimeout(this.longPinchTimer);
                    this.longPinchTimer = null;
                }
                // Dismiss whichever wrist menu belongs to this hand
                if (this.leftHandRef === hand)  this._dismissLeftHandMenu();
                if (this.rightHandRef === hand) this._dismissRightHandMenu();
            }

            handState.wasPinched = isPinched;
        }
        
        // Two-hand scale only when both hands are actively transforming the same element —
        // prevents accidental scale when one hand pinches a button while the other pinches the element.
        const bothOnElement =
            this.handStates[0].isTransforming &&
            this.handStates[1].isTransforming &&
            this.handStates[0].transformTarget === this.selectedElement &&
            this.handStates[1].transformTarget === this.selectedElement;
        const scaleTarget = (this.activeTransformMode === 'scale' && bothOnElement) ? this.selectedElement : null;
        this._updateTwoHandScale(scaleTarget, (el) => {
            this.selectionBox.setFromObject(el);
            this.diagramManager.updateConnections(el);
        });
    }

    // Dispatches a pinch gesture to the appropriate handler based on what was hit.
    _handlePinch(hand, pointer, handState) {
        const { hit } = this._raycast(pointer);
        this._dismissHandMenusIfNeeded(hit);

        if (hit) {
            if (this.pendingElementType === 'arrow' || this.pendingElementType === 'association') {
                // User is picking an arrow/association target — complete the connection
                this._handleArrowCreation(hit);
            } else if (hit.userData.isXRButton && hit.userData.onClick) {
                // Per-button 300ms debounce — same as indirect interaction, prevents double-fire
                // from XR hand tracking briefly losing and re-detecting a pinch.
                const now = performance.now();
                if (now - (hit.userData._lastFireTime ?? 0) > 300) {
                    hit.userData._lastFireTime = now;
                    hit.userData.onClick();
                    this._resetTapState(handState);
                }
            } else if (!hit.userData.isXRButton) {
                // Pinched a BPMN element — handle tap or transform
                this._handleHitElement(hit, handState);
            }
        } else {
            // Pinched empty space — place pending element or reset state
            this._handlePinchOnEmpty(hand, pointer, handState);
        }
    }

    // Dismisses hand menus if the pinch didn't land on their own buttons.
    _dismissHandMenusIfNeeded(hit) {
        if (this.leftHandGroup && this.leftHandRef) {
            const isLeftHandButton = hit?.userData?.isXRButton && hit.parent === this.leftHandGroup;
            if (!isLeftHandButton) this._dismissLeftHandMenu();
        }
        if (this.rightHandGroup && this.rightHandRef) {
            const isRightHandButton = hit?.userData?.isXRButton && hit.parent === this.rightHandGroup;
            if (!isRightHandButton) this._dismissRightHandMenu();
        }
    }

    // Handles a pinch that landed on a BPMN element (not a button).
    _handleHitElement(hit, handState) {
        const currentTransformMode = this.activeTransformMode;

        // When in transform mode with a label selected, hitting the parent group (e.g. the arrow
        // line instead of the label mesh on top of it) should be treated as hitting the label.
        if (currentTransformMode && this.selectedElement?.parent === hit) hit = this.selectedElement;

        // Reset buttons and tap state when tapping a different element
        if (this.activeButtonGroup && hit !== this.selectedElement) this._resetInteractionState();
        if (handState.lastIntersected && hit !== handState.lastIntersected) this._resetTapState(handState);

        // Prepare for potential transform if mode is active and same element is pinched again.
        // Selecting a different element clears the mode to avoid accidental transforms.
        if (currentTransformMode && hit === this.selectedElement) {
            handState.pendingTransform = true;
        } else {
            this.activeTransformMode = null;
            // Show selection box immediately while waiting for element/arrow placement
            if (this.pendingElementType) {
                this.selectedElement = hit;
                this.state.selectedElement = hit;
                this.showSelectionBox(hit);
            }
            this._handleTap(handState, hit);
        }
    }

    // Handles a pinch that landed on empty space — place element or reset state and start long-pinch timer.
    _handlePinchOnEmpty(hand, pointer, handState) {
        if (this.pendingElementType && this.pendingElementType !== 'arrow' && this.pendingElementType !== 'association') {
            this._placeElement(pointer);
            return;
        }

        // Ignore accidental empty-space pinches near the active button group or selected element.
        // A single threshold covers both anchors so the element and its buttons form one
        // continuous dead zone. Labels get a larger radius since they're smaller targets.
        const indexTip = hand.joints?.['index-finger-tip'];
        if (indexTip && (this.activeButtonGroup || this.selectedElement)) {
            const pinchPos = new THREE.Vector3();
            indexTip.getWorldPosition(pinchPos);
            const THRESHOLD = ElementValidator.isLabel(this.selectedElement) ? 0.45 : 0.35;
            const btnPos = this.activeButtonGroup ? new THREE.Vector3() : null;
            const elPos  = this.selectedElement  ? new THREE.Vector3() : null;
            if (btnPos) this.activeButtonGroup.getWorldPosition(btnPos);
            if (elPos)  this.selectedElement.getWorldPosition(elPos);
            if ((btnPos && pinchPos.distanceTo(btnPos) < THRESHOLD) ||
                (elPos  && pinchPos.distanceTo(elPos)  < THRESHOLD)) return;
        }

        this._resetInteractionState();
        this._dismissLeftHandMenu();
        this.buttonSelectionBox.visible = false;
        this._highlightedButton = null;
        this.pendingElementType = null;
        this.pendingSourceElement = null;
        this.arrowSource = null;
        this.selectionBox.visible = false;
        this._resetTapState(handState);
        this.activeTransformMode = null;
        this.selectedElement = null;
        this.state.selectedElement = null;

        // OculusHandPointerModel stores xrInputSource on connect — this reliably reflects
        // actual handedness regardless of which index Three.js assigned to this hand.
        const handedness = pointer?.xrInputSource?.handedness;
        if (handedness === 'left') {
            this.longPinchTimer = setTimeout(() => this._showLeftHandMenu(hand), this.LONG_PINCH_DELAY);
        } else if (handedness === 'right') {
            this.longPinchTimer = setTimeout(() => this._showRightHandMenu(hand), this.LONG_PINCH_DELAY);
        }
    }

    // Begin a transform operation.
    _beginTransform(handIndex, hand, element) {
        const handState = this.handStates[handIndex];

        // For scale mode allow both hands on the same element (enables two-hand pinch-to-scale).
        // For other modes, block the second hand to avoid conflicting transforms.
        const otherIndex = handIndex === 0 ? 1 : 0;
        if (this.handStates[otherIndex].isTransforming &&
            this.handStates[otherIndex].transformTarget === element &&
            this.activeTransformMode !== 'scale') {
            return;
        }

        // Save snapshot on first hand only so each pinch gesture is one undo step.
        // The second hand joining a two-hand scale does not create a new undo step.
        if (!this.handStates[otherIndex].isTransforming) {
            this.diagramManager.history.saveSnapshot(this.activeTransformMode ?? 'transform');
        }

        if (this.activeButtonGroup) {
            this.scene.remove(this.activeButtonGroup); // hide buttons during transform
            this.scene.remove(this.buttonSelectionBox);
        }

        // Use the index fingertip as the reference point if available, otherwise fall back to the hand
        const indexTip = hand.joints?.['index-finger-tip'];
        const handWorldPos = new THREE.Vector3();
        if (indexTip) {
            indexTip.getWorldPosition(handWorldPos);
        } else {
            hand.getWorldPosition(handWorldPos);
        }

        const elementWorldPos = new THREE.Vector3();
        element.getWorldPosition(elementWorldPos);

        // Snapshot the starting state — delta is computed against these each frame during the transform
        handState.isTransforming = true;
        handState.transformTarget = element;
        handState.transformStartPosition = handWorldPos.clone();
        handState.transformStartElementWorldPos = elementWorldPos.clone();
        handState.transformStartElementScale = element.scale.clone();
        handState.transformStartElementRot = element.rotation.clone();
        handState.rotationLockedAxis = null; // detected on the first significant movement
    }

    // Called every frame while the hand is pinched. Computes how far the hand
    // has moved since the transform started and passes that delta to the active mode.
    _applyTransform(handIndex, hand) {
        const handState = this.handStates[handIndex];
        const element = handState.transformTarget;

        if (!element) return;

        // Get the current hand position (fingertip preferred, hand root as fallback)
        const indexTip = hand.joints?.['index-finger-tip'];
        if (indexTip) {
            indexTip.getWorldPosition(this._tmpVec);
        } else {
            hand.getWorldPosition(this._tmpVec);
        }
        // Subtract the start position to get the movement delta since the transform began
        this._tmpVec.sub(handState.transformStartPosition);

        // Dispatch delta to the correct transform handler
        switch (this.activeTransformMode) {
            case 'translate': this._applyTranslate(element, this._tmpVec, handState); break;
            case 'scale':     this._applyScale(element, this._tmpVec, handState);     break;
            case 'rotate':    this._applyRotate(element, this._tmpVec, handState);    break;
        }

        // Keep arrows and the selection box in sync with the moved element
        this.diagramManager.updateConnections(element);
        this.selectionBox.setFromObject(element);
    }

    // Apply translation transform.
    _applyTranslate(element, delta, handState) {
        element.position.copy(handState.transformStartElementWorldPos).add(delta);
        if (element.parent) element.parent.worldToLocal(element.position);
        if (element.userData.isLabel) element.userData.offset = element.position.clone();
    }

    // Apply uniform scale transform based on vertical hand movement.
    _applyScale(element, delta, handState) {
        const scaleFactor = 1 + delta.y * 2;
        const clampedScale = Math.max(0.1, Math.min(5, scaleFactor));
        element.scale.copy(handState.transformStartElementScale).multiplyScalar(clampedScale);
    }
  
    /**
     * Apply rotation transform, locked to the dominant hand-movement axis.
     * The axis is detected on the first movement that exceeds LOCK_THRESHOLD
     * and held for the rest of the gesture. A new pinch gesture resets it.
     *   hand left/right  → rotate around Y 
     *   hand up/down     → rotate around X 
     *   hand in/out      → rotate around Z 
     */
    _applyRotate(element, delta, handState) {
        const LOCK_THRESHOLD = 0.02; // metres of movement before axis is chosen

        if (!handState.rotationLockedAxis) {
            const ax = Math.abs(delta.x);
            const ay = Math.abs(delta.y);
            const az = Math.abs(delta.z);
            if (Math.max(ax, ay, az) < LOCK_THRESHOLD) return; // wait for clear intent
            if (ax >= ay && ax >= az) handState.rotationLockedAxis = 'Y';
            else if (ay >= ax && ay >= az) handState.rotationLockedAxis = 'X';
            else handState.rotationLockedAxis = 'Z';
        }

        element.rotation.copy(handState.transformStartElementRot);
        if (handState.rotationLockedAxis === 'Y')      element.rotation.y += delta.x * Math.PI;
        else if (handState.rotationLockedAxis === 'X') element.rotation.x += delta.y * Math.PI;
        else                                           element.rotation.z += delta.z * Math.PI;
    }

    // End transform operation.
    _endTransform(handIndex) {
        const handState = this.handStates[handIndex];
        handState.isTransforming = false;
        handState.transformTarget = null;
        handState.transformStartPosition = null;
        handState.transformStartElementWorldPos = null;
        handState.transformStartElementScale = null;
        handState.transformStartElementRot = null;

        // Recreate buttons at updated element position
        if (this.selectedElement && !ElementValidator.isArrow(this.selectedElement)) {
            if (this.activeButtonGroup) {
                this.scene.remove(this.activeButtonGroup);
                this._disposeGroup(this.activeButtonGroup);
                this.activeButtonGroup = null;
            }
            this.activeButtonGroup = createTransformControlButtons(
                this._getButtonPosition(this.selectedElement), this, this.selectedElement
            );
            this.scene.add(this.activeButtonGroup);
            this._highlightModeButton(this.activeTransformMode);
        }
    }

    // When active buttons are visible, check them before diagram elements so they always win.
    _raycast(pointer) {
        if (this.activeButtonGroup) {
            for (const child of this.activeButtonGroup.children) {
                const hits = pointer.intersectObject(child, true);
                if (hits?.length > 0) {
                    const resolved = this._resolveHit(hits[0].object);
                    if (resolved?.userData?.isXRButton) return { hit: resolved, dist: hits[0].distance };
                }
            }
        }
        return super._raycast(pointer);
    }

    // Resolves a raw mesh to an XR button or a valid BPMN element by walking up the parent chain.
    _resolveHit(object) {
        // Walk up to find an XR button
        let current = object;
        while (current) {
            if (current.userData.isXRButton) return current;
            current = current.parent;
        }

        // Walk up to find a BPMN element
        let hit = object;
        while (hit.parent && !ElementValidator.isValidBPMNElement(hit) && !ElementValidator.isTask(hit)
               && !ElementValidator.isLabel(hit) && !ElementValidator.isArrow(hit)) {
            hit = hit.parent;
        }

        // If inside a labelGroup and not hitting the label directly, select the group
        if (hit.parent?.userData?.hasLabel && !ElementValidator.isLabel(hit)) hit = hit.parent;

        if (ElementValidator.isValidBPMNElement(hit) || ElementValidator.isTask(hit)
            || ElementValidator.isLabel(hit) || ElementValidator.isArrow(hit)) return hit;

        return null;
    }

    // Handle single/double tap state
    _handleTap(handState, intersected){
        // If it's >= 2, something went wrong (stale state) - reset first
        if (handState.tapCount >= 2) {
            handState.tapCount = 0;
        }

        handState.tapCount++;
        handState.lastIntersected = intersected;

        if (handState.tapCount === 1) {
            // First tap — wait to see if a second tap follows
            handState.tapTimer = setTimeout(() => {
                this._onSingleTap(handState.lastIntersected);
                this._resetTapState(handState);
            }, this.PINCH_DELAY);
        } else if (handState.tapCount >= 2) {
            // Second tap — double tap
            clearTimeout(handState.tapTimer);
            this._onDoubleTap(handState.lastIntersected);
            this._resetTapState(handState);
        }
    }

    // Single tap: select element
    // for BPMN elements: show transform control buttons
    // for arrows: show edit buttons (label/delete)
    _onSingleTap(element) {
        if (!element || element.userData.isXRButton) return;

        // If already selected with buttons, don't recreate them
        if (element === this.selectedElement && this.activeButtonGroup) return;

        this.selectedElement = element;
        this.state.selectedElement = element;

        // Clear any existing buttons and highlight the new selection
        this._resetInteractionState();
        this.showSelectionBox(this.selectedElement);

        const pos = this._getButtonPosition(this.selectedElement);

        // Arrows only get edit buttons (label/delete); other elements get transform controls
        if (ElementValidator.isArrow(element)) {
            this.activeButtonGroup = createEditButtons(
                pos, this.diagramManager,
                {
                    onDismiss: () => this._resetInteractionState(),
                    onSelect: (el) => {
                        this.selectedElement = el;
                        this.state.selectedElement = el;
                        this.showSelectionBox(el);
                    }
                }
            );
        } else {
            this.activeButtonGroup = createTransformControlButtons(pos, this, this.selectedElement);
        }
        this.scene.add(this.activeButtonGroup);
        this._highlightModeButton(this.activeTransformMode);
    }

    // Double tap: select element and show edit buttons (add, label, delete).
    _onDoubleTap(element) {
        if (!element || element.userData.isXRButton) return;

        this.selectedElement = element;
        this.state.selectedElement = element;

        // Save the board-local Z depth for element placement
        const localPos = this.boardGroup.worldToLocal(
            this.selectedElement.getWorldPosition(new THREE.Vector3())
        );
        this.placementDepth = localPos.z;

        this._resetInteractionState();

        this.showSelectionBox(this.selectedElement);

        const pos = this._getButtonPosition(this.selectedElement);

        this.activeButtonGroup = createEditButtons(
            pos, this.diagramManager,
            {
                onDismiss: () => {
                    const source = this.selectedElement;
                    this._resetInteractionState();
                    // Keep source highlighted while waiting for arrow target or element placement
                    if (this.pendingElementType && source) this.showSelectionBox(source);
                },
                onSelect: (el) => {
                    this.selectedElement = el;
                    this.state.selectedElement = el;
                    this.showSelectionBox(el);
                },
                onReplaceButtons: (newGroup) => {
                    const source = this.selectedElement;
                    this._resetInteractionState();
                    this.activeButtonGroup = newGroup;
                    this.scene.add(this.activeButtonGroup);
                    // Keep source highlighted while add submenu is open
                    if (source) this.showSelectionBox(source);
                },
                onSetPendingType: (type) => {
                    this.pendingElementType = type;
                    this.pendingSourceElement = this.selectedElement;
                    if (type === 'arrow' || type === 'association') {
                        this.arrowSource = this.selectedElement;
                    }
                },

            }
        );
        this.scene.add(this.activeButtonGroup);
    }

    // Handle creation of arrows between elements — user picks source then target.
    _handleArrowCreation(hit) {
        if (!hit || hit.userData.isXRButton || hit.userData.isLabel) return;

        // arrowSource is already set from the button callback
        if (!this.arrowSource) return;

        this.diagramManager.history.saveSnapshot('create arrow');
        this._createArrowBetween(this.arrowSource, hit, this.pendingElementType);

        this.arrowSource = null;
        this.pendingElementType = null;
        this.selectionBox.visible = false;
        this._dismissLeftHandMenu();
        this.buttonSelectionBox.visible = false;
    }
    
    // Add BPMN elements to scene at tapped position.
    _placeElement(pointer) {
        if(!this.pendingElementType) return;

        // plane normal = board's local Z in world space
        const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.boardGroup.getWorldQuaternion(new THREE.Quaternion()));

        // plane origin = board position + depth along normal
        const scale = this.boardGroup.getWorldScale(new THREE.Vector3()).z;
        const plainOrigin = this.boardGroup.getWorldPosition(new THREE.Vector3()).addScaledVector(planeNormal, (this.placementDepth ?? 0) * scale);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, plainOrigin);

        // Intersect pointer ray with plane to find placement position
        const intersectionPoint = new THREE.Vector3();
        if (!pointer.raycaster.ray.intersectPlane(plane, intersectionPoint)) return;

        // Convert to board local coordinates and create element
        const localPoint = this.boardGroup.worldToLocal(intersectionPoint.clone());

        this.diagramManager.history.saveSnapshot('create element'); 
        const element = createElement(this.pendingElementType);
        element.position.copy(localPoint);

        this.boardGroup.add(element);
        this.state.addElement(element);

        element.updateWorldMatrix(true, true);

        // Auto-connect: create arrow from source element to the new element
        if (this.pendingSourceElement) {
            this._createArrowBetween(this.pendingSourceElement, element);
        }

        this.pendingElementType = null;
        this.pendingSourceElement = null;
        this.selectedElement = null;
        this.state.selectedElement = null;
        this.selectionBox.visible = false;
        this._dismissLeftHandMenu();
        this.buttonSelectionBox.visible = false;
    }

    // Create an arrow (or association) between source and target elements, if it doesn't already exist.
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
    
    // Shows the left-hand wrist menu (add / undo / redo) above the hand.
    _showLeftHandMenu(hand) {
        this._dismissLeftHandMenu();

        this.leftHandGroup = createLeftHandButtons(
            this.diagramManager,
            {
                onDismiss: () => this._resetInteractionState(),
                onReplaceButtons: (newGroup) => {
                    this.leftHandGroup.parent?.remove(this.leftHandGroup);
                    this.leftHandGroup = newGroup;
                    this.scene.add(this.leftHandGroup);
                },
                onSetPendingType: (type) => {
                    this.pendingElementType = type;
                    this.pendingSourceElement = this.selectedElement;
                    if (type === 'arrow' || type === 'association') this.arrowSource = this.selectedElement;
                },
                onTypeSelected: (_type, btn) => {
                    this._fitOutlineToButton(btn);
                }
            }
        );
        this.leftHandRef = hand;
        this.scene.add(this.leftHandGroup);
        this.longPinchTimer = null;
    }

    // Removes the left-hand wrist menu from the scene and disposes it.
    _dismissLeftHandMenu() {
        if (this.leftHandGroup) {
            if (this.leftHandGroup.parent) {
                this.leftHandGroup.parent.remove(this.leftHandGroup);
            }
            this._disposeGroup(this.leftHandGroup);
            this.leftHandGroup = null;
            this.leftHandRef = null;
        }
    }
    // Shows the right-hand wrist menu (new diagram / load / save / exit / switch mode) above the hand.
    _showRightHandMenu(hand) {
        this._dismissRightHandMenu();

        this.rightHandGroup = createRightHandButtons(this.diagramManager, {
            onSwitchMode: () => this.onSwitchMode?.(),
            onExit:       () => this.onExitXR(),
            onLoadDB:     () => this.showDBLoader(),
        });
        this.rightHandRef = hand;
        this.scene.add(this.rightHandGroup);
        this.longPinchTimer = null;
    }

    // Removes the right-hand wrist menu from the scene and disposes it.
    _dismissRightHandMenu() {
        if (this.rightHandGroup) {
            if (this.rightHandGroup.parent) {
                this.rightHandGroup.parent.remove(this.rightHandGroup);
            }
            this._disposeGroup(this.rightHandGroup); 
            this.rightHandGroup = null;
            this.rightHandRef = null;
        }
    }

    // Builds the list of objects to raycast against each frame.
    _buildTestObjects() {
        this._testObjects = [...this.state.elements, ...this.state.getConnectionGroups()];
        if (this.activeButtonGroup) this._testObjects.push(...this.activeButtonGroup.children);
        if (this.leftHandGroup)     this._testObjects.push(...this.leftHandGroup.children);
        if (this.rightHandGroup)    this._testObjects.push(...this.rightHandGroup.children);
        if (this._dbLoaderPanel)    this._testObjects.push(...this._dbLoaderPanel.children);
    }

    // Moves the wrist menu group to follow the hand and face the camera.
    _updateHandGroupPosition(group, ref, cam) {
        if (!group || !ref) return;
        const wrist = ref.joints['wrist'];
        if (wrist) {
            wrist.getWorldPosition(this._tmpVec);
            group.position.set(this._tmpVec.x, this._tmpVec.y + 0.05, this._tmpVec.z);
        }
        group.lookAt(cam.getWorldPosition(this._tmpVec));
    }

    // Returns the world position to the right of an element's bounding box — where buttons are placed.
    _getButtonPosition(element, xOffset = 0.05) {
        const box = new THREE.Box3().setFromObject(element);
        return new THREE.Vector3(
            box.max.x + xOffset,
            (box.max.y + box.min.y) / 2,
            (box.max.z + box.min.z) / 2
        );
    }

    // Resets the tap state for a given hand.
    _resetTapState(handState) {
        handState.tapCount = 0;
        handState.lastIntersected = null;
        if (handState.tapTimer) {
            clearTimeout(handState.tapTimer);
            handState.tapTimer = null;
        }
    }

    // Remove currently displayed buttons from the scene.
    _resetInteractionState() {
        if (this.activeButtonGroup) {
            this.scene.remove(this.activeButtonGroup);
            this._disposeGroup(this.activeButtonGroup); 
            this.activeButtonGroup = null;
        }
        this.selectionBox.visible = false;
        this.buttonSelectionBox.visible = false;

        // Cancel any active transforms
        for (const handState of this.handStates) {
            this._resetTapState(handState);  
            if (handState.isTransforming) {
                handState.isTransforming = false;
                handState.transformTarget = null;
            }
        }
    }

    // Removes all scene objects, frees GPU resources, and cleans up the shared selectionBox.
    dispose() {
        this.reset();
        this.scene.remove(this.buttonSelectionBox);
        this.buttonSelectionBox.geometry?.dispose();
        this.buttonSelectionBox.material?.dispose();
        super.dispose();
    }

    // Removes all scene objects
    reset() {
        this.hideDBLoader();
        if (this.longPinchTimer) {
            clearTimeout(this.longPinchTimer);
            this.longPinchTimer = null;
        }
        if (this.hoveredElement && this.hoveredOriginalScale) {
            this.hoveredElement.scale.copy(this.hoveredOriginalScale);
        }
        this.hoveredElement = null;
        this.hoveredOriginalScale = null;
        this._resetInteractionState();
        this._dismissLeftHandMenu();
        this._dismissRightHandMenu();
        this.selectionBox.visible = false;
        this.buttonSelectionBox.visible = false;
        for (const hs of this.handStates) this._resetTapState(hs);
        this.selectedElement = null;
        this.activeTransformMode = null;
        this.pendingElementType = null;
        this.pendingSourceElement = null;
        this.arrowSource = null;
        this.state.selectedElement = null;
    }

}