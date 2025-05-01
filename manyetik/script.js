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
    const initialVySlider = document.getElementById('initialVy'); // Label now implies +Y = Up
    const initialVyValueSpan = document.getElementById('initialVyValue');
    const electricFieldXSlider = document.getElementById('electricFieldX');
    const electricFieldXValueSpan = document.getElementById('electricFieldXValue');
    const electricFieldYSlider = document.getElementById('electricFieldY'); // Label now implies +Y = Up
    const electricFieldYValueSpan = document.getElementById('electricFieldYValue');
    const magneticFieldXSlider = document.getElementById('magneticFieldX');
    const magneticFieldXValueSpan = document.getElementById('magneticFieldXValue');
    const magneticFieldYSlider = document.getElementById('magneticFieldY');
    const magneticFieldYValueSpan = document.getElementById('magneticFieldYValue');
    const magneticFieldZSlider = document.getElementById('magneticFieldZ');
    const magneticFieldZValueSpan = document.getElementById('magneticFieldZValue');
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
    const velocityScale = 0.1; // Scales slider input to internal velocity units
    const fieldScale = 0.2;    // Scales slider input to internal field strength
    const baseCharge = 1.0;    // Base charge unit
    const baseMass = 1.0;      // Base mass unit
    const worldScale = 50;     // Relates simulation/canvas units to 3D world units
    const maxParticles = 5000; // Max particles for InstancedMesh
    const visualSpeedFactor = 5.0; // Multiplier for visual movement speed

    // --- Three.js Scene Variables ---
    let threeScene, threeCamera, threeRenderer, threeControls, threeAxesHelper, threeGridHelper;
    let particleInstancedMesh = null;
    const particleGeometry = new THREE.SphereGeometry(1, 8, 6); // Low-poly sphere for performance
    const particleMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
    const dummyObject = new THREE.Object3D(); // Reusable object for setting instance matrices
    const reusableVec3 = new THREE.Vector3(); // Reusable vector for calculations
    const reusableMatrix = new THREE.Matrix4(); // Reusable matrix for instance updates
    let bFieldArrowsGroup = null; // Group to hold magnetic field arrows
    let lastBx = NaN; // Track last Bx/By to redraw arrows only when needed
    let lastBy = NaN;
    let threeInitialized = false;
    // Variables for Raycasting (adding particles in 3D)
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2(); // Mouse position in Normalized Device Coordinates
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Plane at Y=0 for clicking
    const intersectionPointWorld = new THREE.Vector3(); // Stores click intersection point

    // --- Physics Placeholder Functions ---
    // Calculates magnetic field at a given position (currently uniform)
    function calculateMagneticFieldVector(position) {
        // TODO: Implement non-uniform field formula from PDF here if needed.
        // Currently uses uniform field based on sliders.
        const Bx = parseFloat(magneticFieldXSlider.value); // Physics Bx (Right+/Left-)
        const By = parseFloat(magneticFieldYSlider.value); // Physics By (Up+/Down-)
        const Bz = parseFloat(magneticFieldZSlider.value); // Physics Bz (Out+/In-)
        return { x: Bx, y: By, z: Bz };
    }

    // Calculates Magnetic Force F = q(v x B) using the cross product.
    // Inputs: velocity components (velX, velY, velZ)
    //         magnetic field components (Bx, By, Bz)
    //         charge
    // Output: Stores the calculated force vector in targetForce (THREE.Vector3)
    // Note: Assumes inputs are in consistent physics coordinate system (+Y Up, +Z Out)
    function applyRightHandRule(velX, velY, velZ, Bx, By, Bz, charge, targetForce) {
        targetForce.set(
            charge * (velY * Bz - velZ * By),      // Fx = q(vy*Bz - vz*By)
            charge * (velZ * Bx - velX * Bz),      // Fy = q(vz*Bx - vx*Bz)
            charge * (velX * By - velY * Bx)       // Fz = q(vx*By - vy*Bx)
        );
        return targetForce; // Return for chaining if needed, but modifies targetForce directly
    }

    // --- Canvas Setup (2D) ---
    function resizeCanvas() {
        const containerRect = simulationWrapper.getBoundingClientRect();
        // Ensure minimum dimensions to prevent errors
        canvas.width = containerRect.width > 0 ? containerRect.width : 300;
        canvas.height = containerRect.height > 0 ? containerRect.height : 150;
        drawBackground(); // Redraw background and field visuals after resize
        updateFieldIndicators();
    }

    // --- Particle Class ---
    class Particle {
         constructor(x, y, z, vx, vy_physics, vz, chargeType, mass) { // Renamed vy -> vy_physics for clarity
            this.id = Math.random().toString(36).substring(2, 15); // Unique ID
            // Initial position in simulation/canvas coordinates (y is canvas down+)
            this.x = x; this.y = y; this.z = z;
            // Initial velocity - applying scaling factor
            // Note: vy_physics input here is now DIRECTLY the physics coord (+Y Up)
            this.vx = vx * velocityScale;
            this.vy = vy_physics * velocityScale; // Physics velocity Y (Up+)
            this.vz = vz * velocityScale; // Physics velocity Z (Out+)
            // Charge and Mass
            this.charge = chargeType * baseCharge;
            this.mass = Math.max(0.1, mass * baseMass); // Ensure mass is not zero
            this.invMass = 1.0 / this.mass; // Pre-calculate inverse mass for efficiency
            // Visual properties
            this.baseRadius = 3 + Math.sqrt(this.mass); // Radius depends on mass
            this.color = this.getColor(chargeType);
            this.threeColor = new THREE.Color(this.color); // THREE.Color object for InstancedMesh
            // Trail properties
            this.trail = []; // Array to store past positions {x, y, z} in sim coords
            this.maxTrailLength = parseInt(trailLengthSlider.value);
            // State
            this.remove = false; // Flag for removal

            // Physics vectors (using THREE.Vector3 for convenience)
            this.force = new THREE.Vector3();        // Total force acting on particle
            this.acceleration = new THREE.Vector3(); // Acceleration (F/m)
            this.velocity = new THREE.Vector3(this.vx, this.vy, this.vz); // Current physics velocity vector
            this.positionSim = new THREE.Vector3(this.x, this.y, this.z); // Sim/Canvas position vector
            this.positionWorld = new THREE.Vector3(); // 3D World position vector (updated in update3DMatrix)
        }

        // Get particle color based on charge type using CSS variables
        getColor(chargeType) {
            const styles = getComputedStyle(document.documentElement);
            if (chargeType > 0) return styles.getPropertyValue('--positive-color').trim();
            if (chargeType < 0) return styles.getPropertyValue('--negative-color').trim();
            return styles.getPropertyValue('--neutral-color').trim();
        }

        // Update particle state using physics laws
        // dt: time step
        // Ex: Electric field X component (Physics coords)
        // Ey_physics: Electric field Y component (Physics coords, +Y Up)
        // B: Magnetic field object {x, y, z} (Physics coords)
        update(dt, Ex, Ey_physics, B) {
             if (this.remove) return; // Skip removed particles

             this.force.set(0, 0, 0); // Reset total force for this step

            // Apply forces only if charged
            if (this.charge !== 0) {
                // --- Electric Force (F = qE) ---
                // Scale field input values and apply force in physics coordinates
                this.force.x += this.charge * Ex * fieldScale * 10; // Added *10 factor for stronger visual effect
                this.force.y += this.charge * Ey_physics * fieldScale * 10; // Use physics Ey (+Y Up) - NO NEGATION NEEDED
                // Note: Ez is assumed to be 0 in this simulation

                // --- Magnetic Force (F = q(v x B)) ---
                applyRightHandRule(
                    this.velocity.x, this.velocity.y, this.velocity.z, // Current physics velocity
                    B.x, B.y, B.z,                                     // Physics B field
                    this.charge, reusableVec3                          // Store result in reusableVec3
                );
                // Add scaled magnetic force to total force
                this.force.addScaledVector(reusableVec3, fieldScale); // Apply B field scaling
            }

            // --- Update Kinematics (using physics coordinates) ---
            // Acceleration: a = F/m
            this.acceleration.copy(this.force).multiplyScalar(this.invMass);
            // Velocity: v = v0 + a*dt
            this.velocity.addScaledVector(this.acceleration, dt);

            // --- Update Position (convert physics velocity to sim/canvas coordinates) ---
            // Apply visual speed factor to make movement more apparent
            this.x += this.velocity.x * dt * visualSpeedFactor;
            this.y -= this.velocity.y * dt * visualSpeedFactor; // Invert physics Y velocity for canvas Y (down+) - THIS REMAINS CORRECT
            this.z += this.velocity.z * dt * visualSpeedFactor;
            this.positionSim.set(this.x, this.y, this.z); // Keep sim position vector updated if needed

            // --- Update Trail (using sim/canvas coordinates) ---
            this.trail.push({ x: this.x, y: this.y, z: this.z });
            if (this.trail.length > this.maxTrailLength) {
                this.trail.shift(); // Remove oldest point if trail exceeds max length
            }

            // --- Boundary Check (using sim/canvas coordinates) ---
            // Remove particle if it goes too far out of bounds (1.5x canvas size)
            const bounds = 1.5;
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            if (this.x < -canvasWidth * (bounds - 1) || this.x > canvasWidth * bounds ||
                this.y < -canvasHeight * (bounds - 1) || this.y > canvasHeight * bounds) {
                this.markForRemoval();
            }
        }

        // Draw particle and its trail on the 2D canvas
        draw2D(ctx) {
            if (this.remove) return; // Don't draw removed particles

            // Draw Trail
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

            // Draw Particle Body
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();

            // Draw Charge Indicator (+ or -) inside the particle
            if (this.charge !== 0) {
                ctx.fillStyle = 'white'; // Contrasting color for text
                ctx.font = `bold ${this.baseRadius * 1.2}px Arial`; // Size based on particle radius
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.charge > 0 ? '+' : '-', this.x, this.y + 1); // Slight offset for centering
            }
        }

        // Mark particle for removal in the next update cycle
        markForRemoval() {
            this.remove = true;
        }

        // Update max trail length dynamically from slider
        updateTrailLength() {
            this.maxTrailLength = parseInt(trailLengthSlider.value);
            // Trim excess points if length decreased
            while (this.trail.length > this.maxTrailLength) {
                this.trail.shift();
            }
        }

        // Clear the trail, keeping only the last point (or current position if no trail)
        clearTrail() {
            if (this.trail.length > 0) {
                this.trail = [this.trail[this.trail.length - 1]];
            } else {
                // If no trail yet, create a starting point at current position
                this.trail = [{ x: this.x, y: this.y, z: this.z }];
            }
        }

        // Calculate and update the transformation matrix for this particle instance
        // Used by the InstancedMesh in the 3D view.
        // Converts sim/canvas coordinates to 3D world coordinates.
        update3DMatrix(canvasWidth, canvasHeight, targetMatrix) {
            // Convert canvas coords (origin top-left, Y down) to world coords (origin center, Y up)
            const worldX = (this.x - canvasWidth / 2) / worldScale;
            const worldY = -(this.y - canvasHeight / 2) / worldScale; // Invert Y - THIS REMAINS CORRECT
            const worldZ = this.z / worldScale; // Z maps directly (assuming canvas Z=0 is world Z=0 plane)

            // Scale based on particle radius and world scale
            const scale = (this.baseRadius / worldScale) * 2; // Sphere geom has radius 1, so scale by desired world radius

            // Update internal world position vector
            this.positionWorld.set(worldX, worldY, worldZ);

            // Apply transformations to the dummy object
            dummyObject.position.copy(this.positionWorld);
            dummyObject.scale.set(scale, scale, scale);
            dummyObject.updateMatrix(); // Recalculate the dummy's matrix

            // Copy the dummy's matrix to the target matrix (for the InstancedMesh)
            targetMatrix.copy(dummyObject.matrix);
        }
    }


    // --- Drawing Functions (2D) ---
    // Clears the 2D canvas and draws the background color and field visualizations
    function drawBackground() {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawFieldVisuals2D(); // Draw field arrows/symbols on top of background
    }

    // Draws visual representations of E and B fields on the 2D canvas
    function drawFieldVisuals2D() {
        if (currentView !== '2d') return; // Only draw if in 2D view

        // Get field values from sliders
        const Ex = parseFloat(electricFieldXSlider.value);
        const Ey_physics = parseFloat(electricFieldYSlider.value); // Read directly as Physics Y (+Up)
        const Bz = parseFloat(magneticFieldZSlider.value);       // Z field (Out+/In-)

        // Convert Ey_physics to Ey_canvas for drawing arrows correctly on canvas (where Y+ is down)
        const Ey_canvas = -Ey_physics; // <<<< NEW CONVERSION FOR DRAWING ONLY

        // Constants for drawing
        const arrowSpacing = 50; // Spacing between arrows/symbols
        const arrowLength = 15;  // Base length of E-field arrows
        ctx.lineWidth = 1;
        const fieldColorE = 'rgba(0, 0, 255, 0.3)'; // Semi-transparent blue for E
        const fieldColorB = 'rgba(255, 0, 0, 0.4)'; // Semi-transparent red for B (fill)
        const fieldStrokeB = 'rgba(255, 0, 0, 0.6)';// Slightly darker red for B (stroke)

        // Draw E-Field Arrows (if field is significant)
        // Use Ex and Ey_canvas for correct arrow direction on the 2D canvas
        if (Math.abs(Ex) > 0.1 || Math.abs(Ey_canvas) > 0.1) {
            ctx.strokeStyle = fieldColorE;
             for (let x = arrowSpacing / 2; x < canvas.width; x += arrowSpacing) {
                for (let y = arrowSpacing / 2; y < canvas.height; y += arrowSpacing) {
                     // Draw an arrow at (x,y) representing the E field vector (Ex, Ey_canvas)
                     drawArrow2D(ctx, x, y, Ex, Ey_canvas, arrowLength); // Use Ey_canvas here
                }
            }
        }

         // Draw B-Field Symbols (Bz component) (if field is significant)
         if (Math.abs(Bz) > 0.1) {
             ctx.fillStyle = fieldColorB;
             ctx.strokeStyle = fieldStrokeB;
             ctx.lineWidth = 1.5;
             const radius = 3; // Radius of the circle symbol

             for (let x = arrowSpacing / 2; x < canvas.width; x += arrowSpacing) {
                for (let y = arrowSpacing / 2; y < canvas.height; y += arrowSpacing) {
                     // Draw the outer circle
                     ctx.beginPath();
                     ctx.arc(x, y, radius, 0, Math.PI * 2);
                     ctx.stroke();

                     // Draw indicator for direction
                    if (Bz > 0) { // Positive Bz (Out of screen) - Draw a dot
                        ctx.beginPath();
                        ctx.arc(x, y, radius / 3, 0, Math.PI * 2);
                        ctx.fill();
                    } else { // Negative Bz (Into screen) - Draw an 'X'
                        ctx.beginPath();
                        ctx.moveTo(x - radius * 0.7, y - radius * 0.7); ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
                        ctx.moveTo(x - radius * 0.7, y + radius * 0.7); ctx.lineTo(x + radius * 0.7, y - radius * 0.7);
                        ctx.stroke();
                    }
                }
            }
        }
    }

    // Helper function to draw a single 2D arrow
    function drawArrow2D(ctx, x, y, dx, dy, baseLen) {
        const mag = Math.sqrt(dx*dx + dy*dy);
        if (mag < 0.01) return; // Don't draw zero-length arrows

        const angle = Math.atan2(dy, dx); // Angle of the vector
        const arrowHeadSize = 5;

        // Make arrow length slightly dependent on magnitude, but capped
        const effectiveLen = Math.min(baseLen * (1 + mag * 0.1), baseLen * 1.5);
        const endX = x + Math.cos(angle) * effectiveLen;
        const endY = y + Math.sin(angle) * effectiveLen;

        ctx.beginPath();
        // Line shaft
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        // Arrowhead lines
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowHeadSize * Math.cos(angle - Math.PI / 6), endY - arrowHeadSize * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowHeadSize * Math.cos(angle + Math.PI / 6), endY - arrowHeadSize * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }

    // Updates the text indicators for E and B field strengths
     function updateFieldIndicators() {
         // Get raw slider values
         const Ex = parseFloat(electricFieldXSlider.value);
         const Ey_physics = parseFloat(electricFieldYSlider.value); // Physics Y (Up+)
         const Bx = parseFloat(magneticFieldXSlider.value);       // Physics X (Right+)
         const By = parseFloat(magneticFieldYSlider.value);       // Physics Y (Up+)
         const Bz = parseFloat(magneticFieldZSlider.value);       // Physics Z (Out+)

         let eText = "Yok"; // Default text
         let bText = "Yok";

         // Calculate magnitudes based on physics components
         const eMag = Math.sqrt(Ex*Ex + Ey_physics*Ey_physics); // Use Ey_physics for magnitude
         const bMag = Math.sqrt(Bx*Bx + By*By + Bz*Bz);      // Magnitude based on all physics components

         // Update text if magnitudes are significant
         if (eMag > 0.01) {
             // Show components in Physics coordinates
             eText = `${eMag.toFixed(1)} E₀ (Ex:${Ex}, Ey:${Ey_physics})`;
         }
         if (bMag > 0.01) {
            // Show B components in Physics coordinates
             bText = `${bMag.toFixed(1)} B₀ (Bx:${Bx}, By:${By}, Bz:${Bz})`;
         }

         eFieldIndicator.textContent = eText;
         bFieldIndicator.textContent = bText;

         // Check if Bx or By changed for updating 3D arrows
         const bxChanged = Bx !== lastBx;
         const byChanged = By !== lastBy;

         // Update 3D visuals only if in 3D view, initialized, and Bx/By changed
         if (currentView === '3d' && threeInitialized && (bxChanged || byChanged)) {
              update3DFieldVisuals(Bx, By); // Pass current Physics Bx, By
              lastBx = Bx; // Store current values for next check
              lastBy = By;
         } else if (currentView === '2d') {
             // If in 2D view, redraw the canvas background (which includes 2D field visuals)
             drawBackground();
         }
    }

    // --- Simulation Update Function ---
    // Advances the simulation state by one time step (dt)
    function updateSimulation(dt) {
        if (!simulationRunning) return; // Do nothing if paused

        // Get current field values (Ey is now directly physics coordinates)
        const Ex = parseFloat(electricFieldXSlider.value);
        const Ey_physics = parseFloat(electricFieldYSlider.value); // Read directly as Physics Y (+Up) - NO NEGATION NEEDED

        // Get the current magnetic field vector (uniform field in this case)
        const currentBField = calculateMagneticFieldVector(null); // Pass null position for uniform field

        const particlesToRemoveIndexes = [];
        // Update each particle
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            // Pass physics Ey directly
            p.update(dt, Ex, Ey_physics, currentBField);
            // Mark particle for removal if its flag is set
            if (p.remove) {
                particlesToRemoveIndexes.push(i);
            }
        }

        // Remove marked particles (iterate backwards to avoid index issues)
        for (let i = particlesToRemoveIndexes.length - 1; i >= 0; i--) {
             particles.splice(particlesToRemoveIndexes[i], 1);
        }

        // Advance simulation time
        time += dt;
    }

    // --- Animation Loops ---
    // Main loop for the 2D canvas rendering
    function gameLoop2D() {
        updateSimulation(timeStep); // Update physics state
        drawBackground();           // Draw background and field visuals
        // Draw all particles
        for (let i = 0; i < particles.length; i++) {
            particles[i].draw2D(ctx);
        }
        // Request next frame if simulation is still running and in 2D view
        if (simulationRunning && currentView === '2d') {
            animationFrameId = requestAnimationFrame(gameLoop2D);
        } else {
            animationFrameId = null; // Stop animation loop
        }
    }

    // Main loop for the 3D Three.js rendering (Code unchanged from previous version)
    function animateThreeJS() {
        if (!simulationRunning || currentView !== '3d' || !threeInitialized) {
             animationFrameId = null; return;
        }
        updateSimulation(timeStep);
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
        threeControls?.update();
        threeRenderer.render(threeScene, threeCamera);
        animationFrameId = requestAnimationFrame(animateThreeJS);
    }
    animateThreeJS.colorWarningLogged = false;


    // --- Three.js Initialization --- (Code unchanged from previous version)
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
            bFieldArrowsGroup = new THREE.Group(); threeScene.add(bFieldArrowsGroup); lastBx = parseFloat(magneticFieldXSlider.value); lastBy = parseFloat(magneticFieldYSlider.value); update3DFieldVisuals(lastBx, lastBy);
            threeInitialized = true; window.addEventListener('resize', onThreeResize, false); console.log("Three.js Initialized. Controls: Left=Pan, Right=Orbit, Wheel=Zoom.");
         } catch (error) { console.error("Error during Three.js initialization:", error); alert("Failed to initialize 3D view. Check console."); currentView = '2d'; simulationWrapper.classList.remove('view-3d'); simulationWrapper.classList.add('view-2d'); toggleViewButton.textContent = '3D Görünüme Geç'; threeInitialized = false; }
    }

     // Update Bx/By Field Arrows in 3D (Code unchanged from previous version)
     function update3DFieldVisuals(currentBx, currentBy) {
        if (!threeInitialized || !bFieldArrowsGroup) return;
        while (bFieldArrowsGroup.children.length > 0) { const child = bFieldArrowsGroup.children[0]; bFieldArrowsGroup.remove(child); if (child instanceof THREE.ArrowHelper) { if (child.line && child.line.geometry) child.line.geometry.dispose(); if (child.line && child.line.material) child.line.material.dispose(); if (child.cone && child.cone.geometry) child.cone.geometry.dispose(); if (child.cone && child.cone.material) child.cone.material.dispose(); } else { if (child.geometry) child.geometry.dispose(); if (child.material) child.material.dispose(); } }
        const magSq = currentBx * currentBx + currentBy * currentBy; if (magSq < 0.001) { if (!simulationRunning && threeRenderer) threeRenderer.render(threeScene, threeCamera); return; }
        const arrowColor = 0xff0000; const arrowLengthBase = worldScale * 0.05; const gridSpacing = worldScale * 0.3; const gridRange = worldScale * 0.6; const direction = reusableVec3.set(currentBx, currentBy, 0).normalize(); const magnitude = Math.sqrt(magSq); const arrowLength = arrowLengthBase * (1 + magnitude * 0.4); const headLength = Math.max(arrowLength * 0.3, worldScale * 0.015); const headWidth = Math.max(headLength * 0.7, worldScale * 0.01);
        for (let x = -gridRange; x <= gridRange; x += gridSpacing) { for (let z = -gridRange; z <= gridRange; z += gridSpacing) { const origin = new THREE.Vector3(x, 0, z); const arrowHelper = new THREE.ArrowHelper(direction, origin, arrowLength, arrowColor, headLength, headWidth); bFieldArrowsGroup.add(arrowHelper); } }
        if (!simulationRunning && threeRenderer) threeRenderer.render(threeScene, threeCamera);
    }

    // Handles window resize events for the 3D view (Code unchanged from previous version)
    function onThreeResize() {
        if (!threeInitialized || !threeRenderer) return; const containerRect = simulation3DContainer.getBoundingClientRect(); const width = containerRect.width; const height = containerRect.height; if (width <= 0 || height <= 0) return;
        threeCamera.aspect = width / height; threeCamera.updateProjectionMatrix(); threeRenderer.setSize(width, height); if (!simulationRunning) threeRenderer.render(threeScene, threeCamera);
    }

    // Stops the current animation loop (either 2D or 3D) (Code unchanged from previous version)
    function stopAnimation() { if (animationFrameId) cancelAnimationFrame(animationFrameId); animationFrameId = null; }

    // Starts the appropriate animation loop based on the current view (Code unchanged from previous version)
    function startAnimation() { stopAnimation(); if (simulationRunning) { if (currentView === '2d') { animationFrameId = requestAnimationFrame(gameLoop2D); } else if (currentView === '3d') { if (!threeInitialized) { requestAnimationFrame(() => { initThreeJS(); if (threeInitialized) { onThreeResize(); animationFrameId = requestAnimationFrame(animateThreeJS); } }); } else { onThreeResize(); animationFrameId = requestAnimationFrame(animateThreeJS); } } } }


    // --- Event Listeners ---

    // Update slider value displays on input
    massSlider.addEventListener('input', () => massValueSpan.textContent = massSlider.value);
    initialVxSlider.addEventListener('input', () => initialVxValueSpan.textContent = initialVxSlider.value);
    initialVySlider.addEventListener('input', () => initialVyValueSpan.textContent = initialVySlider.value);

    // Update field indicators and visuals when field sliders change
    electricFieldXSlider.addEventListener('input', () => { electricFieldXValueSpan.textContent = electricFieldXSlider.value; updateFieldIndicators(); });
    electricFieldYSlider.addEventListener('input', () => { electricFieldYValueSpan.textContent = electricFieldYSlider.value; updateFieldIndicators(); });
    magneticFieldXSlider.addEventListener('input', () => { magneticFieldXValueSpan.textContent = magneticFieldXSlider.value; updateFieldIndicators(); });
    magneticFieldYSlider.addEventListener('input', () => { magneticFieldYValueSpan.textContent = magneticFieldYSlider.value; updateFieldIndicators(); });
    magneticFieldZSlider.addEventListener('input', () => { magneticFieldZValueSpan.textContent = magneticFieldZSlider.value; updateFieldIndicators(); });

    // Update trail length for all particles when trail slider changes
    trailLengthSlider.addEventListener('input', () => {
        trailLengthValueSpan.textContent = trailLengthSlider.value;
        particles.forEach(p => p.updateTrailLength());
    });

    // Add Particle Listener (handles both 2D and 3D clicks)
    simulationWrapper.addEventListener('click', (event) => {
        // Limit number of particles
        if(particles.length >= maxParticles) {
            console.warn(`Max particle limit (${maxParticles}) reached. Cannot add more.`);
            return;
        }

        let particleStartX, particleStartY, particleStartZ;

        if (currentView === '2d') {
            // --- 2D Click ---
            const rect = canvas.getBoundingClientRect();
            particleStartX = event.clientX - rect.left; // X relative to canvas
            particleStartY = event.clientY - rect.top;  // Y relative to canvas (down+)
            particleStartZ = 0;                         // Start on Z=0 plane in 2D
        }
        else if (currentView === '3d' && threeInitialized) {
            // --- 3D Click ---
            const rect = simulation3DContainer.getBoundingClientRect();
            // Convert mouse coords to Normalized Device Coordinates (NDC) [-1, +1]
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            mouseNDC.x = (mouseX / rect.width) * 2 - 1;
            mouseNDC.y = -(mouseY / rect.height) * 2 + 1; // Y is inverted in NDC

            // Update the raycaster with the camera and mouse position
            raycaster.setFromCamera(mouseNDC, threeCamera);

            // Calculate intersection with the ground plane (Y=0)
            if (raycaster.ray.intersectPlane(groundPlane, intersectionPointWorld)) {
                // Convert world intersection coords back to simulation/canvas coords
                const currentCanvasWidth = canvas.width;
                const currentCanvasHeight = canvas.height;
                particleStartX = intersectionPointWorld.x * worldScale + currentCanvasWidth / 2;
                particleStartY = -intersectionPointWorld.y * worldScale + currentCanvasHeight / 2; // Invert Y back
                particleStartZ = intersectionPointWorld.z * worldScale; // Use world Z directly
            } else {
                // Fallback if ray doesn't hit the plane (e.g., clicking sky)
                console.warn("3D click ray did not intersect the ground plane. Placing particle near center.");
                particleStartX = canvas.width / 2;
                particleStartY = canvas.height / 2;
                particleStartZ = 0;
            }
        }
        else {
             // If in 3D view but not initialized, do nothing
            return;
        }

        // Get particle properties from controls
        const chargeType = parseInt(chargeTypeSelect.value);
        const mass = parseFloat(massSlider.value);
        const vx_input = parseFloat(initialVxSlider.value); // X velocity (Right+/Left-)
        const vy_input = parseFloat(initialVySlider.value); // Y velocity from slider (NOW Up+/Down-)
        const vz_input = 0; // Z velocity is always 0 initially in this setup

        // Convert initial Vy from canvas coords to physics coords - NO LONGER NEEDED
        // const initialPhysicsVy = -vy_canvas;
        const initialPhysicsVy = vy_input; // Use directly as Physics Vy (Up+/Down-)

        // Create and add the new particle
        const newParticle = new Particle(
            particleStartX, particleStartY, particleStartZ, // Initial sim position
            vx_input, initialPhysicsVy, vz_input,          // Initial physics velocity (using direct vy_input)
            chargeType, mass
        );
        particles.push(newParticle);

        // If paused, draw the newly added particle immediately
        if (!simulationRunning) {
            if (currentView === '2d') {
                drawBackground(); // Redraw background/fields
                for (let i = 0; i < particles.length; i++) particles[i].draw2D(ctx); // Draw all particles
            } else if (threeInitialized) {
                // Update 3D view state once to show the new particle
                updateSimulation(0); // Update particle matrices/colors (dt=0 does no physics step)
                animateThreeJS();    // Run one frame of the 3D loop
                stopAnimation();     // Stop immediately after rendering the frame
            }
        }
    });

    // Simulation control buttons (Code unchanged from previous version)
    startButton.addEventListener('click', () => { simulationRunning = !simulationRunning; startButton.textContent = simulationRunning ? 'Duraklat' : 'Başlat'; if (simulationRunning) startAnimation(); else stopAnimation(); });
    resetButton.addEventListener('click', () => { simulationRunning = false; startButton.textContent = 'Başlat'; stopAnimation(); particles = []; time = 0; drawBackground(); if (currentView === '3d' && threeInitialized && particleInstancedMesh) { particleInstancedMesh.count = 0; particleInstancedMesh.instanceMatrix.needsUpdate = true; if (particleInstancedMesh.instanceColor) particleInstancedMesh.instanceColor.needsUpdate = true; lastBx = NaN; lastBy = NaN; updateFieldIndicators(); if(threeRenderer) threeRenderer.render(threeScene, threeCamera); } });
    clearTrailsButton.addEventListener('click', () => { particles.forEach(p => p.clearTrail()); if (!simulationRunning && currentView === '2d') { drawBackground(); for (let i = 0; i < particles.length; i++) particles[i].draw2D(ctx); } });
    resetFieldsButton.addEventListener('click', () => { electricFieldXSlider.value = 0; electricFieldYSlider.value = 0; magneticFieldXSlider.value = 0; magneticFieldYSlider.value = 0; magneticFieldZSlider.value = 0; electricFieldXSlider.dispatchEvent(new Event('input')); electricFieldYSlider.dispatchEvent(new Event('input')); magneticFieldXSlider.dispatchEvent(new Event('input')); magneticFieldYSlider.dispatchEvent(new Event('input')); magneticFieldZSlider.dispatchEvent(new Event('input')); });

    // View Toggle Button (Code unchanged from previous version)
    toggleViewButton.addEventListener('click', () => {
        const wasRunning = simulationRunning; if (simulationRunning) { stopAnimation(); simulationRunning = false; startButton.textContent = 'Başlat'; }
        if (currentView === '2d') { currentView = '3d'; simulationWrapper.classList.remove('view-2d'); simulationWrapper.classList.add('view-3d'); toggleViewButton.textContent = '2D Görünüme Geç'; requestAnimationFrame(() => { if (!threeInitialized) initThreeJS(); else onThreeResize(); if (threeInitialized) { lastBx = NaN; lastBy = NaN; updateFieldIndicators(); updateSimulation(0); animateThreeJS(); stopAnimation(); if (wasRunning) { simulationRunning = true; startButton.textContent = 'Duraklat'; startAnimation(); } } else { currentView = '2d'; simulationWrapper.classList.add('view-2d'); simulationWrapper.classList.remove('view-3d'); toggleViewButton.textContent = '3D Görünüme Geç'; if (wasRunning) { simulationRunning = true; startButton.textContent = 'Duraklat'; startAnimation(); } } }); }
        else { currentView = '2d'; simulationWrapper.classList.remove('view-3d'); simulationWrapper.classList.add('view-2d'); toggleViewButton.textContent = '3D Görünüme Geç'; resizeCanvas(); for (let i = 0; i < particles.length; i++) particles[i].draw2D(ctx); if (wasRunning) { simulationRunning = true; startButton.textContent = 'Duraklat'; startAnimation(); } }
    });

    // Window resize handler (Code unchanged from previous version)
    window.addEventListener('resize', () => { if (currentView === '2d') { resizeCanvas(); if (!simulationRunning) { for (let i = 0; i < particles.length; i++) particles[i].draw2D(ctx); } } else if (threeInitialized) { onThreeResize(); } });

    // --- Initial Setup --- (Code unchanged from previous version)
    resizeCanvas();
    updateFieldIndicators();
    startButton.textContent = 'Başlat';

}); // End DOMContentLoaded

// --- END OF FILE script.js ---