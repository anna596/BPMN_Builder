const AUTOSAVE_INTERVAL_MS = 30000; // 30 seconds

export class HistoryManager {
    constructor(state, boardGroup, persistence, transformControls, render, selector, isXRPresenting) {
        this.state = state;
        this.boardGroup = boardGroup;
        this.persistence = persistence;
        this.transformControls = transformControls;
        this.render = render;
        this.selector = selector;
        this.isXRPresenting = isXRPresenting ?? null;
        this.redoStack = [];
        this.undoStack = [];
        this.maxHistory = 50;

        this._autoSaveTimer = setInterval(() => this.autoSave(), AUTOSAVE_INTERVAL_MS);
    }

    // Saves the current diagram to localStorage without user action.
    // Also saves to database if a diagram is currently loaded.
    autoSave() {
        if (!this.isXRPresenting?.()) {
            this._saveToLocalStorage('autosave');
            console.log('Diagram autosaved to localStorage');
        }
        if (this.diagramManager?.currentDiagramId) {
            const dm = this.diagramManager;
            dm.persistence.updateDiagram(dm.currentDiagramId, dm.currentDiagramName)
                .catch(e => console.warn('Auto-save to database failed:', e.message));
        }
    }

    // Pushes a snapshot of the current state onto the undo stack.
    saveSnapshot(action) {
        const snapshot = {
            action: action || 'unspecified',
            data: this.persistence.exportToJSON(),
            timestamp: Date.now()
        };
        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxHistory) this.undoStack.shift(); // remove oldest
        this.redoStack = [];
        console.log(`[History] SAVE "${snapshot.action}" → ${snapshot.data.elements?.length ?? 0} elements, ${snapshot.data.connections?.length ?? 0} connections | stack: ${this.undoStack.length}`);
    }

    // Handles manual save by the user — persists to localStorage.
    save() {
        this._saveToLocalStorage('manual save');
        console.log('Diagram saved to localStorage');
    }

    // Reverts to the previous snapshot, pushing current state onto the redo stack.
    undo() {
        if (this.undoStack.length === 0) { console.log("No more actions to undo"); return; }
        const before = this._captureCurrentState();
        this.redoStack.push(before);
        const snapshot = this.undoStack.pop();
        this._restoreState(snapshot);
        console.log(`[History] UNDO "${snapshot.action}" → restoring ${snapshot.data.elements?.length ?? 0} elements, ${snapshot.data.connections?.length ?? 0} connections | remaining stack: ${this.undoStack.length} | was: ${before.data.elements?.length ?? 0} el, ${before.data.connections?.length ?? 0} conn`);
    }

    // Re-applies the next snapshot, pushing current state onto the undo stack.
    redo() {
        if (this.redoStack.length === 0) { console.log("No more actions to redo"); return; }
        this.undoStack.push(this._captureCurrentState());
        const snapshot = this.redoStack.pop();
        this._restoreState(snapshot);
        console.log(`Redid action: ${snapshot.action}`);
    }

    // Loads the last autosave or manual save from localStorage and restores it.
    loadSave() {
        const saved = localStorage.getItem('diagramSave');
        if (saved) {
            this._restoreState(JSON.parse(saved));
            console.log('Diagram loaded from localStorage');
        }
    }

    // Clears both history stacks (called when starting a new diagram).
    clear() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }

    // Serializes the current scene state into a snapshot object.
    _captureCurrentState() {
        return {
            action: 'checkpoint',
            data: this.persistence.exportToJSON(),
            timestamp: Date.now()
        };
    }

    // Restores the scene from a snapshot: detaches controls, clears selection, reimports.
    _restoreState(snapshot) {
        this.transformControls.detach();
        this.state.selectedElement = null;
        if (this.selector) {
            this.selector.selected = null;
            if (this.selector.selectionBox) this.selector.selectionBox.visible = false;
        }
        this.persistence.importFromJSON(snapshot.data, this.boardGroup);
        if (this.render) this.render();
    }

    // Serializes the current diagram and writes it to localStorage under 'diagramSave'.
    _saveToLocalStorage(action) {
        const snapshot = {
            action,
            data: this.persistence.exportToJSON(),
            timestamp: Date.now()
        };
        localStorage.setItem('diagramSave', JSON.stringify(snapshot));
    }
}
