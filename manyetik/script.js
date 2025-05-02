// --- START OF FILE script.js ---

document.addEventListener('DOMContentLoaded', () => {
    // --- Ensure THREE is loaded ---
    if (typeof THREE === 'undefined') {
        console.error("Three.js library not loaded. Check script tags.");
        alert("Error: Three.js library failed to load. Simulation cannot start.");
        return;
    }
     if (typeof THREE.OrbitControls === 'undefined') {
        console.warn("THREE.OrbitControls not loaded. 3D navigation will not work.");
    }

    // --- DOM Elements ---
    const canvas = document.getElementById('simulationCanvas');
    const ctx = canvas.getContext('2d');
    const simulation3DContainer = document.getElementById('simulation3DContainer');
    const chargeTypeSelect = document.getElementById('chargeType');
    const massSlider = document.getElementById('mass');
    const massValueSpan = document.getElementById('massValue');
    const initialVxSlider = document.getElementById('initialVx');
    const initialVxValueSpan = document.getElementById('initialVxValue');
    const initialVySlider = document.getElementById('initialVy');
    const initialVyValueSpan = document.getElementById('initialVyValue');
    const electricFieldXSlider = document.getElementById('electricFieldX');
    const electricFieldXValueSpan = document.getElementById('electricFieldXValue');
    const electricFieldYSlider = document.getElementById('electricFieldY');
    const electricFieldYValueSpan = document.getElementById('electricFieldYValue');
    const magneticFieldXSlider = document.getElementById('magneticFieldX');
    const magneticFieldXValueSpan = document.getElementById('magneticFieldXValue');
    const magneticFieldYSlider = document.getElementById('magneticFieldY');
    const magneticFieldYValueSpan = document.getElementById('magneticFieldYValue');
    const magneticFieldZSlider = document.getElementById('magneticFieldZ');
    const magneticFieldZValueSpan = document.getElementById('magneticFieldZValue');
    const magneticFrequencySlider = document.getElementById('magneticFrequency'); // YENİ
    const magneticFrequencyValueSpan = document.getElementById('magneticFrequencyValue'); // YENİ
    const startButton = document.getElementById('startButton');
    const resetButton = document.getElementById('resetButton');
    const clearTrailsButton = document.getElementById('clearTrailsButton');
    const resetFieldsButton = document.getElementById('resetFieldsButton');
    const trailLengthSlider = document.getElementById('trailLength');
    const trailLengthValueSpan = document.getElementById('trailLengthValue');
    const eFieldIndicator = document.getElementById('e-field-indicator').querySelector('span');
    const bFieldIndicator = document.getElementById('b-field-indicator').querySelector('span');
    const toggleViewButton = document.getElementById('toggleViewButton');
    const simulationWrapper = document.getElementById('simulationWrapper');

    // --- Simulation State ---
    let particles = [];
    let simulationRunning = false;
    let animationFrameId = null;
    let time = 0;
    const timeStep = 0.02; // Time step for physics updates
    let currentView = '2d';

    // --- Constants & Scaling ---
    const velocityScale = 0.1;
    const fieldScale = 0.2;
    const baseCharge = 1.0;
    const baseMass = 1.0;
    const worldScale = 50;
    const maxParticles = 5000;
    const visualSpeedFactor = 5.0;

    // --- Three.js Scene Variables ---
    let threeScene, threeCamera, threeRenderer, threeControls, threeAxesHelper, threeGridHelper;
    let particleInstancedMesh = null;
    const particleGeometry = new THREE.SphereGeometry(1, 8, 6);
    const particleMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
    const dummyObject = new THREE.Object3D();
    const reusableVec3 = new THREE.Vector3();
    const reusableMatrix = new THREE.Matrix4();
    let bFieldArrowsGroup = null;
    let lastBx = NaN; // Track last Bx amplitude/static value
    let lastBy = NaN; // Track last By amplitude/static value
    let lastFrequency = NaN; // YENİ: Track last frequency
    let threeInitialized = false;
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectionPointWorld = new THREE.Vector3();

    // --- Physics Functions ---

    // Calculates magnetic field at a given position and time.
    // If frequency is 0, returns static field based on sliders.
    // If frequency > 0, sliders define amplitude, and field oscillates.
    function calculateMagneticFieldVector(currentTime) {
        const Bx_amp = parseFloat(magneticFieldXSlider.value); // Amplitude from slider
        const By_amp = parseFloat(magneticFieldYSlider.value); // Amplitude from slider
        const Bz_amp = parseFloat(magneticFieldZSlider.value); // Amplitude from slider
        const frequency = parseFloat(magneticFrequencySlider.value);

        if (frequency <= 0) {
            // Static field if frequency is zero or negative
            return { x: Bx_amp, y: By_amp, z: Bz_amp };
        } else {
            // Time-varying field: B(t) = Amplitude * cos(2 * pi * f * t)
            const angularFrequency = 2 * Math.PI * frequency;
            const cosFactor = Math.cos(angularFrequency * currentTime);

            const instBx = Bx_amp * cosFactor;
            const instBy = By_amp * cosFactor;
            const instBz = Bz_amp * cosFactor;

            return { x: instBx, y: instBy, z: instBz };
        }
    }

    // Calculates Magnetic Force F = q(v x B) using the cross product.
    function applyRightHandRule(velX, velY, velZ, Bx, By, Bz, charge, targetForce) {
        targetForce.set(
            charge * (velY * Bz - velZ * By),      // Fx = q(vy*Bz - vz*By)
            charge * (velZ * Bx - velX * Bz),      // Fy = q(vz*Bx - vx*Bz)
            charge * (velX * By - velY * Bx)       // Fz = q(vx*By - vy*Bx)
        );
        return targetForce;
    }

    // --- Canvas Setup (2D) ---
    function resizeCanvas() {
        const containerRect = simulationWrapper.getBoundingClientRect();
        canvas.width = containerRect.width > 0 ? containerRect.width : 300;
        canvas.height = containerRect.height > 0 ? containerRect.height : 150;
        drawBackground();
        updateFieldIndicators();
    }

    // --- Particle Class ---
    class Particle {
         constructor(x, y, z, vx, vy_physics, vz, chargeType, mass) {
            this.id = Math.random().toString(36).substring(2, 15);
            this.x = x; this.y = y; this.z = z;
            this.vx = vx * velocityScale;
            this.vy = vy_physics * velocityScale; // Physics velocity Y (Up+)
            this.vz = vz * velocityScale;
            this.charge = chargeType * baseCharge;
            this.mass = Math.max(0.1, mass * baseMass);
            this.invMass = 1.0 / this.mass;
            this.baseRadius = 3 + Math.sqrt(this.mass);
            this.color = this.getColor(chargeType);
            this.threeColor = new THREE.Color(this.color);
            this.trail = [];
            this.maxTrailLength = parseInt(trailLengthSlider.value);
            this.remove = false;
            this.force = new THREE.Vector3();
            this.acceleration = new THREE.Vector3();
            this.velocity = new THREE.Vector3(this.vx, this.vy, this.vz);
            this.positionSim = new THREE.Vector3(this.x, this.y, this.z);
            this.positionWorld = new THREE.Vector3();
        }

        getColor(chargeType) {
            const styles = getComputedStyle(document.documentElement);
            if (chargeType > 0) return styles.getPropertyValue('--positive-color').trim();
            if (chargeType < 0) return styles.getPropertyValue('--negative-color').trim();
            return styles.getPropertyValue('--neutral-color').trim();
        }

        // Update particle state using physics laws
        // B is the INSTANTANEOUS magnetic field vector at the current time
        update(dt, Ex, Ey_physics, B) {
             if (this.remove) return;

             this.force.set(0, 0, 0);

            if (this.charge !== 0) {
                // --- Electric Force (F = qE) ---
                this.force.x += this.charge * Ex * fieldScale * 10;
                this.force.y += this.charge * Ey_physics * fieldScale * 10;

                // --- Magnetic Force (F = q(v x B)) ---
                applyRightHandRule(
                    this.velocity.x, this.velocity.y, this.velocity.z,
                    B.x, B.y, B.z, // Use instantaneous B field directly
                    this.charge, reusableVec3
                );
                this.force.addScaledVector(reusableVec3, fieldScale); // Apply B field scaling
            }

            // --- Update Kinematics ---
            this.acceleration.copy(this.force).multiplyScalar(this.invMass);
            this.velocity.addScaledVector(this.acceleration, dt);

            // --- Update Position ---
            this.x += this.velocity.x * dt * visualSpeedFactor;
            this.y -= this.velocity.y * dt * visualSpeedFactor; // Invert physics Y velocity for canvas Y
            this.z += this.velocity.z * dt * visualSpeedFactor;
            this.positionSim.set(this.x, this.y, this.z);

            // --- Update Trail ---
            this.trail.push({ x: this.x, y: this.y, z: this.z });
            if (this.trail.length > this.maxTrailLength) {
                this.trail.shift();
            }

            // --- Boundary Check ---
            const bounds = 1.5;
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            if (this.x < -canvasWidth * (bounds - 1) || this.x > canvasWidth * bounds ||
                this.y < -canvasHeight * (bounds - 1) || this.y > canvasHeight * bounds) {
                this.markForRemoval();
            }
        }

        draw2D(ctx) {
            if (this.remove) return;
            if (this.trail.length > 1) {
                ctx.beginPath();
                ctx.moveTo(this.trail[0].x, this.trail[0].y);
                for (let i = 1; i < this.trail.length; i++) {
                    ctx.lineTo(this.trail[i].x, this.trail[i].y);
                }
                ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--trail-color').trim();
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();
            if (this.charge !== 0) {
                ctx.fillStyle = 'white';
                ctx.font = `bold ${this.baseRadius * 1.2}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.charge > 0 ? '+' : '-', this.x, this.y + 1);
            }
        }

        markForRemoval() { this.remove = true; }

        updateTrailLength() {
            this.maxTrailLength = parseInt(trailLengthSlider.value);
            while (this.trail.length > this.maxTrailLength) { this.trail.shift(); }
        }

        clearTrail() {
            if (this.trail.length > 0) { this.trail = [this.trail[this.trail.length - 1]]; }
            else { this.trail = [{ x: this.x, y: this.y, z: this.z }]; }
        }

        update3DMatrix(canvasWidth, canvasHeight, targetMatrix) {
            const worldX = (this.x - canvasWidth / 2) / worldScale;
            const worldY = -(this.y - canvasHeight / 2) / worldScale;
            const worldZ = this.z / worldScale;
            const scale = (this.baseRadius / worldScale) * 2;
            this.positionWorld.set(worldX, worldY, worldZ);
            dummyObject.position.copy(this.positionWorld);
            dummyObject.scale.set(scale, scale, scale);
            dummyObject.updateMatrix();
            targetMatrix.copy(dummyObject.matrix);
        }
    }


    // --- Drawing Functions (2D) ---
    function drawBackground() {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawFieldVisuals2D();
    }

    function drawFieldVisuals2D() {
        if (currentView !== '2d') return;

        const Ex = parseFloat(electricFieldXSlider.value);
        const Ey_physics = parseFloat(electricFieldYSlider.value);
        // Note: B field visuals in 2D only show Bz static component for simplicity
        const Bz_static_or_amp = parseFloat(magneticFieldZSlider.value); // Show Z component amplitude/static value
        const frequency = parseFloat(magneticFrequencySlider.value);

        // Only draw Bz symbols if freq=0 (static) or if freq>0 and amplitude is non-zero
        // (Time-varying Bx, By are not easily visualized in 2D static background)
        const showBz = frequency <= 0 || Math.abs(Bz_static_or_amp) > 0.1;

        const Ey_canvas = -Ey_physics;
        const arrowSpacing = 50;
        const arrowLength = 15;
        ctx.lineWidth = 1;
        const fieldColorE = 'rgba(0, 0, 255, 0.3)';
        const fieldColorB = 'rgba(255, 0, 0, 0.4)';
        const fieldStrokeB = 'rgba(255, 0, 0, 0.6)';

        // Draw E-Field Arrows
        if (Math.abs(Ex) > 0.1 || Math.abs(Ey_canvas) > 0.1) {
            ctx.strokeStyle = fieldColorE;
             for (let x = arrowSpacing / 2; x < canvas.width; x += arrowSpacing) {
                for (let y = arrowSpacing / 2; y < canvas.height; y += arrowSpacing) {
                     drawArrow2D(ctx, x, y, Ex, Ey_canvas, arrowLength);
                }
            }
        }

         // Draw B-Field Symbols (Bz component)
         if (showBz && Math.abs(Bz_static_or_amp) > 0.1) {
             ctx.fillStyle = fieldColorB;
             ctx.strokeStyle = fieldStrokeB;
             ctx.lineWidth = 1.5;
             const radius = 3;

             for (let x = arrowSpacing / 2; x < canvas.width; x += arrowSpacing) {
                for (let y = arrowSpacing / 2; y < canvas.height; y += arrowSpacing) {
                     ctx.beginPath();
                     ctx.arc(x, y, radius, 0, Math.PI * 2);
                     ctx.stroke();
                    if (Bz_static_or_amp > 0) { // Positive Bz (Out) or positive amplitude
                        ctx.beginPath();
                        ctx.arc(x, y, radius / 3, 0, Math.PI * 2);
                        ctx.fill();
                    } else { // Negative Bz (In) or negative amplitude
                        ctx.beginPath();
                        ctx.moveTo(x - radius * 0.7, y - radius * 0.7); ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
                        ctx.moveTo(x - radius * 0.7, y + radius * 0.7); ctx.lineTo(x + radius * 0.7, y - radius * 0.7);
                        ctx.stroke();
                    }
                }
            }
        }
    }

    function drawArrow2D(ctx, x, y, dx, dy, baseLen) {
        const mag = Math.sqrt(dx*dx + dy*dy);
        if (mag < 0.01) return;
        const angle = Math.atan2(dy, dx);
        const arrowHeadSize = 5;
        const effectiveLen = Math.min(baseLen * (1 + mag * 0.1), baseLen * 1.5);
        const endX = x + Math.cos(angle) * effectiveLen;
        const endY = y + Math.sin(angle) * effectiveLen;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowHeadSize * Math.cos(angle - Math.PI / 6), endY - arrowHeadSize * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowHeadSize * Math.cos(angle + Math.PI / 6), endY - arrowHeadSize * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }

    // Updates the text indicators for E and B field strengths/amplitudes
     function updateFieldIndicators() {
         const Ex = parseFloat(electricFieldXSlider.value);
         const Ey_physics = parseFloat(electricFieldYSlider.value);
         const Bx_amp = parseFloat(magneticFieldXSlider.value); // Amplitude or Static Value
         const By_amp = parseFloat(magneticFieldYSlider.value); // Amplitude or Static Value
         const Bz_amp = parseFloat(magneticFieldZSlider.value); // Amplitude or Static Value
         const frequency = parseFloat(magneticFrequencySlider.value); // Current Frequency

         let eText = "Yok";
         let bText = "Yok";
         let bLabelPrefix = frequency > 0 ? "B Genliği" : "B Alanı"; // Adjust label based on frequency

         const eMag = Math.sqrt(Ex*Ex + Ey_physics*Ey_physics);
         const bMag_amp = Math.sqrt(Bx_amp*Bx_amp + By_amp*By_amp + Bz_amp*Bz_amp); // Magnitude of Amplitude/Static

         if (eMag > 0.01) {
             eText = `${eMag.toFixed(1)} E₀ (Ex:${Ex}, Ey:${Ey_physics})`;
         }
         if (bMag_amp > 0.01) {
             // Show Amplitude/Static components
             bText = `${bLabelPrefix}: ${bMag_amp.toFixed(1)} B₀ (Bx:${Bx_amp}, By:${By_amp}, Bz:${Bz_amp})`;
             if (frequency > 0) {
                 bText += ` | f: ${frequency.toFixed(2)} Hz`; // Add frequency if applicable
             }
         } else if (frequency > 0) {
             // Show frequency even if amplitude is 0
             bText = `${bLabelPrefix}: 0 B₀ | f: ${frequency.toFixed(2)} Hz`;
         }

         eFieldIndicator.textContent = eText;
         bFieldIndicator.textContent = bText;

         // --- 3D Field Arrow Update ---
         // Check if Bx/By amplitudes OR frequency changed significantly
         const freqChanged = frequency !== lastFrequency; // Use strict inequality for float comparison robustness here
         const bxAmplChanged = Bx_amp !== lastBx;
         const byAmplChanged = By_amp !== lastBy;

         // Update 3D visuals only if needed and in 3D view
         if (currentView === '3d' && threeInitialized && (bxAmplChanged || byAmplChanged || freqChanged)) {
              update3DFieldVisuals(Bx_amp, By_amp, frequency); // Pass frequency
              lastBx = Bx_amp; // Store amplitude/static value for next check
              lastBy = By_amp;
              lastFrequency = frequency; // Store frequency
         } else if (currentView === '2d') {
             // Redraw 2D background/visuals on any field slider change when in 2D view
             drawBackground();
         }
    }

    // --- Simulation Update Function ---
    function updateSimulation(dt) {
        if (!simulationRunning) return;

        const Ex = parseFloat(electricFieldXSlider.value);
        const Ey_physics = parseFloat(electricFieldYSlider.value);

        // Calculate INSTANTANEOUS B field using current simulation time
        const currentBField = calculateMagneticFieldVector(time); // Pass current time

        const particlesToRemoveIndexes = [];
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            // Pass physics Ey and the calculated instantaneous B field
            p.update(dt, Ex, Ey_physics, currentBField); // Pass instantaneous B
            if (p.remove) {
                particlesToRemoveIndexes.push(i);
            }
        }

        // Remove marked particles
        for (let i = particlesToRemoveIndexes.length - 1; i >= 0; i--) {
             particles.splice(particlesToRemoveIndexes[i], 1);
        }

        // Advance simulation time
        time += dt;
    }

    // --- Animation Loops ---
    function gameLoop2D() {
        updateSimulation(timeStep);
        drawBackground();
        for (let i = 0; i < particles.length; i++) {
            particles[i].draw2D(ctx);
        }
        if (simulationRunning && currentView === '2d') {
            animationFrameId = requestAnimationFrame(gameLoop2D);
        } else {
            animationFrameId = null;
        }
    }

    function animateThreeJS() {
        if (!simulationRunning || currentView !== '3d' || !threeInitialized) {
             animationFrameId = null; return;
        }
        updateSimulation(timeStep); // Update physics first
        if (particleInstancedMesh) {
            const canvasWidth = canvas.width; const canvasHeight = canvas.height;
            let numParticles = particles.length;
            if (numParticles > maxParticles) numParticles = maxParticles;
            const hasMatrixBuffer = particleInstancedMesh.instanceMatrix !== null;
            const hasColorBuffer = particleInstancedMesh.instanceColor !== null;
            if (!hasMatrixBuffer) { console.error("InstancedMesh missing instanceMatrix buffer!"); return; }
            for (let i = 0; i < numParticles; i++) {
                 const particle = particles[i];
                 particle.update3DMatrix(canvasWidth, canvasHeight, reusableMatrix);
                 particleInstancedMesh.setMatrixAt(i, reusableMatrix);
                 if (hasColorBuffer) particleInstancedMesh.setColorAt(i, particle.threeColor);
            }
            particleInstancedMesh.count = numParticles;
            particleInstancedMesh.instanceMatrix.needsUpdate = true;
            if (hasColorBuffer) particleInstancedMesh.instanceColor.needsUpdate = true;
            else if (numParticles > 0 && !animateThreeJS.colorWarningLogged) { console.warn("InstancedMesh instanceColor buffer missing..."); animateThreeJS.colorWarningLogged = true; }
        } else { console.warn("particleInstancedMesh is null"); }
        threeControls?.update(); // Update camera controls if they exist
        threeRenderer.render(threeScene, threeCamera);
        animationFrameId = requestAnimationFrame(animateThreeJS);
    }
    animateThreeJS.colorWarningLogged = false;


    // --- Three.js Initialization ---
    function initThreeJS() {
        if (threeInitialized) return; console.log("Initializing Three.js...");
        try {
            const containerRect = simulation3DContainer.getBoundingClientRect();
            const width = containerRect.width > 0 ? containerRect.width : 600; const height = containerRect.height > 0 ? containerRect.height : 400;
            threeScene = new THREE.Scene(); threeScene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim());
            threeCamera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000); threeCamera.position.set(0, worldScale * 0.3, worldScale * 0.7); threeCamera.up.set(0, 1, 0); threeCamera.lookAt(0, 0, 0);
            threeRenderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); threeRenderer.setSize(width, height); threeRenderer.setPixelRatio(window.devicePixelRatio * 0.9); simulation3DContainer.innerHTML = ''; simulation3DContainer.appendChild(threeRenderer.domElement);
            if (typeof THREE.OrbitControls !== 'undefined') { threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement); threeControls.enableDamping = true; threeControls.dampingFactor = 0.1; threeControls.screenSpacePanning = false; threeControls.target.set(0, 0, 0); threeControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; threeControls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }; } else { threeControls = null; }
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); threeScene.add(ambientLight); const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); directionalLight.position.set(5, 15, 10).normalize(); threeScene.add(directionalLight);
            threeAxesHelper = new THREE.AxesHelper(worldScale * 0.1); threeScene.add(threeAxesHelper); threeGridHelper = new THREE.GridHelper(worldScale * 1.2, 12, 0x888888, 0xcccccc); threeScene.add(threeGridHelper);
            particleInstancedMesh = new THREE.InstancedMesh(particleGeometry, particleMaterial, maxParticles); particleInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); if (particleInstancedMesh.instanceColor) { particleInstancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage); } else { console.error("InstancedMesh could not create instanceColor buffer."); } threeScene.add(particleInstancedMesh);
            bFieldArrowsGroup = new THREE.Group(); threeScene.add(bFieldArrowsGroup);
            // Initialize last values and draw initial arrows based on current settings
            const initialFrequency = parseFloat(magneticFrequencySlider.value);
            lastBx = parseFloat(magneticFieldXSlider.value);
            lastBy = parseFloat(magneticFieldYSlider.value);
            lastFrequency = initialFrequency;
            update3DFieldVisuals(lastBx, lastBy, initialFrequency); // Pass initial frequency

            threeInitialized = true; window.addEventListener('resize', onThreeResize, false); console.log("Three.js Initialized. Controls: Left=Pan, Right=Orbit, Wheel=Zoom.");
         } catch (error) { console.error("Error during Three.js initialization:", error); alert("Failed to initialize 3D view. Check console."); currentView = '2d'; simulationWrapper.classList.remove('view-3d'); simulationWrapper.classList.add('view-2d'); toggleViewButton.textContent = '3D Görünüme Geç'; threeInitialized = false; }
    }

     // Update Bx/By Field Arrows in 3D (Clears if frequency > 0)
     function update3DFieldVisuals(currentBxAmpl, currentByAmpl, currentFrequency) {
        if (!threeInitialized || !bFieldArrowsGroup) return;

        // Clear existing arrows first
        while (bFieldArrowsGroup.children.length > 0) {
            const child = bFieldArrowsGroup.children[0];
            bFieldArrowsGroup.remove(child);
            // Dispose geometry and material
            if (child instanceof THREE.ArrowHelper) {
                if (child.line && child.line.geometry) child.line.geometry.dispose();
                if (child.line && child.line.material) child.line.material.dispose();
                if (child.cone && child.cone.geometry) child.cone.geometry.dispose();
                if (child.cone && child.cone.material) child.cone.material.dispose();
            } else {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            }
        }

        // --- Only draw arrows if frequency is ZERO ---
        if (currentFrequency > 0) {
             if (!simulationRunning && threeRenderer) threeRenderer.render(threeScene, threeCamera); // Render cleared scene if paused
            return; // Do not draw arrows for time-varying fields
        }

        // --- Draw arrows based on AMPLITUDE if frequency is zero ---
        const magSq = currentBxAmpl * currentBxAmpl + currentByAmpl * currentByAmpl;
        if (magSq < 0.001) { // If amplitude/static field is near zero, don't draw
            if (!simulationRunning && threeRenderer) threeRenderer.render(threeScene, threeCamera);
            return;
        }

        // Arrow drawing logic (uses amplitudes/static values)
        const arrowColor = 0xff0000;
        const arrowLengthBase = worldScale * 0.05;
        const gridSpacing = worldScale * 0.3;
        const gridRange = worldScale * 0.6;
        const direction = reusableVec3.set(currentBxAmpl, currentByAmpl, 0).normalize();
        const magnitude = Math.sqrt(magSq);
        const arrowLength = arrowLengthBase * (1 + magnitude * 0.4);
        const headLength = Math.max(arrowLength * 0.3, worldScale * 0.015);
        const headWidth = Math.max(headLength * 0.7, worldScale * 0.01);

        for (let x = -gridRange; x <= gridRange; x += gridSpacing) {
            for (let z = -gridRange; z <= gridRange; z += gridSpacing) {
                const origin = new THREE.Vector3(x, 0, z);
                const arrowHelper = new THREE.ArrowHelper(direction, origin, arrowLength, arrowColor, headLength, headWidth);
                bFieldArrowsGroup.add(arrowHelper);
            }
        }

        // Render changes if simulation is paused
        if (!simulationRunning && threeRenderer) {
            threeRenderer.render(threeScene, threeCamera);
        }
    }

    // Handles window resize events for the 3D view
    function onThreeResize() {
        if (!threeInitialized || !threeRenderer) return; const containerRect = simulation3DContainer.getBoundingClientRect(); const width = containerRect.width; const height = containerRect.height; if (width <= 0 || height <= 0) return;
        threeCamera.aspect = width / height; threeCamera.updateProjectionMatrix(); threeRenderer.setSize(width, height); if (!simulationRunning) threeRenderer.render(threeScene, threeCamera);
    }

    // Stops the current animation loop
    function stopAnimation() { if (animationFrameId) cancelAnimationFrame(animationFrameId); animationFrameId = null; }

    // Starts the appropriate animation loop based on the current view
    function startAnimation() { stopAnimation(); if (simulationRunning) { if (currentView === '2d') { animationFrameId = requestAnimationFrame(gameLoop2D); } else if (currentView === '3d') { if (!threeInitialized) { requestAnimationFrame(() => { initThreeJS(); if (threeInitialized) { onThreeResize(); animationFrameId = requestAnimationFrame(animateThreeJS); } }); } else { onThreeResize(); animationFrameId = requestAnimationFrame(animateThreeJS); } } } }


    // --- Event Listeners ---

    massSlider.addEventListener('input', () => massValueSpan.textContent = massSlider.value);
    initialVxSlider.addEventListener('input', () => initialVxValueSpan.textContent = initialVxSlider.value);
    initialVySlider.addEventListener('input', () => initialVyValueSpan.textContent = initialVySlider.value);

    electricFieldXSlider.addEventListener('input', () => { electricFieldXValueSpan.textContent = electricFieldXSlider.value; updateFieldIndicators(); });
    electricFieldYSlider.addEventListener('input', () => { electricFieldYValueSpan.textContent = electricFieldYSlider.value; updateFieldIndicators(); });
    magneticFieldXSlider.addEventListener('input', () => { magneticFieldXValueSpan.textContent = magneticFieldXSlider.value; updateFieldIndicators(); });
    magneticFieldYSlider.addEventListener('input', () => { magneticFieldYValueSpan.textContent = magneticFieldYSlider.value; updateFieldIndicators(); });
    magneticFieldZSlider.addEventListener('input', () => { magneticFieldZValueSpan.textContent = magneticFieldZSlider.value; updateFieldIndicators(); });
    magneticFrequencySlider.addEventListener('input', () => { magneticFrequencyValueSpan.textContent = magneticFrequencySlider.value; updateFieldIndicators(); }); // YENİ

    trailLengthSlider.addEventListener('input', () => {
        trailLengthValueSpan.textContent = trailLengthSlider.value;
        particles.forEach(p => p.updateTrailLength());
    });

    simulationWrapper.addEventListener('click', (event) => {
        if(particles.length >= maxParticles) { console.warn(`Max particle limit (${maxParticles}) reached.`); return; }
        let particleStartX, particleStartY, particleStartZ;
        if (currentView === '2d') {
            const rect = canvas.getBoundingClientRect();
            particleStartX = event.clientX - rect.left;
            particleStartY = event.clientY - rect.top;
            particleStartZ = 0;
        }
        else if (currentView === '3d' && threeInitialized) {
            const rect = simulation3DContainer.getBoundingClientRect();
            const mouseX = event.clientX - rect.left; const mouseY = event.clientY - rect.top;
            mouseNDC.x = (mouseX / rect.width) * 2 - 1; mouseNDC.y = -(mouseY / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouseNDC, threeCamera);
            if (raycaster.ray.intersectPlane(groundPlane, intersectionPointWorld)) {
                const currentCanvasWidth = canvas.width; const currentCanvasHeight = canvas.height;
                particleStartX = intersectionPointWorld.x * worldScale + currentCanvasWidth / 2;
                particleStartY = -intersectionPointWorld.y * worldScale + currentCanvasHeight / 2;
                particleStartZ = intersectionPointWorld.z * worldScale;
            } else {
                console.warn("3D click ray did not intersect the ground plane.");
                particleStartX = canvas.width / 2; particleStartY = canvas.height / 2; particleStartZ = 0;
            }
        }
        else { return; }

        const chargeType = parseInt(chargeTypeSelect.value);
        const mass = parseFloat(massSlider.value);
        const vx_input = parseFloat(initialVxSlider.value);
        const vy_input = parseFloat(initialVySlider.value); // Physics Vy (Up+/Down-)
        const vz_input = 0;
        const initialPhysicsVy = vy_input;

        const newParticle = new Particle(particleStartX, particleStartY, particleStartZ, vx_input, initialPhysicsVy, vz_input, chargeType, mass);
        particles.push(newParticle);

        if (!simulationRunning) {
            if (currentView === '2d') {
                drawBackground(); particles.forEach(p => p.draw2D(ctx));
            } else if (threeInitialized) {
                updateSimulation(0); animateThreeJS(); stopAnimation();
            }
        }
    });

    startButton.addEventListener('click', () => { simulationRunning = !simulationRunning; startButton.textContent = simulationRunning ? 'Duraklat' : 'Başlat'; if (simulationRunning) startAnimation(); else stopAnimation(); });

    resetButton.addEventListener('click', () => {
        simulationRunning = false;
        startButton.textContent = 'Başlat';
        stopAnimation();
        particles = [];
        time = 0;
        // Reset frequency slider and tracker
        magneticFrequencySlider.value = 0;
        magneticFrequencyValueSpan.textContent = '0';
        lastFrequency = NaN;
        // Reset Bx/By amplitude trackers
        lastBx = NaN;
        lastBy = NaN;
        // Redraw/update indicators and visuals
        drawBackground();
        updateFieldIndicators(); // Update indicators immediately
        if (currentView === '3d' && threeInitialized) {
            if (particleInstancedMesh) {
                particleInstancedMesh.count = 0;
                particleInstancedMesh.instanceMatrix.needsUpdate = true;
                if (particleInstancedMesh.instanceColor) particleInstancedMesh.instanceColor.needsUpdate = true;
            }
            // update3DFieldVisuals is implicitly called by updateFieldIndicators if needed
            if(threeRenderer) threeRenderer.render(threeScene, threeCamera); // Render the empty scene
        }
    });

    clearTrailsButton.addEventListener('click', () => {
        particles.forEach(p => p.clearTrail());
        if (!simulationRunning && currentView === '2d') {
            drawBackground(); particles.forEach(p => p.draw2D(ctx));
        }
        // Note: No immediate redraw needed for 3D trails as they are not stored visually
    });

    resetFieldsButton.addEventListener('click', () => {
        electricFieldXSlider.value = 0; electricFieldYSlider.value = 0;
        magneticFieldXSlider.value = 0; magneticFieldYSlider.value = 0; magneticFieldZSlider.value = 0;
        magneticFrequencySlider.value = 0; // Reset frequency slider

        // Dispatch input events to trigger updates (including updateFieldIndicators)
        electricFieldXSlider.dispatchEvent(new Event('input'));
        electricFieldYSlider.dispatchEvent(new Event('input'));
        magneticFieldXSlider.dispatchEvent(new Event('input'));
        magneticFieldYSlider.dispatchEvent(new Event('input'));
        magneticFieldZSlider.dispatchEvent(new Event('input'));
        magneticFrequencySlider.dispatchEvent(new Event('input')); // Dispatch event for frequency
    });

    toggleViewButton.addEventListener('click', () => {
        const wasRunning = simulationRunning; if (simulationRunning) { stopAnimation(); simulationRunning = false; startButton.textContent = 'Başlat'; }
        if (currentView === '2d') {
            currentView = '3d'; simulationWrapper.classList.remove('view-2d'); simulationWrapper.classList.add('view-3d'); toggleViewButton.textContent = '2D Görünüme Geç';
            requestAnimationFrame(() => { // Ensure DOM update happens before init/resize
                if (!threeInitialized) initThreeJS(); else onThreeResize();
                if (threeInitialized) {
                    // Force update of field indicators & 3D arrows after view switch
                    lastBx = NaN; lastBy = NaN; lastFrequency = NaN; // Force redraw
                    updateFieldIndicators();
                    updateSimulation(0); // Update particle matrices based on current state
                    animateThreeJS();    // Render one frame
                    stopAnimation();     // Stop if it wasn't running
                    if (wasRunning) { simulationRunning = true; startButton.textContent = 'Duraklat'; startAnimation(); }
                } else { // Fallback if init failed
                    currentView = '2d'; simulationWrapper.classList.add('view-2d'); simulationWrapper.classList.remove('view-3d'); toggleViewButton.textContent = '3D Görünüme Geç';
                    if (wasRunning) { simulationRunning = true; startButton.textContent = 'Duraklat'; startAnimation(); }
                }
            });
        }
        else { // Switching to 2D
            currentView = '2d'; simulationWrapper.classList.remove('view-3d'); simulationWrapper.classList.add('view-2d'); toggleViewButton.textContent = '3D Görünüme Geç';
            resizeCanvas(); // Resize canvas and redraw background/fields
            particles.forEach(p => p.draw2D(ctx)); // Draw particles in their current state
            if (wasRunning) { simulationRunning = true; startButton.textContent = 'Duraklat'; startAnimation(); }
        }
    });

    window.addEventListener('resize', () => { if (currentView === '2d') { resizeCanvas(); if (!simulationRunning) { particles.forEach(p => p.draw2D(ctx)); } } else if (threeInitialized) { onThreeResize(); } });

    // --- Initial Setup ---
    resizeCanvas(); // Initial canvas setup and drawing
    updateFieldIndicators(); // Initial field indicator text
    startButton.textContent = 'Başlat';

}); // End DOMContentLoaded

// --- END OF FILE script.js ---
