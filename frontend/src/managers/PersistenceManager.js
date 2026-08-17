import { getLogicalElement } from "../diagram/DiagramManager.js";
import { LabelManager } from './LabelManager.js';
import { createElement, updateTaskLabel, createArrow, createAssociationArrow, updateLabel} from '../diagram/ElementCreator.js';
import { API_BASE_URL } from '../config.js';

// Handles serialization, deserialization, and persistence of diagram state.
// Supports export/import via JSON file and CRUD operations
export class PersistenceManager {
    constructor(state){
        this.state = state;
    }

    // Serializes the current diagram to a plain JSON object.
    // Only BPMN elements are included (grid/helper objects are skipped).
    exportToJSON() {
        return {
            version: "1.0",
            timestamp: new Date().toISOString(),
            elements: this.state.elements
                .filter(el => el.userData.isBPMNElement)
                .map(el => this._serializeElement(el)),
            connections: this.state.connections.map(conn => this._serializeConnection(conn))
        };
    }

    // Triggers a browser download of the diagram as a JSON file.
    saveToFile(filename = 'diagram.json') {
        const json = this.exportToJSON();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    }

    // Reads a File object, parses it as JSON, and rebuilds the scene via importFromJSON.
    loadFromFile(file, boardGroup) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const json = JSON.parse(reader.result);
                    this.importFromJSON(json, boardGroup);
                    resolve(true);
                } catch (err) {
                    console.error('Failed to load diagram:', err);
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // Clears the scene and rebuilds it from a JSON object (used by undo/redo and file/DB load).
    importFromJSON(json, boardGroup) {
        if (!json) return;
        this._resetState(boardGroup);

        // uuid used to resolve connection endpoints after all elements are created
        const uuidMap = new Map();

        (json.elements || []).forEach(data => this._recreateElement(data, boardGroup, uuidMap));

        // World matrices must be up to date before createArrow computes endpoint positions
        boardGroup.updateWorldMatrix(true, true);
        (json.connections || []).forEach(data => this._recreateConnection(data, boardGroup, uuidMap));
    }

    // Recreates one element from its serialized data and registers it in state and uuidMap.
    // Handles three cases: task (inline text), element with label mesh, and plain element.
    _recreateElement(data, boardGroup, uuidMap) {
        const { type, uuid, position = [0,0,0], rotation = [0,0,0], scale = [1,1,1], label } = data;
        const base = createElement(type, { position, rotation, scale });
        if (!base) return;

        if (base.userData.isTask && label && typeof label.text === 'string') {
            // Task: text is rendered inline on the mesh, not as a separate label object
            updateTaskLabel(base, label.text);
            base.userData.text = label.text;
            if (uuid) base.uuid = uuid;
            boardGroup.add(base);
            this.state.addElement(base);
            uuidMap.set(base.uuid, base);

        } else if (!base.userData.isTask && label && typeof label === 'object' && typeof label.text === 'string') {
            // BPMN element with a separate floating label mesh —
            // add the element first so LabelManager can wrap it in a labelGroup
            if (uuid) base.uuid = uuid;
            boardGroup.add(base);
            this.state.addElement(base);

            const labelGroup = LabelManager.addLabelToElement(base, this.state, boardGroup, null);
            if (labelGroup) {
                // Restore saved label text and local transform
                const lbl = labelGroup.userData.label;
                if (label.uuid) lbl.uuid = label.uuid;
                lbl.userData.text = label.text;
                updateLabel(lbl, label.text);
                lbl.position.fromArray(label.position || [0,0,0]);
                lbl.rotation.fromArray(label.rotation || [0,0,0]);
                if (label.scale) lbl.scale.fromArray(label.scale);

                // Restore the group's world transform (overrides LabelManager's default)
                labelGroup.position.fromArray(position);
                labelGroup.rotation.fromArray(rotation);
                labelGroup.scale.fromArray(scale);

                if (uuid) labelGroup.uuid = uuid;
                labelGroup.userData.elementType = type;
                uuidMap.set(labelGroup.uuid, labelGroup);
            }
        } else {
            // Plain element with no label
            if (uuid) base.uuid = uuid;
            boardGroup.add(base);
            this.state.addElement(base);
            uuidMap.set(base.uuid, base);
        }
    }

    // Recreates one connection from its serialized data, including its optional label.
    _recreateConnection(data, boardGroup, uuidMap) {
        const src = uuidMap.get(data.sourceId);
        const tgt = uuidMap.get(data.targetId);
        if (!src || !tgt) return;

        // Pass boardGroup so positions are computed in board-local space,
        const conn = data.type === 'association'
            ? createAssociationArrow(src, tgt, boardGroup)
            : createArrow(src, tgt, boardGroup);
        conn.logicalSource = getLogicalElement(src);
        conn.logicalTarget = getLogicalElement(tgt);
        conn.group.userData.isBPMNElement = true;
        boardGroup.add(conn.group);
        this.state.addConnection(conn);

        // Restore arrow label if one was saved
        if (data.label && typeof data.label.text === 'string') {
            conn.group.userData.hasLabel = false; // LabelManager checks this flag before adding
            LabelManager.addLabelToArrow(conn.group, this.state);
            const lbl = conn.label;
            if (lbl) {
                if (data.label.uuid) lbl.uuid = data.label.uuid;
                lbl.userData.text = data.label.text;
                updateLabel(lbl, data.label.text);
                lbl.position.fromArray(data.label.position || [0,0,0]);
                lbl.rotation.fromArray(data.label.rotation || [0,0,0]);
                if (data.label.scale) lbl.scale.fromArray(data.label.scale);
            }
        }
    }

    // Empties state arrays and removes all diagram objects from the boardGroup.
    _resetState(boardGroup) {
        this.state.elements.length = 0;
        this.state.connections.length = 0;
        this.state.selectedElement = null;

        if (boardGroup) {
            [...boardGroup.children].forEach(child => {
                const ud = child.userData || {};
                if (ud.isBPMNElement || ud.isArrow || ud.hasLabel) {
                    boardGroup.remove(child);
                }
            });
        }
    }

    // Serializes one element
    _serializeElement(element) {
        return {
            type: this._getElementType(element),
            uuid: element.uuid,
            position: element.position.toArray(),
            rotation: element.rotation.toArray(),
            scale: element.scale.toArray(),
            label: element.userData.isTask
                ? { text: element.userData.text || '' }
                : (element.userData.hasLabel && element.userData.label
                    ? this._serializeLabel(element.userData.label)
                    : null)
        };
    }

    // Serializes a label mesh
    _serializeLabel(label) {
        return {
            uuid: label.uuid,
            text: label.userData.text || '',
            position: label.position.toArray(),
            rotation: label.rotation.toArray(),
            scale: label.scale.toArray()
        };
    }

    // Serializes a connection
    _serializeConnection(conn) {
        return {
            type: conn.type || 'arrow',
            sourceId: conn.logicalSource?.uuid ?? conn.source.uuid,
            targetId: conn.logicalTarget?.uuid ?? conn.target.uuid,
            label: conn.label ? this._serializeLabel(conn.label) : null
        };
    }

    // Returns the BPMN type for an element.
    // For labelGroups, looks inside the group to find the wrapped element's type.
    _getElementType(element) {
        if (element.userData.hasLabel && element.children.length > 0) {
            const innerElement = element.children.find(child => child.userData.isBPMNElement);
            if (innerElement?.userData.elementType) return innerElement.userData.elementType;
        }
        if (element.userData.elementType) return element.userData.elementType;
        return 'unknown';
    }

    // ========== DATABASE API METHODS ==========

    // Shared fetch helper
    async _apiFetch(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${url} failed: ${response.statusText}`);
        return response.json();
    }

    // Fetch all diagrams from database
    async fetchDiagramsList() {
        try {
            return await this._apiFetch(`${API_BASE_URL}/diagrams`);
        } catch (error) {
            console.error('Error fetching diagrams:', error);
            throw error;
        }
    }

    // Load a specific diagram from database
    async loadFromDatabase(diagramId, boardGroup) {
        try {
            const data = await this._apiFetch(`${API_BASE_URL}/diagrams/${diagramId}`);
            this.importFromJSON(data.diagram_data, boardGroup);
            return { id: data.id, name: data.name, created_at: data.created_at, updated_at: data.updated_at };
        } catch (error) {
            console.error('Error loading diagram from database:', error);
            throw error;
        }
    }

    // Save new diagram to database
    async saveToDatabase(name) {
        try {
            const result = await this._apiFetch(`${API_BASE_URL}/diagrams`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, diagramData: this.exportToJSON() })
            });
            console.log('Diagram saved to database:', result);
            return result;
        } catch (error) {
            console.error('Error saving diagram to database:', error);
            throw error;
        }
    }

    // Rename a diagram without changing its data
    async renameDiagram(diagramId, newName) {
        const response = await fetch(`${API_BASE_URL}/diagrams/${diagramId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
        });
        if (!response.ok) throw new Error(`Rename failed: ${response.statusText}`);
        return response.json();
    }

    // Delete a diagram from the database
    async deleteDiagram(diagramId) {
        const response = await fetch(`${API_BASE_URL}/diagrams/${diagramId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`DELETE failed: ${response.statusText}`);
    }

    // Update existing diagram in database
    async updateDiagram(diagramId, name) {
        try {
            const result = await this._apiFetch(`${API_BASE_URL}/diagrams/${diagramId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, diagramData: this.exportToJSON() })
            });
            console.log('Diagram updated in database:', result);
            return result;
        } catch (error) {
            console.error('Error updating diagram in database:', error);
            throw error;
        }
    }
}
