import * as THREE from 'three';
import { makeButton, layoutButtons } from '../XRButtonFactory.js';
import { ElementValidator } from '../../validators/ElementValidator.js';

const BTN = 0.06;   // button size for direct interaction
const GAP = 0.085;  // grid spacing for direct interaction

// Creates label + delete buttons, and optionally an add button for non-arrow elements.
export function createEditButtons(position, diagramManager, callbacks = {}) {
    const { onDismiss, onSelect, onReplaceButtons, onSetPendingType } = callbacks;
    const group = new THREE.Group();
    group.userData.isXRButtonGroup = true;
    const selected = diagramManager.state.selectedElement;

    const buttons = [
        ...(onReplaceButtons && !ElementValidator.isArrow(selected) && !ElementValidator.isLabel(selected) ? [
            makeButton('add', () => onReplaceButtons(createAddButtons(position, onDismiss, onSetPendingType)), BTN)
        ] : []),
        makeButton('label',  () => diagramManager.editLabel(selected, { onDismiss, onSelect }), BTN),
        makeButton('delete', () => diagramManager.deleteSelected(selected, { onDismiss }), BTN),
    ];

    layoutButtons(group, buttons, position, 1, null, 'center', GAP);
    return group;
}

// Creates element-type buttons for placing new BPMN elements or arrows.
// onWrist omits the arrow option (arrows need a source element to connect from).
// onTypeSelected(type, btn): when provided (wrist mode), highlights the chosen button instead of dismissing.
export function createAddButtons(position, onDismiss, onSetPendingType, onWrist = false, onTypeSelected = null) {
    const group = new THREE.Group();
    group.userData.isXRButtonGroup = true;

    // Row-major order for 2-column grid:
    // start | task
    // inter | dataObject
    // end   | arrow
    // para  | association
    // excl  |
    const types = onWrist
        ? ['startEvent', 'task', 'intermediateEvent', 'dataObject', 'endEvent', 'parallelGateway', 'exclusiveGateway']
        : ['startEvent', 'task', 'intermediateEvent', 'dataObject', 'endEvent', 'arrow', 'parallelGateway', 'association', 'exclusiveGateway'];

    const buttons = types.map(type => {
        const btn = makeButton(type, () => {
            onSetPendingType?.(type);
            if (onTypeSelected) {
                onTypeSelected(type, btn); // wrist: keep menu visible, highlight selected
            } else {
                onDismiss?.();             // non-wrist: dismiss after selection
            }
        }, BTN);
        return btn;
    });

    layoutButtons(group, buttons, position, 2, null, 'leftCenter', GAP);
    return group;
}

// Creates translate / scale / rotate mode buttons.
export function createTransformControlButtons(position, directInteraction, selected) {
    const group = new THREE.Group();
    group.userData.isXRButtonGroup = true;
    group.userData.modeButtons = {};

    const modes = ['translate', 'scale'];
    if (!ElementValidator.isLabel(selected)) modes.push('rotate'); // no rotation for labels, they always face the camera
    const buttons = modes.map(mode => {
        const btn = makeButton(mode, () => directInteraction.setXRTransformMode(mode), BTN);
        group.userData.modeButtons[mode] = btn;
        return btn;
    });

    layoutButtons(group, buttons, position, 1, null, 'center', GAP);
    return group;
}

// Left wrist menu: add element, undo, redo.
export function createLeftHandButtons(diagramManager, { onDismiss, onReplaceButtons, onSetPendingType, onTypeSelected } = {}) {
    const group = new THREE.Group();
    group.userData.isXRButtonGroup = true;

    const buttons = [
        makeButton('add', () => {
            onReplaceButtons?.(createAddButtons(new THREE.Vector3(), onDismiss, onSetPendingType, true, onTypeSelected));
        }, BTN),
        makeButton('back',    () => diagramManager.history.undo(), BTN),
        makeButton('forward', () => diagramManager.history.redo(), BTN),
    ];

    // Position is overridden each frame by _updateHandGroupPosition
    layoutButtons(group, buttons, new THREE.Vector3(), buttons.length, 1, 'center', GAP);
    return group;
}

// Right wrist menu: new diagram, load, save, exit, switch mode.
export function createRightHandButtons(diagramManager, { onSwitchMode, onExit, onLoadDB } = {}) {
    const group = new THREE.Group();
    group.userData.isXRButtonGroup = true;

    const buttons = [
        makeButton('new_diagram', () => diagramManager.newDiagram(), BTN),
        makeButton('load_db',     onLoadDB ?? (() => diagramManager.showDatabaseLoader()), BTN),
        makeButton('save_db',     () => diagramManager.saveToDatabase(), BTN),
        makeButton('exit',        () => onExit?.(), BTN),
        makeButton('indirect',    () => onSwitchMode?.(), BTN),
    ];

    // Position is overridden each frame by _updateHandGroupPosition
    layoutButtons(group, buttons, new THREE.Vector3(), 3, null, 'center', GAP);
    return group;
}
