import * as THREE from 'three';
import { createLabel } from '../diagram/ElementCreator.js';
import { ElementValidator } from '../validators/ElementValidator.js';

const ELEMENT_LABEL_OFFSET_Y = -25; // distance below the element's bottom edge
const ARROW_LABEL_OFFSET_Y  = -15; // distance below the arrow midpoint

export class LabelManager {
    // Wraps a BPMN element in a labelGroup: creates the label mesh, transfers the element's
    // local transform to the group, and replaces the bare element in state and boardGroup.
    static addLabelToElement(element, state, boardGroup, diagramManager) {
        if (!ElementValidator.canAddLabelToElement(element)) {
            console.warn('Cannot add label to this element');
            return null;
        }

        const labelGroup = new THREE.Group();
        const label = createLabel(" ", 0.5, 200, labelGroup.id);

        // Capture the element's local transform before resetting it —
        // the group will take over this position/rotation/scale in the scene
        const localPos = element.position.clone();
        const localQuat = element.quaternion.clone();
        const localScale = element.scale.clone();

        // Position label just below the element's bottom edge in WORLD space.
        // The labelGroup inherits the element's rotation, so a plain local (0, -y, 0) offset
        // would follow the rotation and end up behind the element if it's tilted.
        // Apply the inverse of the group quaternion so the offset points world-down regardless.
        const worldBelowOffset = new THREE.Vector3(
            0,
            -element.geometry.parameters.height / 2 + ELEMENT_LABEL_OFFSET_Y,
            0
        );
        worldBelowOffset.applyQuaternion(localQuat.clone().invert());
        label.position.copy(worldBelowOffset);
        label.userData.offset = label.position.clone();
        label.userData.isLabel = true;

        // Zero out the element's transform so it sits at the group's origin
        element.position.set(0, 0, 0);
        element.quaternion.set(0, 0, 0, 1);
        element.scale.set(1, 1, 1);

        // Give the group the element's original transform and add both children
        labelGroup.position.copy(localPos);
        labelGroup.quaternion.copy(localQuat);
        labelGroup.scale.copy(localScale);
        labelGroup.add(label, element);

        labelGroup.userData.isBPMNElement = true;
        labelGroup.userData.hasLabel = true;
        labelGroup.userData.label = label;
        labelGroup.userData.element = element;

        // Swap bare element for labelGroup in state and scene
        state.replaceElement(element, labelGroup);
        boardGroup.remove(element);
        boardGroup.add(labelGroup);

        // Reroute any arrows that pointed at the element to point at the group instead
        if (diagramManager) {
            diagramManager.updateConnectionReferences(element, labelGroup);
        }
        return labelGroup;
    }

    // Adds a floating label mesh to an existing arrow.
    // Returns the label mesh, or null if the arrow already has one or isn't found in state.
    static addLabelToArrow(arrowGroup, state) {
        if (!ElementValidator.canAddLabelToArrow(arrowGroup)) {
            console.warn('Cannot add label to this arrow');
            return null;
        }

        const conn = state.connections.find(c => c.group === arrowGroup);
        if (!conn) {
            console.warn('Connection for arrow not found');
            return null;
        }

        const label = createLabel(" ", 0.5, 200, arrowGroup.id);
        label.position.set(0, ARROW_LABEL_OFFSET_Y, 0);
        label.userData.offset = label.position.clone();
        label.userData.isLabel = true;

        // Attach label to the arrow group and record it on both the group and the connection
        arrowGroup.add(label);
        arrowGroup.userData.hasLabel = true;
        arrowGroup.userData.label = label;
        conn.label = label;

        return label;
    }

    // Removes a label mesh and restores the scene to its pre-label state.
    // For arrow labels: detaches the mesh and clears the connection's label reference.
    // For element labels: unwraps the labelGroup and restores the bare element in its place.
    static removeLabel(label, state, boardGroup, diagramManager) {
        if (!label?.userData?.isLabel) {
            console.warn('Object is not a label');
            return false;
        }

        const parent = label.parent;

        // Arrow label
        if (parent?.userData?.isArrow) {
            const conn = state.connections.find(c => c.group === parent);
            if (conn) {
                conn.label = null;
                parent.userData.hasLabel = false;
                parent.userData.label = null;
            }
            parent.remove(label);
            return true;
        }

        // Element label: unwrap labelGroup and restore bare element
        if (parent?.userData?.hasLabel && parent.children.length === 2) {
            const originalElement = parent.children.find(
                child => child.userData.isBPMNElement && !child.userData.isLabel
            );

            if (originalElement) {
                parent.remove(label);

                // The element returns to the same parent as the group was in,
                // so copy the group's local transform directly onto the element
                const localPos = parent.position.clone();
                const localQuat = parent.quaternion.clone();
                const localScale = parent.scale.clone();

                parent.remove(originalElement);
                originalElement.position.copy(localPos);
                originalElement.quaternion.copy(localQuat);
                originalElement.scale.copy(localScale);
                originalElement.userData.hasLabel = false;
                originalElement.userData.label = null;

                // Swap labelGroup for bare element in state and scene
                const grandParent = parent.parent;
                state.replaceElement(parent, originalElement);
                if (grandParent) {
                    grandParent.remove(parent);
                    grandParent.add(originalElement);
                } else {
                    boardGroup.remove(parent);
                    boardGroup.add(originalElement);
                }

                // Reroute arrows that pointed at the group back to the bare element
                if (diagramManager) {
                    diagramManager.updateConnectionReferences(parent, originalElement);
                }
                return true;
            }
        }

        return false;
    }
}