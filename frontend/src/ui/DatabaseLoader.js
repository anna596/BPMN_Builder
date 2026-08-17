
import penIcon from '../utils/images/pen.svg';

// Shows a small modal asking "Save changes to '<name>'?". Returns a Promise<boolean>.
export function confirmSave(name) {
    return new Promise(resolve => {
        const overlay = makeEl('div', {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: '10001',
        });
        const box = makeEl('div', {
            backgroundColor: '#2a2a2a', border: '2px solid #444', borderRadius: '8px',
            padding: '24px 28px', minWidth: '320px', color: '#fff', fontFamily: 'Arial',
            display: 'flex', flexDirection: 'column', gap: '20px',
        });
        const msg = makeEl('div', { fontSize: '16px' });
        msg.textContent = `Save changes to "${name}"?`;
        box.appendChild(msg);

        const btns = makeEl('div', { display: 'flex', justifyContent: 'flex-end', gap: '10px' });
        const cancel = makeEl('button', {
            padding: '7px 16px', backgroundColor: '#444', color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
        });
        cancel.textContent = 'Cancel';
        cancel.onclick = () => { document.body.removeChild(overlay); resolve(false); };

        const save = makeEl('button', {
            padding: '7px 16px', backgroundColor: '#4a90d9', color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
        });
        save.textContent = 'Save';
        save.onclick = () => { document.body.removeChild(overlay); resolve(true); };

        btns.appendChild(cancel);
        btns.appendChild(save);
        box.appendChild(btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        save.focus();
    });
}

// Shows a small modal to enter a diagram name. Returns a Promise<string|null>.
export function promptDiagramName(defaultName = '') {
    return new Promise(resolve => {
        const overlay = makeEl('div', {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: '10001',
        });
        const box = makeEl('div', {
            backgroundColor: '#2a2a2a', border: '2px solid #444', borderRadius: '8px',
            padding: '24px 28px', minWidth: '360px', color: '#fff', fontFamily: 'Arial',
            display: 'flex', flexDirection: 'column', gap: '16px',
        });
        const label = makeEl('div', { fontSize: '16px' });
        label.textContent = 'Enter diagram name:';
        box.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultName;
        Object.assign(input.style, {
            fontSize: '15px', padding: '7px 10px', borderRadius: '4px',
            border: '1px solid #666', backgroundColor: '#1a1a1a', color: '#fff',
            outline: 'none', width: '100%', boxSizing: 'border-box',
        });
        box.appendChild(input);

        const btns = makeEl('div', { display: 'flex', justifyContent: 'flex-end', gap: '10px' });
        const cancel = makeEl('button', {
            padding: '7px 16px', backgroundColor: '#444', color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
        });
        cancel.textContent = 'Cancel';
        cancel.onclick = () => { document.body.removeChild(overlay); resolve(null); };

        const save = makeEl('button', {
            padding: '7px 16px', backgroundColor: '#4a90d9', color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
        });
        save.textContent = 'Save';
        const doSave = () => {
            const name = input.value.trim();
            if (!name) return;
            document.body.removeChild(overlay);
            resolve(name);
        };
        save.onclick = doSave;
        input.onkeydown = (e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') cancel.onclick(); };

        btns.appendChild(cancel);
        btns.appendChild(save);
        box.appendChild(btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        input.focus();
        input.select();
    });
}

// Creates a modal dialog for loading diagrams from the database.
// Works in both desktop browsers and XR headsets
export function createDatabaseLoader(persistence, onLoad) {
    const overlay = makeEl('div', {
        position: 'fixed', top: '0', left: '0',
        width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        zIndex: '10000',
    });

    const dialog = makeEl('div', {
        backgroundColor: '#2a2a2a', border: '2px solid #444', borderRadius: '8px',
        padding: '20px', minWidth: '500px', maxWidth: '700px', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', color: '#fff', fontFamily: 'Arial',
    });

    const title = makeEl('h2', { margin: '0 0 20px 0', fontSize: '20px', color: '#fff' });
    title.textContent = 'Load Diagram from Database';
    dialog.appendChild(title);

    // Scrollable list area — populated once the fetch resolves
    const listContainer = makeEl('div', {
        flex: '1', overflowY: 'auto', marginBottom: '20px',
        border: '1px solid #444', borderRadius: '4px', padding: '10px',
    });
    dialog.appendChild(listContainer);

    // Cancel button
    const cancelButton = makeEl('button', {
        padding: '8px 16px', backgroundColor: '#444', color: '#fff',
        border: 'none', borderRadius: '4px', cursor: 'pointer',
    });
    cancelButton.textContent = 'Cancel';
    cancelButton.onclick = () => document.body.removeChild(overlay);

    const buttonsContainer = makeEl('div', { display: 'flex', justifyContent: 'flex-end', gap: '10px' });
    buttonsContainer.appendChild(cancelButton);
    dialog.appendChild(buttonsContainer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function refresh() {
        listContainer.innerHTML = '';
        const loadingText = makeEl('div', { padding: '20px', textAlign: 'center', color: '#888' });
        loadingText.textContent = 'Loading diagrams...';
        listContainer.appendChild(loadingText);

        persistence.fetchDiagramsList()
            .then(diagrams => {
                listContainer.innerHTML = '';
                if (diagrams.length === 0) {
                    const empty = makeEl('div', { padding: '20px', textAlign: 'center', color: '#888' });
                    empty.textContent = 'No diagrams found in database.';
                    listContainer.appendChild(empty);
                    return;
                }
                diagrams.forEach(diagram => {
                    const item = createDiagramItem(
                        diagram,
                        () => { document.body.removeChild(overlay); onLoad?.(diagram.id); },
                        async () => {
                            const newName = await promptDiagramName(diagram.name);
                            if (newName && newName !== diagram.name) {
                                await persistence.renameDiagram(diagram.id, newName);
                                refresh();
                            }
                        },
                        async () => { await persistence.deleteDiagram(diagram.id); refresh(); }
                    );
                    listContainer.appendChild(item);
                });
            })
            .catch(error => {
                listContainer.innerHTML = '';
                const errorText = makeEl('div', { padding: '20px', textAlign: 'center', color: '#f44' });
                errorText.textContent = `Error loading diagrams: ${error.message}`;
                listContainer.appendChild(errorText);
            });
    }

    refresh();
    return overlay;
}

// Builds a single clickable diagram list item with rename and delete buttons.
function createDiagramItem(diagram, onSelect, onRename, onDelete) {
    const item = makeEl('div', {
        padding: '12px', marginBottom: '8px', backgroundColor: '#333',
        border: '1px solid #444', borderRadius: '4px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        transition: 'background-color 0.2s',
    });
    item.onmouseenter = () => { item.style.backgroundColor = '#444'; };
    item.onmouseleave = () => { item.style.backgroundColor = '#333'; };

    const info = makeEl('div', { flex: '1', cursor: 'pointer' });
    info.onclick = onSelect;

    const nameEl = makeEl('div', { fontSize: '16px', fontWeight: 'bold', marginBottom: '4px', color: '#fff' });
    nameEl.textContent = diagram.name;
    info.appendChild(nameEl);

    const metadata = makeEl('div', { fontSize: '12px', color: '#888' });
    metadata.innerHTML = `
        <div>Created: ${new Date(diagram.created_at).toLocaleString()}</div>
        <div>Updated: ${new Date(diagram.updated_at).toLocaleString()}</div>
    `;
    info.appendChild(metadata);
    item.appendChild(info);

    const btnBase = {
        marginLeft: '8px', padding: '4px', width: '30px', height: '30px',
        backgroundColor: 'transparent', border: '1px solid', borderRadius: '4px',
        cursor: 'pointer', fontSize: '14px', flexShrink: '0', transition: 'all 0.15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
    };

    const renameBtn = makeEl('button', { ...btnBase, borderColor: '#aaa' });
    const penImg = document.createElement('img');
    penImg.src = penIcon;
    penImg.style.cssText = 'width:14px;height:14px;display:block;filter:invert(1);opacity:0.7;';
    renameBtn.appendChild(penImg);
    renameBtn.onclick = (e) => { e.stopPropagation(); onRename(); };
    item.appendChild(renameBtn);

    const deleteBtn = makeEl('button', { ...btnBase, borderColor: '#f44', color: '#f44' });
    deleteBtn.textContent = '✕';
    let confirmTimer = null;
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirmTimer) {
            clearTimeout(confirmTimer);
            confirmTimer = null;
            onDelete();
        } else {
            deleteBtn.textContent = 'Sure?';
            deleteBtn.style.backgroundColor = '#c00';
            deleteBtn.style.color = '#fff';
            deleteBtn.style.borderColor = '#c00';
            confirmTimer = setTimeout(() => {
                confirmTimer = null;
                deleteBtn.textContent = '✕';
                deleteBtn.style.backgroundColor = 'transparent';
                deleteBtn.style.color = '#f44';
                deleteBtn.style.borderColor = '#f44';
            }, 3000);
        }
    };
    item.appendChild(deleteBtn);

    return item;
}

// Creates an element and applies a style object in one call.
function makeEl(tag, styles = {}) {
    const el = document.createElement(tag);
    Object.assign(el.style, styles);
    return el;
}
