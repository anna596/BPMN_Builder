import { UIPanel, UIRow } from '../libs/ui.js';
import { createIcon } from '../diagram/ElementCreator.js';
import { makeDraggable } from './DraggablePanel.js';
import { ElementValidator } from '../validators/ElementValidator.js';

// Creates the editor panel shown at the bottom of the screen onnce an element is selected  
// Handles element editing: transform, labels, and deletion
export function createEditorPanel(state, selector, transformControl, diagramManager, selectedArrow = false) {
    const container = new UIPanel();
    container.setClass('object-editor');

    const options = new UIPanel();
    options.setClass('editor-options');
    container.add(options);

    function addOption(label, mode, onClickHandler) {
        const option = new UIRow();
        option.setClass('option');

        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';

        wrapper.appendChild(createIcon(mode, 32));
        option.dom.appendChild(wrapper);
        option.dom.title = label;
        options.add(option);

        option.onClick(() => onClickHandler?.());
    }

    // arrows only get label editing and deletion, no transform controls
    if (!selectedArrow) {
        // Transform controls
        addOption("Translate", "translate", () => {
            transformControl.setMode("translate");
        });

        addOption("Scale", "scale", () => {
            transformControl.setMode("scale");
        });

        addOption("Rotate", "rotate", () => {
            transformControl.setMode("rotate");
        });

    }

    // Label management
    addOption("Label", "label", () => {
        diagramManager.editLabel(state.selectedElement, {
            openEditor: (target) => selector.editLabel(target)
        });
    });

    // Deletion
    addOption("Delete", "delete", () => {
        diagramManager.history.saveSnapshot('delete element');
        const primary = state.selectedElement;
        const extras = [...selector.multiSelected];
        selector.clearMultiSelection();
        for (const el of extras) diagramManager.deleteSelected(el, { skipSnapshot: true });
        diagramManager.deleteSelected(primary, {
            skipSnapshot: true,
            onDismiss: () => closeEditorPanel(selector, transformControl, container, state, diagramManager)
        });
    });

    document.body.appendChild(container.dom);
    makeDraggable(container.dom, container.dom);
    return container;
}

// Closes the editor panel and cleans up
function closeEditorPanel(selector, transformControl, container, state, diagramManager) {
    selector.selectionBox.visible = false;
    selector.clearMultiSelection();
    selector.selected = null;
    transformControl.detach();
    removeEditorPanel(container);
    state.selectedElement = null;
    diagramManager.editorPanel = null;
}

// Removes the editor panel from the DOM
export function removeEditorPanel(panel) {
    if (panel && panel.dom && panel.dom.parentNode) {
        panel.dom.parentNode.removeChild(panel.dom);
    }
}

