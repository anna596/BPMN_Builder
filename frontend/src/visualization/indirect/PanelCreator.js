import * as THREE from 'three';
import {makeButton} from '../XRButtonFactory.js';
import { createElement} from '../../diagram/ElementCreator.js';
import { ElementValidator } from '../../validators/ElementValidator.js';

const ROTATE_STEP = Math.PI / 8; // 22.5 degrees per button press

// Creates arrow buttons and select button to traverse diagram
function createArrowButtons({onLeft, onRight, onUp, onDown, onConfirm} = {}) {
    const group = new THREE.Group();
    group.userData.isXRButtonGroup = true;

    const buttons = [
        makeButton('arrow_down',  () => onDown?.()),
        makeButton('arrow_up',    () => onUp?.()),
        makeButton('arrow_left',  () => onLeft?.()),
        makeButton('arrow_right', () => onRight?.()),
        makeButton('select',      () => onConfirm?.()),
    ];

    // layout buttons in a cross shape, with select button in the middle
    const spacing = 0.10;
    buttons[0].position.set(0, -spacing, 0); // down
    buttons[1].position.set(0, spacing, 0); // up
    buttons[2].position.set(-spacing, 0, 0); // left
    buttons[3].position.set(spacing, 0, 0); // right
    buttons[4].position.set(0, 0, 0); // select
    buttons.forEach(btn => group.add(btn));
    return group;

}


// -- button creators --

// Creates the label button. Delegates to diagramManager.editLabel which handles all element types.
export function createLabelButton(selected, diagramManager, onDismiss, onSelect) {
    return makeButton('label', () => diagramManager.editLabel(selected, { onDismiss, onSelect }));
}

// Creates the delete button. Delegates to diagramManager.deleteSelected.
export function createDeleteButton(selected, diagramManager, onDismiss) {
    return makeButton('delete', () => diagramManager.deleteSelected(selected, { onDismiss }));
}

// Creates 6 translate buttons (up/down/left/right/fwd/back)
export function createTranslateButtons(selectedElement, diagramManager){
    const step = 50;
    const buttons = [
        makeButton('translate_up', () => { selectedElement.position.y += step; diagramManager.updateConnections(selectedElement); }),
        makeButton('translate_left', () => { selectedElement.position.x -= step; diagramManager.updateConnections(selectedElement); }),
        makeButton('translate_move_forward', () => { selectedElement.position.z += step; diagramManager.updateConnections(selectedElement); }),
        makeButton('translate_move_back', () => { selectedElement.position.z -= step; diagramManager.updateConnections(selectedElement); }),
        makeButton('translate_right',() => { selectedElement.position.x += step; diagramManager.updateConnections(selectedElement); }),
        makeButton('translate_down', () => { selectedElement.position.y -= step; diagramManager.updateConnections(selectedElement); }),
    ];

    return buttons;
}

// Creates 2 scale buttons (plus/minus) that multiply the element's scale by a fixed factor
export function createScaleButtons(selectedElement, diagramManager){
    const buttons = [
        makeButton('plus', () => {
            selectedElement.scale.multiplyScalar(1.25);
            diagramManager.updateConnections(selectedElement); 
        }),
        makeButton('minus', () => {
            selectedElement.scale.multiplyScalar(0.8);
            diagramManager.updateConnections(selectedElement);
        }),
    ];
    return buttons;
}

// Creates 6 rotate buttons for all three axes (x/y/z), each stepping by ROTATE_STEP.
export function createRotateButtons(selectedElement, diagramManager){
    const buttons = [
        makeButton('rotate_down',       () => { selectedElement.rotation.x += ROTATE_STEP; diagramManager.updateConnections(selectedElement); }),
        makeButton('rotate_right',      () => { selectedElement.rotation.y -= ROTATE_STEP; diagramManager.updateConnections(selectedElement); }),
        makeButton('rotate_cross_down', () => { selectedElement.rotation.z -= ROTATE_STEP; diagramManager.updateConnections(selectedElement); }),
        makeButton('rotate_cross_up',   () => { selectedElement.rotation.z += ROTATE_STEP; diagramManager.updateConnections(selectedElement); }),
        makeButton('rotate_left',       () => { selectedElement.rotation.y += ROTATE_STEP; diagramManager.updateConnections(selectedElement); }),
        makeButton('rotate_up',         () => { selectedElement.rotation.x -= ROTATE_STEP; diagramManager.updateConnections(selectedElement); }),
    ];

    return buttons;
}

// Creates one button per BPMN element type, plus optional arrow/association buttons.
// onCreated is called with the newly created element; onArrow/onAssociation are called when the respective button is pressed.
export function createIndirectAddButtons(diagramManager, boardGroup, state, { onCreated, onArrow = null, onAssociation = null, selectedElement = null } = {}) {
    const types = ['startEvent', 'intermediateEvent', 'endEvent','parallelGateway', 'exclusiveGateway', 'task', 'dataObject'];

    const buttons = types.map(type =>
        makeButton(type, () => {
            diagramManager.history.saveSnapshot('create element');
            const element = createElement(type);
            if (selectedElement) {
                // Place new element to the right of the selected one, same height and depth
                element.position.set(
                    selectedElement.position.x + 225,
                    selectedElement.position.y,
                    selectedElement.position.z
                );
            } else {
                element.position.set(0, 0, 0);
            }
            boardGroup.add(element);
            state.addElement(element);
            onCreated?.(element);
        })
    );

    if (onArrow) buttons.push(makeButton('arrow', () => onArrow()));
    if (onAssociation) buttons.push(makeButton('association', () => onAssociation()));
    return buttons;
}

// Expects exactly 6 buttons: [up, left, fwd, back, right, down] — used for translate and rotate
export function layoutTransformButtons(buttons) {
    if (buttons.length !== 6) { console.warn('layoutTransformButtons: expected 6 buttons, got', buttons.length); return; }
    const spacing = 0.10, cx = 0, cy = 0, z = 0.01;
    buttons[0].position.set(cx,                cy + spacing, z); // up
    buttons[1].position.set(cx - spacing * 1.5, cy,          z); // left
    buttons[2].position.set(cx - spacing * 0.5, cy,          z); // fwd
    buttons[3].position.set(cx + spacing * 0.5, cy,          z); // back
    buttons[4].position.set(cx + spacing * 1.5, cy,          z); // right
    buttons[5].position.set(cx,                cy - spacing, z); // down
}

// Creates the seven persistent left-panel buttons shared across all layout states.
// onLoadDB overrides the default DOM-based loader (used in XR to show a 3D panel instead).
export function createPersistentButtons(diagramManager, { onAdd, onUndo, onRedo, onViewBack, onNewDiagram, onLoadDB }) {
    return {
        addBtn:        makeButton('add',         onAdd),
        backBtn:       makeButton('back',        onUndo),
        forwardBtn:    makeButton('forward',     onRedo),
        viewBackBtn:   makeButton('view_back',   onViewBack),
        newDiagramBtn: makeButton('new_diagram', onNewDiagram),
        loadDBBtn:     makeButton('load_db',     onLoadDB ?? (() => diagramManager.showDatabaseLoader())),
        saveDBBtn:     makeButton('save_db',     () => diagramManager.saveToDatabase()),
    };
}


// Creates all element-specific edit buttons for the currently selected element
export function createElementEditButtons(selected, diagramManager, { onDismiss, onSelect, onTranslate, onScale, onRotate }) {
    return {
        labelBtn:     createLabelButton(selected, diagramManager, null, onSelect),
        deleteBtn:    createDeleteButton(selected, diagramManager, onDismiss),
        translateBtn: !ElementValidator.isArrow(selected) ? makeButton('translate', onTranslate) : null,
        scaleBtn:     !ElementValidator.isArrow(selected) ? makeButton('scale', onScale) : null,
        rotateBtn:    !ElementValidator.isArrow(selected) && !ElementValidator.isLabel(selected) ? makeButton('rotate', onRotate) : null,
    };
}

// Builds the floating interaction panel with a background mesh, left button area,
// arrow navigation group, exit/switch-mode buttons, and a drag handle at the top.
// Returns the panel group; leftGroup and arrowBtns are stored in userData for later updates.
export function createPanel({ onExit, onNav, onSwitchMode }) {
    const panelGroup = new THREE.Group();
    const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.6),
        new THREE.MeshBasicMaterial({ color: 0x222222, opacity: 0.8, transparent: true })
    );
    panel.renderOrder = 998;
    panel.material.depthTest = false;
    panel.raycast = () => {}; // excluded from normal raycasting/hover; pinch handler checks it explicitly
    panel.userData.isPanelArea = true;
    panelGroup.add(panel);
    panelGroup.userData.panelBackground = panel; // reference for explicit pinch-to-scale detection

    // Left group: all dynamic left-side buttons managed by _updateLeftButtons
    const leftGroup = new THREE.Group();
    panelGroup.add(leftGroup);
    panelGroup.userData.leftGroup = leftGroup;

    // Right half: arrow navigation buttons
    const arrowBtns = createArrowButtons(onNav);
    arrowBtns.position.set(0.22, 0, 0.01);
    panelGroup.add(arrowBtns);
    panelGroup.userData.arrowBtns = arrowBtns;  

    // Bottom-left: exit and switch mode
    const exitBtn = makeButton('exit', () => onExit?.());
    exitBtn.position.set(-0.32, -0.22, 0.01);
    panelGroup.add(exitBtn);

    const switchModeBtn = makeButton('direct', () => onSwitchMode?.());
    switchModeBtn.position.set(-0.20, -0.22, 0.01);
    panelGroup.add(switchModeBtn);

    // Drag handle at top — isXRButton makes it raycasting-visible so pinches can hit it;
    // isDragHandle distinguishes it from regular buttons in the pinch handler
    const dragHandle = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.07),
        new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.6 })
    );
    dragHandle.position.set(0, 0.325, 0.01);
    dragHandle.renderOrder = 999;
    dragHandle.material.depthTest = false;
    dragHandle.userData.isXRButton = true;
    dragHandle.userData.isDragHandle = true;
    panelGroup.add(dragHandle);

    return panelGroup;
}