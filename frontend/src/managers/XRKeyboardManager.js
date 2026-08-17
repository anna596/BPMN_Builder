import { updateLabel, updateTaskLabel } from '../diagram/ElementCreator.js';

// Manages system keyboard input for XR label editing.
// Requires dom-overlay to be active in the XR session so the input element is
// rendered as 2D HTML over the 3D scene. With dom-overlay, Quest reads the
// input's .value when the keyboard opens, allowing pre-population of existing text.
// Without dom-overlay the keyboard always opens empty.
export class XRKeyboardManager {
    constructor() {
        this.textField = null;
        this._inputBar = null;
        this._doneBtn = null;
        this.currentLabel = null;
        this.currentElement = null;
        this.isSupported = false;
        this.onComplete = null;
        this.onLabelUpdated = null;
        this._openText = null;
        this._lastTypedValue = null;
        this._ignoreBlur = false; // true for ~1s after open to swallow the spurious Quest blur
    }

    // Initialize the keyboard manager when XR session starts.
    // overlayElement should be the dom-overlay root so the input is visible
    // in the XR view, allowing Quest to pre-populate the keyboard with existing text.
    init(session, overlayElement) {
        if (!session) return false;
        if (this.textField) this.dispose();

        this.isSupported = session.isSystemKeyboardSupported ?? false;

        if (!this.isSupported) {
            console.warn('System keyboard not supported on this device');
        }

        // Wrapper bar shown at screen-bottom while keyboard is active
        this._inputBar = document.createElement('div');
        this._inputBar.style.cssText = [
            'display:none',
            'position:absolute',
            'bottom:5%',
            'left:10%',
            'right:10%',
            'background:rgba(0,0,0,0.75)',
            'border-radius:10px',
            'padding:10px 14px',
            'pointer-events:auto',
            'display:none',
            'flex-direction:row',
            'align-items:center',
            'gap:10px',
        ].join(';');

        this.textField = document.createElement('input');
        this.textField.type = 'text';
        this.textField.maxLength = 200;
        this.textField.style.cssText = [
            'flex:1',
            'font-size:20px',
            'background:transparent',
            'color:#fff',
            'border:1px solid rgba(255,255,255,0.5)',
            'border-radius:6px',
            'padding:6px 10px',
            'outline:none',
            'box-sizing:border-box',
        ].join(';');

        this._doneBtn = document.createElement('button');
        this._doneBtn.textContent = 'Done';
        this._doneBtn.style.cssText = [
            'padding:6px 16px',
            'font-size:18px',
            'background:#fff',
            'color:#000',
            'border:none',
            'border-radius:6px',
            'cursor:pointer',
            'flex-shrink:0',
        ].join(';');
        this._doneBtn.onclick = () => {
            // Capture value immediately before Quest potentially clears it on blur
            const val = this.textField.value.trim();
            if (val) this._lastTypedValue = val;
            this._finishEditing();
        };

        this._inputBar.appendChild(this.textField);
        this._inputBar.appendChild(this._doneBtn);

        const root = overlayElement ?? document.body;
        root.appendChild(this._inputBar);

        this.textField.oninput   = () => { this._updateCurrentLabel(); };
        this.textField.onchange  = () => {
            const val = this.textField.value.trim();
            if (val) this._lastTypedValue = val;
        };
        this.textField.onkeydown = (e) => { if (e.key === 'Enter') this._finishEditing(); };
        // onblur: Quest keyboard fires a spurious blur right after open, so we ignore
        // blurs within 1.5s of opening. The intentional blur when the Quest keyboard
        // closes (user taps its Done/checkmark) fires later and triggers _finishEditing.
        this.textField.onblur = () => {
            if (this._ignoreBlur) return;
            const val = this.textField.value.trim();
            if (val) this._lastTypedValue = val;
            this._finishEditing();
        };

        console.log('XR Keyboard Manager initialized, supported:', this.isSupported);
    }

    // Open keyboard to edit a label.
    openForLabel(label, element, onComplete) {
        if (!this.textField) { console.warn('Keyboard manager not initialized'); return false; }

        this.currentLabel = label;
        this.currentElement = element;
        this.onComplete = onComplete;
        this._openText = label?.userData?.text?.trim() || element?.userData?.text?.trim() || '';
        this._lastTypedValue = null;

        this._prefillAndOpen(this._openText);
        return true;
    }

    // Open keyboard to edit a task's text directly.
    openForTask(task, onComplete) {
        if (!this.textField) { console.warn('Keyboard manager not initialized'); return false; }

        this.currentLabel = null;
        this.currentElement = task;
        this.onComplete = onComplete;
        this._openText = task?.userData?.text?.trim() || '';
        this._lastTypedValue = null;

        this._prefillAndOpen(this._openText);
        return true;
    }

    // Opens the keyboard for free-text input (no label mesh required).
    // onComplete(text) is called when the user dismisses the keyboard.
    promptText(defaultValue, onComplete) {
        if (!this.textField) { console.warn('Keyboard manager not initialized'); return false; }
        this.currentLabel = null;
        this.currentElement = null;
        this.onComplete = onComplete;
        this._openText = defaultValue || '';
        this._lastTypedValue = null;

        this._prefillAndOpen(this._openText);
        return true;
    }

    // Shows the input bar, pre-fills it with text, and opens the system keyboard.
    // requestAnimationFrame defers focus() by one frame so the DOM settles and
    // Quest reads the correct value when the keyboard opens.
    _prefillAndOpen(text) {
        this._ignoreBlur = true;
        this._inputBar.style.display = 'flex';
        this.textField.value = text;
        this.textField.focus();
        try { this.textField.setSelectionRange(text.length, text.length); } catch (_) {}
        setTimeout(() => { this._ignoreBlur = false; }, 1500);
    }

    // Live-update the label as the user types so they see their input in the scene.
    _updateCurrentLabel() {
        const newText = this.textField.value || '';
        if (!newText) return; // ignore empty — Quest clears field on open/close
        if (newText === this._openText) return; // unchanged — keyboard hasn't been used yet

        this._lastTypedValue = newText; // persist before Quest potentially clears the field

        if (this.currentLabel) {
            updateLabel(this.currentLabel, newText);
            this.onLabelUpdated?.(this.currentLabel);
        } else if (this.currentElement?.userData?.isTask) {
            updateTaskLabel(this.currentElement, newText);
        }
    }

    // Called when editing is complete (Done button or Enter key).
    _finishEditing() {
        if (!this.currentLabel && !this.currentElement && !this.onComplete) return;

        this._inputBar.style.display = 'none';

        // Quest clears the field when the keyboard closes — use the last typed value
        // as fallback, then the original text, so neither labels nor names are lost.
        const finalText = this.textField.value.trim() || this._lastTypedValue || this._openText || '';

        // Ensure the 3D label reflects the final text
        if (this.currentLabel) {
            updateLabel(this.currentLabel, finalText);
            this.onLabelUpdated?.(this.currentLabel);
        } else if (this.currentElement?.userData?.isTask) {
            updateTaskLabel(this.currentElement, finalText);
        }

        if (this.onComplete) this.onComplete(finalText);

        this.currentLabel = null;
        this.currentElement = null;
        this.onComplete = null;
        this.onLabelUpdated = null;
        this._openText = null;
        this._lastTypedValue = null;
    }

    get supported() { return this.isSupported; }

    dispose() {
        if (this._inputBar) {
            this._inputBar.remove();
            this._inputBar = null;
        }
        this.textField = null;
        this._doneBtn = null;
        this.currentLabel = null;
        this.currentElement = null;
        this.onComplete = null;
        this.onLabelUpdated = null;
        this._openText = null;
    }
}
