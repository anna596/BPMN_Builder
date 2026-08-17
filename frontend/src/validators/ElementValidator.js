// Read-only helpers for classifying Three.js scene objects by their userData flags.
export class ElementValidator {
    static isValidBPMNElement(obj) {
        return obj?.userData?.isBPMNElement === true;
    }

    static isArrow(obj) {
        return obj?.userData?.isArrow === true;
    }

    static isLabel(obj) {
        return obj?.userData?.isLabel === true;
    }

    static isTask(obj) {
        return obj?.userData?.isTask === true;
    }

    static hasLabel(obj) {
        return obj?.userData?.hasLabel === true;
    }

    static canAddLabelToElement(obj) {
        return this.isValidBPMNElement(obj) && 
               !this.hasLabel(obj) && 
               !this.isTask(obj);
    }

    static canAddLabelToArrow(arrow) {
        return arrow?.userData?.isArrow && !arrow?.userData?.hasLabel;
    }

    static canDelete(obj) {
        return this.isValidBPMNElement(obj) || this.isArrow(obj) || this.isLabel(obj);
    }
}