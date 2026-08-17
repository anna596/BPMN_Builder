import * as THREE from 'three';
import deleteIcon from '../utils/images/delete.svg';
import labelIcon from '../utils/images/label.svg';
import rotateIcon from '../utils/images/rotate.svg';
import scaleIcon from '../utils/images/scale.svg';
import translateIcon from '../utils/images/translate.svg';
import saveIcon from '../utils/images/save.svg';
import backIcon from '../utils/images/back.svg';
import forwardIcon from '../utils/images/forward.svg';
import openIcon from '../utils/images/open.svg';
import downloadIcon from '../utils/images/download.svg';
import addIcon from '../utils/images/add.svg';
import loadDBIcon from '../utils/images/load_db.svg';  
import saveDBIcon from '../utils/images/save_db.svg';
import exitIcon from '../utils/images/exit.svg';
import arrow_down from '../utils/images/arrow_down.svg';
import arrow_left from '../utils/images/arrow_left.svg';
import arrow_right from '../utils/images/arrow_right.svg';
import arrow_up from '../utils/images/arrow_up.svg';
import select from '../utils/images/select.svg';
import direct from '../utils/images/direct.svg';
import indirect from '../utils/images/indirect.svg';
import rotate_left from '../utils/images/rotate_left.svg';
import rotate_right from '../utils/images/rotate_right.svg';
import rotate_up from '../utils/images/rotate_up.svg';
import rotate_down from '../utils/images/rotate_down.svg';
import rotate_cross_up from '../utils/images/rotate_cross_up.svg';
import rotate_cross_down from '../utils/images/rotate_cross_down.svg';
import plus from '../utils/images/plus.svg';
import minus from '../utils/images/minus.svg';
import translate_left from '../utils/images/translate_left.svg';
import translate_right from '../utils/images/translate_right.svg';
import translate_up from '../utils/images/translate_up.svg';
import translate_down from '../utils/images/translate_down.svg';
import translate_move_forward from '../utils/images/translate_move_forward.svg';
import translate_move_back from '../utils/images/translate_move_back.svg';
import view_back from '../utils/images/view_back.svg';
import new_diagram from '../utils/images/new_diagram.svg';
import close from '../utils/images/close.svg';


const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000});


// Factory for BPMN element meshes. 
export function createElement(type, options = {}) {
    const {position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]} = options;

    let element;
    
    switch(type) {
        case 'task':
            element = addTaskElement();
            break;
        case 'parallelGateway':
            element = addParallelGateway();
            break;
        case 'exclusiveGateway':
            element = addExclusiveGateway();
            break;
        case 'dataObject':
            element = addDataObjectElement();
            break;
        case 'startEvent':
            element = addStartEventElement();
            break;
        case 'intermediateEvent':
            element = addInterEventElement();
            break;
        case 'endEvent':
            element = addEndEventElement();
            break;
        default:
            console.warn("Unknown element type:", type);
            return null;
    }
    
    // Store the element type for serialization
    if (element) {
        element.userData.elementType = type;
        element.position.fromArray(position);
        element.rotation.fromArray(rotation);
        element.scale.fromArray(scale);
    }
    
    return element;
}

const TEXTURE_CONFIG = {
    size: 256,
    fillColor: 'white',
    strokeColor: 'black'
};

const LABEL_FONT        = '28px Arial';
const LABEL_LINE_HEIGHT = 36;
const LABEL_PADDING     = 28; // vertical whitespace added above/below the text block
const LABEL_DPR         = 2;  // canvas oversampling for sharper text

// Creates a canvas
// Physical canvas pixels = size * dpr; the ctx scale brings drawing coordinates
// back to logical pixels so all drawers can use the plain `size` value.
function createCanvas(size = TEXTURE_CONFIG.size) {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');

  ctx.scale(dpr, dpr);

  ctx.fillStyle = TEXTURE_CONFIG.fillColor;
  ctx.fillRect(0, 0, size, size);

  // Crisper joins/caps for shape strokes
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;

  return { canvas, ctx };
}


// strokeRatio is relative to radius so stroke thickness scales proportionally with circle size.
function drawCircle(ctx, centerX, centerY, radius, strokeRatio = 0.15) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    
    ctx.fillStyle = TEXTURE_CONFIG.fillColor;
    ctx.fill();
    
    
    ctx.lineWidth = strokeRatio * radius;
    ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
    ctx.stroke();
}

function drawDiamond(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.1);      
    ctx.lineTo(size * 0.9, size / 2);     
    ctx.lineTo(size / 2, size * 0.9);      
    ctx.lineTo(size * 0.1, size / 2);     
    ctx.closePath();
    
    ctx.lineWidth = size * 0.06;
    ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
    ctx.stroke();
}

function drawX(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(size * 0.4, size * 0.4);
    ctx.lineTo(size * 0.6, size * 0.6);
    ctx.moveTo(size * 0.6, size * 0.4);
    ctx.lineTo(size * 0.4, size * 0.6);
    
    ctx.lineWidth = size * 0.08;
    ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
    ctx.stroke();
}

function drawPlus(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.35);
    ctx.lineTo(size * 0.5, size * 0.65);
    ctx.moveTo(size * 0.65, size * 0.5);
    ctx.lineTo(size * 0.35, size * 0.5);
    
    ctx.lineWidth = size * 0.08;
    ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
    ctx.stroke();
}

function drawArrow(ctx, size) {
  const startX = size * 0.15;
  const endX = size * 0.85;
  const midY   = size * 0.5;

  const lineWidth  = size * 0.08;
  const headLength = size * 0.25;
  const headWidth  = headLength * 0.6;
  const baseX      = endX - headLength;

  // line
  ctx.beginPath();
  ctx.moveTo(startX, midY);
  ctx.lineTo(baseX, midY);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
  ctx.stroke();

  // head
  ctx.beginPath();
  ctx.moveTo(endX, midY);                // tip
  ctx.lineTo(baseX, midY - headWidth);   // base corner
  ctx.lineTo(baseX, midY + headWidth);   // base corner
  ctx.closePath();
  ctx.fillStyle = TEXTURE_CONFIG.strokeColor;
  ctx.fill();

}

function drawDataObject(ctx, size) {
    const width = size * 0.6;
    const height = size * 0.8;
    const foldSize = Math.min(width, height) * 0.2;

    const left = size * 0.25;
    const right = size * 0.75;
    const top = size * 0.2;
    const bottom = size * 0.8;

    
    // Main outline
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right - foldSize, top);
    ctx.lineTo(right, top + foldSize);
    ctx.lineTo(right, bottom);
    ctx.lineTo(left, bottom);
    ctx.closePath(); 

    ctx.lineWidth = size * 0.05;
    ctx.lineJoin = "round";
    ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
    ctx.stroke();

    // Fold triangle
    ctx.beginPath();
    ctx.moveTo(right - foldSize, top);
    ctx.lineTo(right - foldSize, top + foldSize);
    ctx.lineTo(right, top + foldSize);
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
    ctx.stroke();
}

// Per-type canvas draw functions, shared by createTexture (3D element faces)
// and createIconCanvas (UI panel icons) 
const textureDrawers = {
    task:(ctx, size) => {
        ctx.beginPath();
        ctx.moveTo(size * 0.2, size * 0.2);
        ctx.lineTo(size*0.8, size*0.2);
        ctx.lineTo(size*0.8, size*0.8);
        ctx.lineTo(size*0.2, size*0.8);
        ctx.closePath();

        ctx.lineWidth = size * 0.05;
        ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
        ctx.stroke();
    },

    arrow: (ctx, size) => {
        drawArrow(ctx, size);
    },

    association: (ctx, size) => {
        const startX = size * 0.15, endX = size * 0.85, midY = size * 0.5;
        const headLen = size * 0.2, headW = size * 0.12, lw = size * 0.07;
        // Dashed body
        ctx.setLineDash([size * 0.08, size * 0.05]);
        ctx.beginPath();
        ctx.moveTo(startX, midY);
        ctx.lineTo(endX - headLen, midY);
        ctx.lineWidth = lw;
        ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
        ctx.stroke();
        ctx.setLineDash([]);
        // Open arrowhead (V, not filled)
        ctx.beginPath();
        ctx.moveTo(endX - headLen, midY - headW);
        ctx.lineTo(endX, midY);
        ctx.lineTo(endX - headLen, midY + headW);
        ctx.lineWidth = lw;
        ctx.strokeStyle = TEXTURE_CONFIG.strokeColor;
        ctx.stroke();
    },

    startEvent: (ctx, size) => {
        const center = size / 2;
        const radius = size / 3;
        drawCircle(ctx, center, center, radius, 0.15);
    },
    
    endEvent: (ctx, size) => {
        const center = size / 2;
        const radius = size / 3;
        drawCircle(ctx, center, center, radius, 0.27);
    },
    
    intermediateEvent: (ctx, size) => {
        const center = size / 2;
        const outerRadius = size / 3;
        const innerRadius = size / 3.5;
        
        // outer circle
        drawCircle(ctx, center, center, outerRadius, 0.09);
        // inner circle
        drawCircle(ctx, center, center, innerRadius, 0.09);
    },
    
    exclusiveGateway: (ctx, size) => {
        drawDiamond(ctx, size);
        drawX(ctx, size);
    },
    
    parallelGateway: (ctx, size) => {
        drawDiamond(ctx, size);
        drawPlus(ctx, size);
    },

    dataObject: (ctx, size) => {
        drawDataObject(ctx, size);
    }

};

// Renders a BPMN symbol onto canvas and returns it as a Three.js texture.
// Used for all element types except task, which uses createTaskLabel for text rendering.
function createTexture(elementType) {
    const { canvas, ctx } = createCanvas();
    const size = TEXTURE_CONFIG.size;

    const drawer = textureDrawers[elementType];
    if (!drawer) {
        console.warn(`Unknown element type: ${elementType}`);
        return new THREE.CanvasTexture(canvas);
    }

    drawer(ctx, size);
    return new THREE.CanvasTexture(canvas);
}


// Task uses a canvas text texture instead of a vector symbol because it needs
// to display editable text on its face; all other elements use createTexture.
function addTaskElement() {
    const geometry = new THREE.BoxGeometry(100, 100, 100);

    const taskTexture = createTaskLabel("Task");
    const textMaterial = new THREE.MeshLambertMaterial({
        map: taskTexture,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });

    const task = new THREE.Mesh(geometry, textMaterial);
    task.castShadow = true;
    task.receiveShadow = true;
    task.name = "Task";
    task.userData.isTask = true;
    task.userData.isBPMNElement = true;
    task.userData.text = "Task";

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
    task.add(edges);

    return task;
}


// Creates a directed arrow between two BPMN elements. Arrow start/end are placed at the
// bounding-sphere edge of each element so the line never overlaps the shapes.
// Returns a connection record { source, target, arrow, label, group } used by DiagramState.
export function createArrow(source, target, parentGroup = null) {
    const actualSource = getActualElement(source);
    const actualTarget = getActualElement(target);

    // Get positions — in parent-local space if provided, otherwise world space
    const sourceCenter = new THREE.Vector3();
    const targetCenter = new THREE.Vector3();
    actualSource.getWorldPosition(sourceCenter);
    actualTarget.getWorldPosition(targetCenter);

    if (parentGroup) {
        parentGroup.worldToLocal(sourceCenter);
        parentGroup.worldToLocal(targetCenter);
    }

    const dir = new THREE.Vector3().subVectors(targetCenter, sourceCenter).normalize();

    // Get bounding boxes of objects to calculate edge positions
    const boxSource = new THREE.Box3().setFromObject(actualSource);
    const boxTarget = new THREE.Box3().setFromObject(actualTarget);
    const sourceSize = boxSource.getSize(new THREE.Vector3());
    const targetSize = boxTarget.getSize(new THREE.Vector3());

    if (parentGroup) {
        const scale = parentGroup.getWorldScale(new THREE.Vector3());
        sourceSize.divide(scale);
        targetSize.divide(scale);
    }

    // start/end points at edge of source/target
    const start = sourceCenter.clone().add(dir.clone().multiplyScalar(sourceSize.length() / 2));
    const end = targetCenter.clone().add(dir.clone().multiplyScalar(-targetSize.length() / 2));

    const length = start.distanceTo(end);

    // Position the arrow group at the midpoint
    const midPoint = start.clone().add(end).multiplyScalar(0.5);
    
    const arrowGroup = new THREE.Group();
    arrowGroup.position.copy(midPoint);
    arrowGroup.userData.isArrow = true; 
    
    // Create arrow relative to group position
    const arrow = new THREE.ArrowHelper(dir, start.clone().sub(midPoint), length, 0x000000, 20, 20);
    
    arrowGroup.add(arrow);

    // Invisible hit box for easier selection
    const hitBoxGeo = new THREE.BoxGeometry(length, 30, 30);
    const hitBoxMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
    hitBox.userData.isHitBox = true;

    // Position at arrow midpoint, rotated to align with arrow direction
    const localStart = start.clone().sub(midPoint);
    hitBox.position.copy(localStart.clone().add(dir.clone().multiplyScalar(length / 2)));
    hitBox.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);

    arrowGroup.add(hitBox);

    return {source: source, target: target, arrow: arrow, label: null, group: arrowGroup};
}

// When an element has a label it is wrapped in a labelGroup parent.
// Arrow attachment needs the inner mesh for an accurate bounding box, not the group.
function getActualElement(container) {
    if (container.userData.isBPMNElement && !container.userData.hasLabel) {
        return container;
    }

    if (container.userData.hasLabel && container.children) {
        for (const child of container.children) {
            if (child.userData.isBPMNElement || child.userData.isTask) {
                return child;
            }
        }
    }
    
    return container;
}

// Recalculates arrow geometry after a connected element is moved or scaled.
export function updateArrow(conn) {
    const { source, target, arrow, group } = conn;

    const parentGroup = group.parent;
    
    const actualSource = getActualElement(source);
    const actualTarget = getActualElement(target);

    const sourceCenter = new THREE.Vector3();
    const targetCenter = new THREE.Vector3();
    actualSource.getWorldPosition(sourceCenter);
    actualTarget.getWorldPosition(targetCenter);

    // If arrow is inside a scaled parent, compute in local space
    if (parentGroup) {
        parentGroup.worldToLocal(sourceCenter);
        parentGroup.worldToLocal(targetCenter);
    }

    const dir = new THREE.Vector3().subVectors(targetCenter, sourceCenter).normalize();

    const boxSource = new THREE.Box3().setFromObject(actualSource);
    const boxTarget = new THREE.Box3().setFromObject(actualTarget);

    const sourceSize = new THREE.Vector3();
    const targetSize = new THREE.Vector3();
    boxSource.getSize(sourceSize);
    boxTarget.getSize(targetSize);

    if (parentGroup) {
        const scale = parentGroup.getWorldScale(new THREE.Vector3());
        sourceSize.divide(scale);
        targetSize.divide(scale);
    }

    const start = sourceCenter.clone().add(dir.clone().multiplyScalar(sourceSize.length() / 2));
    const end = targetCenter.clone().add(dir.clone().multiplyScalar(-targetSize.length() / 2));
    
    const length = start.distanceTo(end);
    const midPoint = start.clone().add(end).multiplyScalar(0.5);
    
    // Update group position to midpoint
    group.position.copy(midPoint);
    
    // Update arrow relative to group position
    arrow.position.copy(start.clone().sub(midPoint));
    arrow.setDirection(dir);
    arrow.setLength(length, 20, 20);

    // Update hit box
    const hitBox = group.children.find(c => c.userData?.isHitBox);
    if (hitBox) {
        hitBox.geometry.dispose();
        hitBox.geometry = new THREE.BoxGeometry(length, 20, 20);
        const localStart = start.clone().sub(midPoint);
        hitBox.position.copy(localStart.clone().add(dir.clone().multiplyScalar(length / 2)));
        hitBox.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    }

    // Restore label to its stored offset if it exists
    if (conn.label && conn.label.userData?.offset) {
        conn.label.position.copy(conn.label.userData.offset);
    }

}

const HEAD_LEN = 20;
const HEAD_W   = 12;

function _computeConnectionEndpoints(source, target, parentGroup) {
    const actualSource = getActualElement(source);
    const actualTarget = getActualElement(target);

    const sourceCenter = new THREE.Vector3();
    const targetCenter = new THREE.Vector3();
    actualSource.getWorldPosition(sourceCenter);
    actualTarget.getWorldPosition(targetCenter);

    if (parentGroup) {
        parentGroup.worldToLocal(sourceCenter);
        parentGroup.worldToLocal(targetCenter);
    }

    const dir = new THREE.Vector3().subVectors(targetCenter, sourceCenter).normalize();

    const boxSource = new THREE.Box3().setFromObject(actualSource);
    const boxTarget = new THREE.Box3().setFromObject(actualTarget);
    const sourceSize = boxSource.getSize(new THREE.Vector3());
    const targetSize = boxTarget.getSize(new THREE.Vector3());

    if (parentGroup) {
        const scale = parentGroup.getWorldScale(new THREE.Vector3());
        sourceSize.divide(scale);
        targetSize.divide(scale);
    }

    const start = sourceCenter.clone().add(dir.clone().multiplyScalar(sourceSize.length() / 2));
    const end   = targetCenter.clone().add(dir.clone().multiplyScalar(-targetSize.length() / 2));
    const midPoint = start.clone().add(end).multiplyScalar(0.5);
    return { dir, start, end, midPoint };
}

function _buildAssociationHead(dir, localEnd) {
    const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
    const base = localEnd.clone().sub(dir.clone().multiplyScalar(HEAD_LEN));
    const left  = base.clone().add(perp.clone().multiplyScalar(HEAD_W));
    const right = base.clone().sub(perp.clone().multiplyScalar(HEAD_W));
    return [left, localEnd.clone(), right];
}

// Creates a dashed association arrow (open arrowhead, no filled cone).
export function createAssociationArrow(source, target, parentGroup = null) {
    const { dir, start, end, midPoint } = _computeConnectionEndpoints(source, target, parentGroup);
    const length = start.distanceTo(end);

    const localStart = start.clone().sub(midPoint);
    const localEnd   = end.clone().sub(midPoint);

    const arrowGroup = new THREE.Group();
    arrowGroup.position.copy(midPoint);
    arrowGroup.userData.isArrow = true;
    arrowGroup.userData.isAssociation = true;

    // Dashed body
    const bodyGeo = new THREE.BufferGeometry().setFromPoints([localStart, localEnd]);
    const bodyMat = new THREE.LineDashedMaterial({ color: 0x000000, dashSize: 8, gapSize: 5 });
    const bodyLine = new THREE.Line(bodyGeo, bodyMat);
    bodyLine.computeLineDistances();
    arrowGroup.add(bodyLine);
    arrowGroup.userData.bodyLine = bodyLine;

    // Open arrowhead
    const headPts = _buildAssociationHead(dir, localEnd);
    const headGeo = new THREE.BufferGeometry().setFromPoints(headPts);
    const headMat = new THREE.LineBasicMaterial({ color: 0x000000 });
    const headLine = new THREE.Line(headGeo, headMat);
    arrowGroup.add(headLine);
    arrowGroup.userData.headLine = headLine;

    // Invisible hitbox
    const hitBoxGeo = new THREE.BoxGeometry(length, 30, 30);
    const hitBox = new THREE.Mesh(hitBoxGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hitBox.userData.isHitBox = true;
    hitBox.position.copy(localStart.clone().add(dir.clone().multiplyScalar(length / 2)));
    hitBox.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    arrowGroup.add(hitBox);

    return { source, target, arrow: bodyLine, label: null, group: arrowGroup, type: 'association' };
}

// Recalculates association arrow geometry after a connected element is moved.
export function updateAssociationArrow(conn) {
    const { source, target, group } = conn;
    const parentGroup = group.parent;
    const { dir, start, end, midPoint } = _computeConnectionEndpoints(source, target, parentGroup);
    const length = start.distanceTo(end);

    group.position.copy(midPoint);

    const localStart = start.clone().sub(midPoint);
    const localEnd   = end.clone().sub(midPoint);

    const bodyLine = group.userData.bodyLine;
    if (bodyLine) {
        bodyLine.geometry.dispose();
        bodyLine.geometry = new THREE.BufferGeometry().setFromPoints([localStart, localEnd]);
        bodyLine.computeLineDistances();
    }

    const headLine = group.userData.headLine;
    if (headLine) {
        const headPts = _buildAssociationHead(dir, localEnd);
        headLine.geometry.dispose();
        headLine.geometry = new THREE.BufferGeometry().setFromPoints(headPts);
    }

    const hitBox = group.children.find(c => c.userData?.isHitBox);
    if (hitBox) {
        hitBox.geometry.dispose();
        hitBox.geometry = new THREE.BoxGeometry(length, 30, 30);
        hitBox.position.copy(localStart.clone().add(dir.clone().multiplyScalar(length / 2)));
        hitBox.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    }

    if (conn.label?.userData?.offset) {
        conn.label.position.copy(conn.label.userData.offset);
    }
}


function addStartEventElement() {
    const startTexture = createTexture('startEvent');
    const geometry = new THREE.BoxGeometry(60, 60, 60);
    const startMaterial = new THREE.MeshLambertMaterial({ map: startTexture });
    const startEvent = new THREE.Mesh(geometry, startMaterial);
    startEvent.castShadow = true;
    startEvent.receiveShadow = true;
    startEvent.name = "Start Event";
    startEvent.userData.isBPMNElement = true;
    return startEvent;
}

function addEndEventElement() {
    const endTexture = createTexture('endEvent');
    const geometry = new THREE.BoxGeometry(60, 60, 60);
    const endMaterial = new THREE.MeshLambertMaterial({ map: endTexture });
    const endEvent = new THREE.Mesh(geometry, endMaterial);
    endEvent.castShadow = true;
    endEvent.receiveShadow = true;
    endEvent.name = "End Event";
    endEvent.userData.isBPMNElement = true;
    return endEvent;
}

function addInterEventElement() {
    const interTexture = createTexture('intermediateEvent');
    const geometry = new THREE.BoxGeometry(60, 60, 60);
    const interMaterial = new THREE.MeshLambertMaterial({ map: interTexture });
    const interEvent = new THREE.Mesh(geometry, interMaterial);
    interEvent.castShadow = true;
    interEvent.receiveShadow = true;
    interEvent.name = "Intermediate Event";
    interEvent.userData.isBPMNElement = true;
    return interEvent;
}

function addExclusiveGateway() {
    const exclusiveTexture = createTexture('exclusiveGateway');
    const geometry = new THREE.BoxGeometry(60, 60, 60);
    const exclusiveMaterial = new THREE.MeshLambertMaterial({ map: exclusiveTexture });
    const exclusiveGateway = new THREE.Mesh(geometry, exclusiveMaterial);
    exclusiveGateway.castShadow = true;
    exclusiveGateway.receiveShadow = true;
    exclusiveGateway.name = "Exclusive Gateway";
    exclusiveGateway.userData.isBPMNElement = true;
    return exclusiveGateway;
}

function addParallelGateway() {
    const parallelTexture = createTexture('parallelGateway');
    const geometry = new THREE.BoxGeometry(60, 60, 60);
    const parallelMaterial = new THREE.MeshLambertMaterial({ map: parallelTexture });
    const parallelGateway = new THREE.Mesh(geometry, parallelMaterial);
    parallelGateway.castShadow = true;
    parallelGateway.receiveShadow = true;
    parallelGateway.name = "Parallel Gateway";
    parallelGateway.userData.isBPMNElement = true;
    return parallelGateway;
}

function addDataObjectElement() {
    const dataObjectTexture = createTexture('dataObject');
    const geometry = new THREE.BoxGeometry(80, 80, 80);
    const dataObjectMaterial = new THREE.MeshLambertMaterial({ map: dataObjectTexture });
    const dataObjectElement = new THREE.Mesh(geometry, dataObjectMaterial);
    dataObjectElement.castShadow = true;
    dataObjectElement.receiveShadow = true;
    dataObjectElement.name = "Data Object";
    dataObjectElement.userData.isBPMNElement = true;
    return dataObjectElement;
}

// Creates a box mesh with an icon texture for use as an XR button.
// BoxGeometry face order: right, left, top, bottom, front, back.
// Only the front and back faces show the icon; sides are plain white.
export function addXRButtonElement(x, y, z, type){
    const geometry = new THREE.BoxGeometry(x, y, z);
    const icon = new THREE.MeshBasicMaterial({ map: createIconTexture(type) });
    const side = new THREE.MeshBasicMaterial({ color: 0xffffff });
    return new THREE.Mesh(geometry, [side, side, side, side, icon, icon]);
}

// Splits text into lines that fit within maxWidth. The caller must set context.font
// before calling so measureText reflects the correct font metrics.
function wrapText(context, text, maxWidth) {
    const safe = typeof text === 'string' ? text : String(text ?? '');
    const words = safe.split(' ');

    if (words.length === 0) return [''];
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = context.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
        currentLine += " " + word;
        } else {
        lines.push(currentLine);
        currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

// Renders wrapped text onto a canvas sized to fit the content.
// Canvas is oversampled by LABEL_DPR for sharper text; callers use logicalWidth/logicalHeight for geometry.
function renderLabelCanvas(text, width = 200) {
    const safeText = typeof text === 'string' ? text : String(text ?? '');

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = LABEL_FONT; // must be set before wrapText so measureText is accurate

    let lines = wrapText(context, safeText, width);
    if (lines.length > 5) {
        lines = lines.slice(0, 5);
        lines[4] = lines[4].replace(/\.{0,3}$/, '…');
    }
    const totalHeight = LABEL_LINE_HEIGHT * lines.length + LABEL_PADDING;

    canvas.width  = Math.round(width       * LABEL_DPR);
    canvas.height = Math.round(totalHeight * LABEL_DPR);

    // canvas resize resets context state; scale first, then set font
    context.scale(LABEL_DPR, LABEL_DPR);
    context.font = LABEL_FONT;
    context.fillStyle = "white";
    context.fillRect(0, 0, width, totalHeight);
    context.fillStyle = "black";
    context.textAlign = "center";
    context.textBaseline = "middle";

    lines.forEach((line, index) => {
        const y = totalHeight / 2 + (index - (lines.length - 1) / 2) * LABEL_LINE_HEIGHT + 2;
        context.fillText(line, width / 2, y);
    });

    return { canvas, safeText, logicalWidth: width, logicalHeight: totalHeight };
}

// Creates a floating text label mesh. DoubleSide so the label is readable when
// viewed from behind in 3D. scale converts canvas pixels to scene units.
export function createLabel(text = " ", scale = 0.5, width = 200, elementId) {
    const { canvas, safeText, logicalWidth, logicalHeight } = renderLabelCanvas(text, width);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16;
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true
    });

    const label = new THREE.Mesh(new THREE.PlaneGeometry(logicalWidth, logicalHeight), material);
    label.userData.elementId = elementId;
    label.userData.text = safeText;
    label.userData.isLabel = true;
    label.scale.set(scale, scale, scale);
    return label;
}

// Replaces the label texture and geometry in-place so the plane always matches the canvas aspect ratio.
// Shifts the center down by half the height change so the top edge (gap to the parent element) stays fixed.
export function updateLabel(labelMesh, newText, width = 200) {
    const { canvas, safeText, logicalWidth, logicalHeight } = renderLabelCanvas(newText, width);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16;
    labelMesh.material.map.dispose();
    labelMesh.material.map = texture;
    labelMesh.material.needsUpdate = true;
    const oldHeight = labelMesh.geometry.parameters.height;
    labelMesh.geometry.dispose();
    labelMesh.geometry = new THREE.PlaneGeometry(logicalWidth, logicalHeight);
    labelMesh.position.y -= (logicalHeight - oldHeight) / 2 * labelMesh.scale.y;
    labelMesh.userData.offset = labelMesh.position.clone();
    labelMesh.userData.text = safeText;
}


// Renders task text onto a square canvas texture.
export function createTaskLabel(text, size = 1024){
    const safeText = typeof text === 'string' ? text : String(text ?? '');
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");

    const fontSize = 140;
    context.font = `${fontSize}px Arial`;
    const lineHeight = fontSize * 1.2;

    const maxWidth = size * 0.8;
    const lines = wrapText(context, safeText, maxWidth);
    const totalHeight = lineHeight * lines.length;

    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = 'black';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    lines.forEach((line, index) => {
        const y = (canvas.height - totalHeight) / 2 + lineHeight * (index + 0.5);
        context.fillText(line, canvas.width / 2, y);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16;
    return texture;
}

// Replaces the task face texture in-place. Old texture is disposed to free GPU memory.
export function updateTaskLabel(labelMesh, newText, size = 1024){
    const safeText = typeof newText === 'string' ? newText : String(newText ?? '');
    const newTexture = createTaskLabel(safeText, size);
    labelMesh.material.map.dispose();
    labelMesh.material.map = newTexture;
    labelMesh.material.needsUpdate = true;
    labelMesh.userData.text = safeText;
}

const iconPaths = {
    delete: deleteIcon,
    label: labelIcon,
    rotate: rotateIcon,
    scale: scaleIcon,
    translate: translateIcon,
    save: saveIcon,
    back: backIcon,
    forward: forwardIcon,
    open: openIcon,
    download: downloadIcon,
    add: addIcon, 
    load_db: loadDBIcon,
    save_db: saveDBIcon,
    exit: exitIcon,
    arrow_down: arrow_down,
    arrow_left: arrow_left,
    arrow_right: arrow_right,
    arrow_up: arrow_up,
    select: select,
    direct: direct,
    indirect: indirect,
    rotate_left: rotate_left,
    rotate_right: rotate_right,
    rotate_up: rotate_up,
    rotate_down: rotate_down,
    rotate_cross_up: rotate_cross_up,
    rotate_cross_down: rotate_cross_down,
    plus: plus,
    minus: minus,
    translate_move_back: translate_move_back,
    translate_move_forward: translate_move_forward,
    translate_left: translate_left,
    translate_right: translate_right,
    translate_up: translate_up,
    translate_down: translate_down,
    view_back: view_back,
    new_diagram: new_diagram,
    close: close
};

// Returns a canvas pre-filled with white plus an imgSrc path if the type is an SVG icon.
function createIconCanvas(elementType, size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);

    if (elementType in iconPaths) {
        return { canvas, ctx, imgSrc: iconPaths[elementType] };
    }

    const drawer = textureDrawers[elementType];
    if (drawer) drawer(ctx, size);

    return { canvas, ctx, imgSrc: null };
}


// Creates an <img> element for use in DOM UI panels.
export function createIcon(elementType, size = 32){
    const { canvas, imgSrc } = createIconCanvas(elementType, size);
    
    const icon = document.createElement('img');
    icon.width = size;
    icon.height = size;
    icon.alt = elementType;
    icon.style.backgroundColor = 'white';
    icon.style.padding = '4px';
    icon.src = imgSrc || canvas.toDataURL('image/png');
    
    return icon;
}

// Creates a Three.js texture for 3D XR buttons.
export function createIconTexture(elementType, size = 512) {
    const { canvas, ctx, imgSrc } = createIconCanvas(elementType, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 16;

    if (imgSrc) {
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, size, size);
            texture.needsUpdate = true;
        };
        img.src = imgSrc;
    }
    
    return texture;
}
