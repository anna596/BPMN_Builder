// Central store for all diagram state: BPMN elements, arrows, and current selection.
// Callers read state directly via the public properties (elements, connections, selectedElement).
export class DiagramState {
    constructor() {
        this.elements = [];       // Three.js objects for all BPMN elements (including labelGroups)
        this.connections = [];    // connection data objects { source, target, group, logicalSource, logicalTarget, label }
        this.selectedElement = null; // currently selected object, or null
    }

    // --- Element management ---

    // Adds an element and returns it
    addElement(element) {
        if (!element) throw new Error('Cannot add null element');
        this.elements.push(element);
        return element;
    }

    // Removes an element by reference
    removeElement(element) {
        const idx = this.elements.indexOf(element);
        if (idx > -1) {
            this.elements.splice(idx, 1);
            return true;
        }
        return false;
    }

    // Swaps oldElement for newElement in-place (used when wrapping an element in a labelGroup).
    replaceElement(oldElement, newElement) {
        const idx = this.elements.indexOf(oldElement);
        if (idx > -1) {
            this.elements.splice(idx, 1, newElement);
            return true;
        }
        return false;
    }

    // --- Connection management ---

    // Adds a connection and returns it. .
    addConnection(connection) {
        if (!connection) throw new Error('Cannot add null connection');
        this.connections.push(connection);
        return connection;
    }

    // Removes a connection by reference. 
    removeConnection(connection) {
        const idx = this.connections.indexOf(connection);
        if (idx > -1) {
            this.connections.splice(idx, 1);
            return true;
        }
        return false;
    }

    // Returns all connections that touch the given element (as source or target).
    findConnectionsFor(element) {
        return this.connections.filter(conn =>
            conn.source === element || conn.target === element
        );
    }

    // Returns the group for each connection (the arrow mesh + optional label).
    // Used when building raycast target lists.
    getConnectionGroups() {
        return this.connections.map(conn => conn.group);
    }

    hasElement(element) {
        return this.elements.includes(element);
    }
}