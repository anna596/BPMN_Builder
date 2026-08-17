import { UIPanel, UIRow } from '../libs/ui.js';
import { createIcon} from '../diagram/ElementCreator.js';
import { makeDraggable } from './DraggablePanel.js';

// Creates the file toolbar shown at the top of the screen.
// All actions are wired via callbacks 
export function createFileEditor(persistence, callbacks = {}) {
    const container = new UIPanel();
    container.setClass('file-editor');

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

    // Hidden file input — triggered programmatically by the Open button.
    // Appended to body so the browser accepts the click() call.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) callbacks.onOpen?.(file);
        // Reset so the same file can be re-selected
        fileInput.value = '';
    });

    addOption("Add",                "add",         () => callbacks.onAdd?.());
    addOption("Back",               "back",        () => callbacks.onBack?.());
    addOption("Forward",            "forward",     () => callbacks.onForward?.());
    addOption("Save",               "save",        () => callbacks.onSave?.());
    addOption("New Diagram",        "new_diagram", () => callbacks.onNewDiagram?.());
    addOption("Open",               "open",        () => fileInput.click());
    addOption("Download",           "download",    () => persistence.saveToFile());
    addOption("Load from Database", "load_db",     () => callbacks.onLoadFromDatabase?.());
    addOption("Save to Database",   "save_db",     () => callbacks.onSaveToDatabase?.());

    document.body.appendChild(container.dom);
    makeDraggable(container.dom, container.dom);
    return container;
}
