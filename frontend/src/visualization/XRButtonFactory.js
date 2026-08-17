import { addXRButtonElement } from '../diagram/ElementCreator.js';

// Shared helpers for creating and laying out XR buttons used by both direct and indirect interaction.

// Creates a single XR button mesh of the given type and wires up its click callback.
// Buttons are rendered on top of all geometry 
// so they stay visible even when partially occluded by scene objects.
export function makeButton(type, onClick, size = 0.08, depth = 0.02) {
    const btn = addXRButtonElement(size, size, depth, type);
    btn.userData.isXRButton = true;
    btn.userData.onClick = onClick;
    btn.renderOrder = 999;
    // Buttons must render on top of the panel background (renderOrder 998).
    // depthTest:false ensures they're never occluded by panel geometry.
    btn.traverse(child => {
        if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { m.depthTest = false; m.transparent = true; m.depthWrite = false; });
        }
    });
    return btn;
}

// Positions buttons in a grid and adds them to group.
// cols controls how many columns the grid has; rows defaults to whatever fits the button count.
// align controls the anchor point:
//   'center'      — group centered on centerPos (default)
//   'topLeft'     — top-left corner of the grid at centerPos
//   'leftCenter'  — left edge, vertically centered on centerPos (multi-column grids start at same x as single-column)
//   'columnWise'  — fills columns top-to-bottom before moving to the next column (default is row-wise)
export function layoutButtons(group, buttons, centerPos, cols = 1, rows = null, align = 'center', spacing = 0.12) {
    const actualRows = rows ?? Math.ceil(buttons.length / cols);
    const totalWidth  = (cols - 1) * spacing;
    const totalHeight = (actualRows - 1) * spacing;

    buttons.forEach((btn, i) => {
        // Determine grid position based on fill order
        let col, row;
        if (align === 'columnWise') {
            col = Math.floor(i / actualRows);
            row = i % actualRows;
        } else {
            col = i % cols;
            row = Math.floor(i / cols);
        }

        // Offset from the anchor point
        if (align === 'topLeft') {
            btn.position.set(col * spacing, -row * spacing, 0);
        } else if (align === 'leftCenter') {
            btn.position.set(col * spacing, totalHeight / 2 - row * spacing, 0);
        } else {
            btn.position.set(col * spacing - totalWidth / 2, totalHeight / 2 - row * spacing, 0);
        }
        group.add(btn);
    });

    group.position.copy(centerPos);
}
