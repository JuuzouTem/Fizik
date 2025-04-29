document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simulationCanvas');
    const ctx = canvas.getContext('2d');

    // --- Control Elements ---
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
    const magneticFieldZSlider = document.getElementById('magneticFieldZ');
    const magneticFieldZValueSpan = document.getElementById('magneticFieldZValue');
    const startButton = document.getElementById('startButton');
    const resetButton = document.getElementById('resetButton');
    const clearTrailsButton = document.getElementById('clearTrailsButton');
    const trailLengthSlider = document.getElementById('trailLength');
    const trailLengthValueSpan = document.getElementById('trailLengthValue');
    const eFieldIndicator = document.getElementById('e-field-indicator').querySelector('span');
    const bFieldIndicator = document.getElementById('b-field-indicator').querySelector('span');


    // --- Simulation State ---
    let particles = [];
    let simulationRunning = false;
    let animationFrameId = null;
    let time = 0;
    const timeStep = 0.02; // Simulation time step

    // Scaling factors (adjust these to change simulation "speed" and appearance)
    const velocityScale = 0.1;
    const fieldScale = 0.2; // Scales E and B fields' effect
    const baseCharge = 1.0; // Base magnitude of charge
    const baseMass = 1.0;   // Base mass unit

    // --- Canvas Setup ---
    function resizeCanvas() {
        // Make canvas width responsive, fixed height or aspect ratio based
        const containerWidth = canvas.parentElement.clientWidth;
        canvas.width = Math.min(containerWidth, 800); // Max width 800px
        canvas.height = 500; // Fixed height
         // Re-draw background etc. if needed after resize
        drawBackground();
        updateFieldIndicators();
    }

    // --- Particle Class/Object ---
    class Particle {
        constructor(x, y, vx, vy, chargeType, mass) {
            this.x = x;
            this.y = y;
            this.vx = vx * velocityScale;
            this.vy = vy * velocityScale;
            this.charge = chargeType * baseCharge; // chargeType is -1, 0, or 1
            this.mass = Math.max(0.1, mass * baseMass); // Prevent zero mass
            this.radius = 3 + Math.sqrt(this.mass); // Size based on mass
            this.color = this.getColor(chargeType);
            this.trail = [];
            this.maxTrailLength = parseInt(trailLengthSlider.value);
        }

        getColor(chargeType) {
            if (chargeType > 0) return getComputedStyle(document.documentElement).getPropertyValue('--positive-color').trim();
            if (chargeType < 0) return getComputedStyle(document.documentElement).getPropertyValue('--negative-color').trim();
            return getComputedStyle(document.documentElement).getPropertyValue('--neutral-color').trim();
        }

        update(dt, Ex, Ey, Bz) {
            if (this.mass <= 0) return; // Safety check

            let Fx = 0;
            let Fy = 0;

            // --- Calculate Forces ---
            if (this.charge !== 0) {
                // Electric Force: F_E = qE
                Fx += this.charge * Ex * fieldScale * 10; // Extra scaling factor for E
                Fy += this.charge * Ey * fieldScale * 10;

                // Magnetic Force: F_B = q(v x B)
                // Assuming B is only in z-direction (Bz)
                // v x B = (vy*Bz - vz*By, vz*Bx - vx*Bz, vx*By - vy*Bx)
                // Since v = (vx, vy, 0) and B = (0, 0, Bz)
                // v x B = (vy*Bz, -vx*Bz, 0)
                const F_magnetic_x = this.charge * this.vy * Bz * fieldScale;
                const F_magnetic_y = -this.charge * this.vx * Bz * fieldScale;
                Fx += F_magnetic_x;
                Fy += F_magnetic_y;
            }

            // --- Update Kinematics (using Euler method) ---
            // Acceleration: a = F/m
            const ax = Fx / this.mass;
            const ay = Fy / this.mass;

            // Velocity: v = v0 + a*dt
            this.vx += ax * dt;
            this.vy += ay * dt;

            // Position: x = x0 + v*dt
            this.x += this.vx * dt;
            this.y += this.vy * dt;

             // --- Add to Trail ---
             this.trail.push({ x: this.x, y: this.y });
             if (this.trail.length > this.maxTrailLength) {
                 this.trail.shift(); // Remove oldest point
             }

             // --- Boundary Handling (Simple Wrap Around) ---
            // if (this.x < 0) this.x = canvas.width;
            // if (this.x > canvas.width) this.x = 0;
            // if (this.y < 0) this.y = canvas.height;
            // if (this.y > canvas.height) this.y = 0;
             // --- Boundary Handling (Remove particle) ---
             if (this.x < -this.radius * 2 || this.x > canvas.width + this.radius * 2 ||
                 this.y < -this.radius * 2 || this.y > canvas.height + this.radius * 2) {
                this.remove = true; // Mark for removal
             }

        }

        draw(ctx) {
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

            // Draw Particle
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();

            // Draw charge indicator (+/-)
            if (this.charge !== 0) {
                ctx.fillStyle = 'white';
                ctx.font = `bold ${this.radius * 1.2}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.charge > 0 ? '+' : '-', this.x, this.y + 1); // Slight offset for better centering
            }
        }

        updateTrailLength() {
             this.maxTrailLength = parseInt(trailLengthSlider.value);
             // Trim existing trail if it's now too long
             while (this.trail.length > this.maxTrailLength) {
                 this.trail.shift();
             }
        }

         clearTrail() {
            this.trail = [{ x: this.x, y: this.y }]; // Keep current position
        }
    }

    // --- Drawing Functions ---
    function drawBackground() {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Optional: Draw grid or field lines based on current E/B fields
         drawFieldVisuals();
    }

    function drawFieldVisuals() {
        const Ex = parseFloat(electricFieldXSlider.value);
        const Ey = parseFloat(electricFieldYSlider.value);
        const Bz = parseFloat(magneticFieldZSlider.value);
        const arrowSpacing = 50; // Spacing between field indicators
        const arrowLength = 15;
        ctx.lineWidth = 1;

        // Draw E-field arrows (simplified)
        if (Math.abs(Ex) > 0.1 || Math.abs(Ey) > 0.1) {
            ctx.strokeStyle = 'rgba(0, 0, 255, 0.3)'; // Blueish for E field
             for (let x = arrowSpacing / 2; x < canvas.width; x += arrowSpacing) {
                for (let y = arrowSpacing / 2; y < canvas.height; y += arrowSpacing) {
                     drawArrow(ctx, x, y, Ex, Ey, arrowLength);
                }
            }
        }

        // Draw B-field indicators (dots/crosses)
         if (Math.abs(Bz) > 0.1) {
             ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'; // Reddish for B field
             ctx.lineWidth = 1.5;
             const radius = 3;
             for (let x = arrowSpacing / 2; x < canvas.width; x += arrowSpacing) {
                for (let y = arrowSpacing / 2; y < canvas.height; y += arrowSpacing) {
                     ctx.beginPath();
                     ctx.arc(x, y, radius, 0, Math.PI * 2);
                     ctx.stroke();
                    if (Bz < 0) { // Out of page (dot)
                        ctx.beginPath();
                        ctx.arc(x, y, radius / 3, 0, Math.PI * 2);
                        ctx.fill();
                    } else { // Into page (cross)
                        ctx.beginPath();
                        ctx.moveTo(x - radius * 0.7, y - radius * 0.7);
                        ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
                        ctx.moveTo(x - radius * 0.7, y + radius * 0.7);
                        ctx.lineTo(x + radius * 0.7, y - radius * 0.7);
                        ctx.stroke();
                    }
                }
            }
        }
    }

    function drawArrow(ctx, x, y, dx, dy, len) {
        const angle = Math.atan2(dy, dx);
        const arrowHeadSize = 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const endX = x + Math.cos(angle) * len;
        const endY = y + Math.sin(angle) * len;
        ctx.lineTo(endX, endY);
        // Arrowhead
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowHeadSize * Math.cos(angle - Math.PI / 6), endY - arrowHeadSize * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowHeadSize * Math.cos(angle + Math.PI / 6), endY - arrowHeadSize * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }

    function updateFieldIndicators() {
         const Ex = parseFloat(electricFieldXSlider.value);
         const Ey = parseFloat(electricFieldYSlider.value);
         const Bz = parseFloat(magneticFieldZSlider.value);
         let eText = "Yok";
         let bText = "Yok";

         if (Math.abs(Ex) > 0.1 || Math.abs(Ey) > 0.1) {
             let angle = Math.atan2(Ey, Ex) * 180 / Math.PI;
             eText = `${Math.sqrt(Ex*Ex + Ey*Ey).toFixed(1)} E₀ (${angle.toFixed(0)}°)`;
         }

         if (Math.abs(Bz) > 0.1) {
             bText = `${Math.abs(Bz).toFixed(1)} B₀ (${Bz > 0 ? 'İçeri' : 'Dışarı'})`;
         }
         eFieldIndicator.textContent = eText;
         bFieldIndicator.textContent = bText;

         // Redraw background visuals if fields changed
         drawBackground();
    }


    // --- Simulation Loop ---
    function gameLoop() {
        if (!simulationRunning) {
            animationFrameId = null; // Ensure we stop requesting frames
            return;
        }

        // Get current field values
        const Ex = parseFloat(electricFieldXSlider.value);
        const Ey = parseFloat(electricFieldYSlider.value);
        const Bz = parseFloat(magneticFieldZSlider.value);

        // Clear canvas (or redraw background if it has field visuals)
        drawBackground();
        // ctx.clearRect(0, 0, canvas.width, canvas.height);


        // Update and draw particles
        const particlesToRemove = [];
        particles.forEach((p, index) => {
            p.update(timeStep, Ex, Ey, Bz);
            p.draw(ctx);
            if (p.remove) {
                particlesToRemove.push(index);
            }
        });

        // Remove particles that went off-screen (iterate backwards)
        for (let i = particlesToRemove.length - 1; i >= 0; i--) {
             particles.splice(particlesToRemove[i], 1);
        }


        time += timeStep;

        // Request next frame
        animationFrameId = requestAnimationFrame(gameLoop);
    }

    // --- Event Listeners ---

    // Update value spans next to sliders
    massSlider.addEventListener('input', () => massValueSpan.textContent = massSlider.value);
    initialVxSlider.addEventListener('input', () => initialVxValueSpan.textContent = initialVxSlider.value);
    initialVySlider.addEventListener('input', () => initialVyValueSpan.textContent = initialVySlider.value);
    electricFieldXSlider.addEventListener('input', () => {
        electricFieldXValueSpan.textContent = electricFieldXSlider.value;
        updateFieldIndicators(); // Update visuals immediately
    });
    electricFieldYSlider.addEventListener('input', () => {
        electricFieldYValueSpan.textContent = electricFieldYSlider.value;
        updateFieldIndicators(); // Update visuals immediately
    });
    magneticFieldZSlider.addEventListener('input', () => {
         magneticFieldZValueSpan.textContent = magneticFieldZSlider.value;
         updateFieldIndicators(); // Update visuals immediately
    });
    trailLengthSlider.addEventListener('input', () => {
         trailLengthValueSpan.textContent = trailLengthSlider.value;
         // Update trail length for existing particles
         const newLength = parseInt(trailLengthSlider.value);
         particles.forEach(p => p.updateTrailLength());
    });


    // Canvas click to add particle
    canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const chargeType = parseInt(chargeTypeSelect.value);
        const mass = parseFloat(massSlider.value);
        const vx = parseFloat(initialVxSlider.value);
        const vy = parseFloat(initialVySlider.value);

        particles.push(new Particle(x, y, vx, vy, chargeType, mass));

        // Draw the newly added particle immediately if paused
        if (!simulationRunning) {
             drawBackground(); // Redraw background first
             particles.forEach(p => p.draw(ctx)); // Redraw all particles
        }
    });

    // Simulation controls
    startButton.addEventListener('click', () => {
        simulationRunning = !simulationRunning;
        startButton.textContent = simulationRunning ? 'Duraklat' : 'Başlat';
        if (simulationRunning && !animationFrameId) {
             // Start the loop if it wasn't running
             time = 0; // Optionally reset time on each start
             animationFrameId = requestAnimationFrame(gameLoop);
        }
    });

    resetButton.addEventListener('click', () => {
        simulationRunning = false;
        startButton.textContent = 'Başlat';
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        particles = [];
        time = 0;
        // ctx.clearRect(0, 0, canvas.width, canvas.height);
         drawBackground(); // Redraw empty background
    });

    clearTrailsButton.addEventListener('click', () => {
         particles.forEach(p => p.clearTrail());
         // Redraw immediately if paused
        if (!simulationRunning) {
             drawBackground();
             particles.forEach(p => p.draw(ctx));
        }
    });

    // Window resize
    window.addEventListener('resize', () => {
         resizeCanvas();
         // Redraw particles if paused after resize
         if (!simulationRunning) {
             particles.forEach(p => p.draw(ctx));
         }
    });

    // --- Initial Setup ---
    resizeCanvas(); // Initial sizing
    updateFieldIndicators(); // Initial field text
    drawBackground(); // Draw initial empty state

}); // End DOMContentLoaded