import * as THREE from 'three';
import { UIPanel, UIRow } from '../libs/ui.js';
import { createElement, createArrow, createAssociationArrow, createIcon} from '../diagram/ElementCreator.js';
import { getLogicalElement } from '../diagram/DiagramManager.js';
import { makeDraggable } from './DraggablePanel.js';

// Z offset so placed elements appear in front of the board plane (which sits at z = -50)
const ELEMENT_Z_OFFSET = 70;


// Creates the BPMN panel for adding elements and drawing arrows.
export function createBPMNPanel(state, boardGroup, camera, renderer, selector, diagramManager) {
    // Interaction state — scoped per panel instance
    let pendingElementType = null;
    let arrowSource = null;
    let arrowTarget = null;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const container = new UIPanel();
    container.setClass('bpmn-panel');

    const title = new UIPanel();
    title.setClass('title');
    title.setTextContent('Add BPMN Element');
    container.add(title);

    const options = new UIPanel();
    options.setClass('options');
    container.add(options);

    // Adds a labeled icon row to the panel. Clicking it arms the given type for placement.
    // Arrow mode disables the transform control so raycasting hits elements, not transform helpers.
    function addOption(label, type) {
        const option = new UIRow();
        option.setClass('option');

        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';

        const icon = createIcon(type);
        wrapper.appendChild(icon);

        const text = document.createElement('span');
        text.textContent = label;
        wrapper.appendChild(text);

        option.dom.appendChild(wrapper);
        options.add(option);

        option.onClick(() => {
            pendingElementType = type;
            arrowSource = null;
            arrowTarget = null;
            if (type === 'arrow' || type === 'association') {
                selector.select(null);
                selector.setArrowMode(true);
            } else {
                selector.setArrowMode(false);
            }
        });
    }

    addOption("Start Event",          "startEvent");
    addOption("Intermediate Event",   "intermediateEvent");
    addOption("End Event",            "endEvent");
    addOption("Parallel Gateway",     "parallelGateway");
    addOption("Exclusive Gateway",    "exclusiveGateway");
    addOption("Task",                 "task");
    addOption("Data Object",          "dataObject");
    addOption("Sequence Flow",        "arrow");
    addOption("Association",          "association");

    // Canvas click handler — ignored until a type is armed via addOption.
    function onClick(event) {
        if (!pendingElementType) return;

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        if (pendingElementType !== 'arrow' && pendingElementType !== 'association') {
            _handleElementCreation();
        } else {
            _handleArrowCreation(event);
        }
    }

    // Places the armed element type at the clicked position on the board plane.
    function _handleElementCreation() {
        // Intersect against the board plane (z = -50 in board-local space)
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -50);
        const intersectionPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersectionPoint);

        if (!intersectionPoint) return;

        diagramManager.history.saveSnapshot('create element');
        const element = createElement(pendingElementType);
        element.position.copy(intersectionPoint);
        element.position.z += ELEMENT_Z_OFFSET; // place in front of the board plane

        boardGroup.add(element);
        state.addElement(element);
        pendingElementType = null;
    }

    // Two-click arrow creation: first click sets source, second click sets target.
    // Labels are skipped — arrows must connect to BPMN elements.
    // Logical references (labelGroup or element) are stored on the connection for later use in updates and deletion.
    function _handleArrowCreation(event) {
        const intersects = selector.getPointerIntersects(event);
        if (intersects.length === 0) return;

        const object = intersects[0].object;
        if (object.userData.isLabel) return;

        if (!arrowSource) {
            arrowSource = object;
            selector.select(object, false);
            return;
        }

        arrowTarget = object;

        const logicalSource = getLogicalElement(arrowSource);
        const logicalTarget = getLogicalElement(arrowTarget);

        // Prevent self-loops and duplicate connections of the same type
        const isSelf = logicalSource === logicalTarget;
        const alreadyExistsSameType = state.connections.some(c =>
            c.logicalSource === logicalSource && c.logicalTarget === logicalTarget && c.type === (pendingElementType || 'arrow')
        );

        if (!isSelf && !alreadyExistsSameType) {
            const conn = pendingElementType === 'association'
                ? createAssociationArrow(arrowSource, arrowTarget)
                : createArrow(arrowSource, arrowTarget);
            conn.logicalSource = logicalSource;
            conn.logicalTarget = logicalTarget;
            conn.group.userData.isBPMNElement = true;
            boardGroup.add(conn.group);
            diagramManager.history.saveSnapshot('create arrow');
            state.addConnection(conn);
        }

        // Reset regardless of whether arrow was created
        selector.select(null);
        arrowSource = null;
        arrowTarget = null;
        pendingElementType = null;
        selector.setArrowMode(false);
    }

    renderer.domElement.addEventListener('click', onClick);

    // Attach cleanup so removePanel can detach the listener
    container._dispose = () => renderer.domElement.removeEventListener('click', onClick);

    document.body.appendChild(container.dom);
    makeDraggable(container.dom, container.dom);

    return container;
}

// Removes the BPMN panel from the DOM and detaches its click listener.
export function removePanel(panel) {
    if (!panel) return;
    panel._dispose?.();
    if (panel.dom?.parentNode) panel.dom.parentNode.removeChild(panel.dom);
}
