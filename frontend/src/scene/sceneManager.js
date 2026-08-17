import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { DirectInteraction } from '../modes/DirectInteraction.js';
import { XRKeyboardManager } from '../managers/XRKeyboardManager.js';
import { OculusHandPointerModel } from 'three/addons/webxr/OculusHandPointerModel.js';
import { IndirectInteraction } from '../modes/IndirectInteraction.js';

// Manages the Three.js scene, camera, renderer, and XR session lifecycle.
export class SceneManager {
    constructor(container) {
        this.xrButton = null;

        this._initScene();
        this._initRenderer(container);
        this._initLights();
        this._initControls();
        this._initBoard();
        this._initHands();

        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.setupXRSession();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0);

        // Camera — positioned far back on Z so the 2D diagram is fully in view
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 10000);
        this.camera.position.set(0, 5, 700);
        this.camera.lookAt(0, 5, -5);
    }

    _initRenderer(container) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        this.renderer.xr.enabled = true;

        // Oculus Browser doesn't support WebGL2 XRWebGLBinding — disable it to avoid errors
        if (!/OculusBrowser/i.test(navigator.userAgent)) {
            window.XRWebGLBinding = undefined;
        }

        // Overlay div required for dom-overlay XR feature — allows HTML inputs
        // to be visible in XR and pre-populated by the Quest system keyboard.
        this._xrOverlay = document.createElement('div');
        this._xrOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(this._xrOverlay);

        // Add AR button if supported, otherwise fall back to VR
        if (navigator.xr) {
            const xrOpts = {
                optionalFeatures: ['hand-tracking', 'dom-overlay'],
                domOverlay: { root: this._xrOverlay },
            };
            navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
                if (supported) {
                    console.log("AR supported:", supported);
                    this.xrButton = ARButton.createButton(this.renderer, xrOpts);
                    document.body.appendChild(this.xrButton);
                } else {
                    console.log("AR not supported, adding VR button");
                    this.xrButton = VRButton.createButton(this.renderer, xrOpts);
                    document.body.appendChild(this.xrButton);
                }
            });
        }
    }

    _initLights() {
        this.scene.add(new THREE.HemisphereLight(0xcccccc, 0x999999, 3));

        this.dirLight = new THREE.DirectionalLight(0xffffff, 3);
        this.dirLight.position.set(0, 2, 4);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.camera.top = 2;
        this.dirLight.shadow.camera.bottom = -2;
        this.dirLight.shadow.camera.right = 2;
        this.dirLight.shadow.camera.left = -2;
        this.dirLight.shadow.mapSize.set(4096, 4096);
        this.scene.add(this.dirLight);
        this.scene.add(this.dirLight.target);
    }

    // Pan and zoom only (no rotation), left mouse = pan
    _initControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableRotate = false;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 300;
        this.controls.maxDistance = 5000;
        this.controls.autoRotate = false;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
        };
        this.controls.update();
    }

    // boardGroup holds the whiteboard plane, grid, and all diagram elements
    _initBoard() {
        this.boardGroup = new THREE.Group();

        const planeGeometry = new THREE.PlaneGeometry(8000, 8000);
        const planeMaterial = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.2 });
        this.plane = new THREE.Mesh(planeGeometry, planeMaterial);
        this.plane.position.set(0, 0, -49.9); // slightly in front of grid to avoid z-fighting
        this.plane.receiveShadow = true;
        this.plane.userData.isWhiteboard = true;
        this.boardGroup.add(this.plane);

        this.helper = new THREE.GridHelper(8000, 400);
        this.helper.position.set(0, 0, -50);
        this.helper.rotation.x = Math.PI / 2;
        this.helper.material.opacity = 0.25;
        this.helper.material.transparent = true;
        this.helper.userData.isWhiteboard = true;
        this.boardGroup.add(this.helper);

        this.scene.add(this.boardGroup);
    }

    // Register both hands and their pointer models for hand tracking
    _initHands() {
        this.keyboardManager = new XRKeyboardManager();

        this.hands = [];
        this.pointers = [];
        for (let i = 0; i < 2; i++) {
            const hand = this.renderer.xr.getHand(i);
            const controller = this.renderer.xr.getController(i);
            const pointer = new OculusHandPointerModel(hand, controller);
            hand.add(pointer);
            this.scene.add(hand);
            this.scene.add(controller);
            this.hands.push(hand);
            this.pointers.push(pointer);
        }
    }

    // Wired up after construction to avoid a circular dependency with DiagramManager
    setDiagramManager(diagramManager) {
        this.diagramManager = diagramManager;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Registers XR session start/end handlers and initialises interaction state
    setupXRSession() {
        this.directInteraction = null;
        this.indirectInteraction = null;
        this.interactionMode = 'indirect'; // default mode when entering XR
        this._firstXRFramePending = false;

        // Higher framebuffer resolution in XR — 1.5× reduces aliasing on Quest
        this.renderer.xr.setFramebufferScaleFactor(1.5);

        this.renderer.xr.addEventListener('sessionstart', () => {
            try {
                this.controls.enabled = false;
                this.keyboardManager.dispose();
                // Tighten clip planes for XR — objects are at most a few metres away.
                // The desktop range (0.02–10000) gives a 500 000:1 ratio which destroys
                // depth buffer precision and causes z-fighting / flickering in XR.
                this.camera.near = 0.02;
                this.camera.far  = 50;
                this.camera.updateProjectionMatrix();
                // Defer full XR setup to the render loop so the XR camera pose is ready
                this._firstXRFramePending = true;

                const session = this.renderer.xr.getSession();
                if (session) {
                    // Hide the canvas immediately on session end to avoid lagged transition during reload
                    session.addEventListener('end', () => {
                        this.renderer.domElement.style.visibility = 'hidden';
                        this.renderer.dispose();
                        setTimeout(() => window.location.reload(), 300);
                    });
                }
            } catch (e) {
                console.error('XR sessionstart setup failed:', e);
            }
        });
    }

    // Saves diagram state then ends the XR session 
    async exitXR() {
        if (this.diagramManager) this.diagramManager.history.save();

        const session = this.renderer.xr.getSession();
        if (session) {
            try {
                await session.end();
            } catch (e) {
                console.warn('Session already ending:', e);
            }
        }
    }

    // Places the indirect interaction panel in front of the user at a comfortable position.
    _positionIndirectPanel() {
        const xrCamera = this.renderer.xr.getCamera();
        const camPos = new THREE.Vector3().setFromMatrixPosition(xrCamera.matrixWorld);
        // Flatten to horizontal so looking down at a wrist button doesn't offset the panel downward
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCamera.quaternion);
        camDir.y = 0;
        camDir.normalize();
        const panelPos = camPos.clone().add(camDir.multiplyScalar(1.2));
        panelPos.y -= 0.95;
        this.indirectInteraction.panel.position.copy(panelPos);
        this.indirectInteraction.panel.lookAt(camPos);
        this.indirectInteraction.panel.scale.setScalar(1.0);
    }

    // Toggles between direct (hand) and indirect (panel) interaction modes
    switchInteractionMode() {
        if (this.interactionMode === 'direct') {
            this.directInteraction?.dispose();
            this.directInteraction = null;
            this.indirectInteraction = new IndirectInteraction(
                this.renderer, this.scene, this.boardGroup,
                this.diagramManager,
                this.hands,
                this.pointers,
                () => this.exitXR(),
                () => this.switchInteractionMode()
            );
            this._positionIndirectPanel();
            this.interactionMode = 'indirect';
            console.log('Switched to indirect interaction');
        } else {
            this.indirectInteraction?.dispose();
            this.indirectInteraction = null;
            this.directInteraction = new DirectInteraction(
                this.renderer, this.scene, this.boardGroup,
                this.diagramManager,
                this.hands,
                this.pointers,
                () => this.exitXR(),
                () => this.switchInteractionMode()
            );
            this.interactionMode = 'direct';
        }
    }

    // Called every frame. Runs XR initialisation once on the first XR frame,
    // when the camera pose is available (it isn't yet at sessionstart).
    initFirstXRFrame() {
        if (!this._firstXRFramePending) return;

        try {
            this._firstXRFramePending = false;

            const xrCamera = this.renderer.xr.getCamera();

            if (!this.indirectInteraction && this.diagramManager) {
                this.indirectInteraction = new IndirectInteraction(
                    this.renderer, this.scene, this.boardGroup,
                    this.diagramManager,
                    this.hands,
                    this.pointers,
                    () => this.exitXR(),
                    () => this.switchInteractionMode()
                );

                this._positionIndirectPanel();
            } else if (this.directInteraction) {
                this.directInteraction.reset();
            }

            // Remove desktop whiteboard visuals — not needed in XR
            if (this.plane) this.boardGroup.remove(this.plane);
            if (this.helper) this.boardGroup.remove(this.helper);
            this.scene.background = null;

            // Scale and position the boardGroup to appear 0.7m in front of the user, slightly below eye level
            const position = new THREE.Vector3().setFromMatrixPosition(xrCamera.matrixWorld);
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCamera.quaternion);
            direction.y = 0;
            direction.normalize();

            const distance = 0.7;
            const diagramPosition = position.clone().add(direction.clone().multiplyScalar(distance));
            diagramPosition.y -= 0.2;

            const desiredWidth = 5;
            const originalSize = 8000;
            const scale = desiredWidth / originalSize;

            this.boardGroup.position.copy(diagramPosition);
            this.boardGroup.scale.set(scale, scale, scale);

            // Aim directional light from the camera position toward the diagram
            this.dirLight.position.copy(position);
            this.dirLight.target.position.copy(diagramPosition);
            this.dirLight.target.updateMatrixWorld();

            const session = this.renderer.xr.getSession();
            if (session) this.keyboardManager.init(session, this._xrOverlay);

            console.log('XR session started');
        } catch (e) {
            console.error('XR pending setup failed:', e);
        }
    }

}


