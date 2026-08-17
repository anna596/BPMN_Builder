// Make a UI panel draggable by a handle element
export function makeDraggable(panel, handle) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.style.cursor = 'move';
    panel.style.position = 'absolute';

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - panel.offsetLeft;
        offsetY = e.clientY - panel.offsetTop;
        handle.style.cursor = 'grabbing';
        e.preventDefault(); // Prevent text selection
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - panel.offsetWidth));
            const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - panel.offsetHeight));
            panel.style.left = `${x}px`;
            panel.style.top = `${y}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            handle.style.cursor = 'move';
        }
    });
}