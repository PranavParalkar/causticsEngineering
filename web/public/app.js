/* ═══════════════════════════════════════════════════════════════
   Caustics Engineering — Frontend Application Logic
   Handles upload, settings, progress polling, and 3D preview
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── DOM Elements ──────────────────────────────────────
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.getElementById('preview-container');
    const previewImg = document.getElementById('preview-img');
    const previewName = document.getElementById('preview-name');
    const previewSize = document.getElementById('preview-size');
    const previewRemove = document.getElementById('preview-remove');

    const settingsToggle = document.getElementById('settings-toggle');
    const settingsPanel = document.getElementById('settings-panel');

    const btnGenerate = document.getElementById('btn-generate');

    const progressSection = document.getElementById('progress-section');
    const progressBar = document.getElementById('progress-bar');
    const progressStatus = document.getElementById('progress-status');
    const logContainer = document.getElementById('log-container');

    const resultsSection = document.getElementById('results-section');
    const btnDownload = document.getElementById('btn-download');
    const viewerContainer = document.getElementById('viewer-container');

    // ── State ─────────────────────────────────────────────
    let selectedFile = null;
    let currentJobId = null;
    let pollInterval = null;
    let lastLogCount = 0;

    // ── Upload Handling ───────────────────────────────────
    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('drag-over');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            setFile(files[0]);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            setFile(fileInput.files[0]);
        }
    });

    previewRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFile();
    });

    function setFile(file) {
        selectedFile = file;
        uploadZone.classList.add('has-file');
        btnGenerate.disabled = false;

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewContainer.classList.add('visible');
        };
        reader.readAsDataURL(file);

        previewName.textContent = file.name;
        previewSize.textContent = formatBytes(file.size);
    }

    function clearFile() {
        selectedFile = null;
        fileInput.value = '';
        uploadZone.classList.remove('has-file');
        previewContainer.classList.remove('visible');
        btnGenerate.disabled = true;
    }

    // ── Settings Toggle ───────────────────────────────────
    settingsToggle.addEventListener('click', () => {
        settingsToggle.classList.toggle('open');
        settingsPanel.classList.toggle('open');
    });

    // ── Generate ──────────────────────────────────────────
    btnGenerate.addEventListener('click', async () => {
        if (!selectedFile || btnGenerate.disabled) return;

        btnGenerate.disabled = true;
        btnGenerate.classList.add('loading');

        // Reset UI
        progressSection.classList.add('visible');
        resultsSection.classList.remove('visible');
        logContainer.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.classList.add('indeterminate');
        progressStatus.textContent = 'Starting';
        progressStatus.className = 'progress-status';
        lastLogCount = 0;

        // Build form data
        const formData = new FormData();
        formData.append('image', selectedFile);
        formData.append('width', document.getElementById('setting-width').value);
        formData.append('artifactSize', document.getElementById('setting-artifact-size').value);
        formData.append('focalLength', document.getElementById('setting-focal-length').value);
        formData.append('iterations', document.getElementById('setting-iterations').value);

        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.error) {
                addLog('Error: ' + data.error, true);
                resetButton();
                return;
            }

            currentJobId = data.jobId;
            addLog('Job submitted — waiting for Julia to start...');
            startPolling();
        } catch (err) {
            addLog('Network error: ' + err.message, true);
            resetButton();
        }
    });

    // ── Polling ───────────────────────────────────────────
    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(checkStatus, 1500);
    }

    async function checkStatus() {
        if (!currentJobId) return;

        try {
            const res = await fetch(`/api/status/${currentJobId}`);
            const data = await res.json();

            // Append new logs
            if (data.logs && data.logs.length > lastLogCount) {
                for (let i = lastLogCount; i < data.logs.length; i++) {
                    const entry = data.logs[i];
                    const isError = entry.message.includes('[stderr]') || entry.message.includes('error');
                    addLog(entry.message, isError);
                }
                lastLogCount = data.logs.length;
            }

            // Update progress bar heuristic
            updateProgressBar(data);

            // Update status
            progressStatus.textContent = capitalize(data.status);

            if (data.status === 'done') {
                clearInterval(pollInterval);
                progressBar.classList.remove('indeterminate');
                progressBar.style.width = '100%';
                progressStatus.classList.add('done');
                progressStatus.textContent = 'Complete ✓';
                resetButton();
                showResults();
            } else if (data.status === 'error') {
                clearInterval(pollInterval);
                progressBar.classList.remove('indeterminate');
                progressBar.style.width = '100%';
                progressStatus.classList.add('error');
                progressStatus.textContent = 'Failed ✗';
                resetButton();
            }
        } catch {
            // Silent retry
        }
    }

    function updateProgressBar(data) {
        if (data.status === 'done') return;

        // Parse iteration progress from logs
        let progress = 5;
        const iterations = parseInt(document.getElementById('setting-iterations').value) || 4;
        for (const log of data.logs || []) {
            const msg = log.message;
            if (msg.includes('Image loaded')) progress = 10;
            if (msg.includes('Resizing')) progress = 15;
            const iterMatch = msg.match(/Mesh iteration (\d+)\/(\d+)/);
            if (iterMatch) {
                const cur = parseInt(iterMatch[1]);
                const total = parseInt(iterMatch[2]);
                progress = 15 + (cur / total) * 50;
            }
            if (msg.includes('Computing surface')) progress = 70;
            if (msg.includes('Solidifying')) progress = 85;
            if (msg.includes('OBJ saved')) progress = 100;
        }

        progressBar.classList.remove('indeterminate');
        progressBar.style.width = progress + '%';
    }

    // ── Results ───────────────────────────────────────────
    function showResults() {
        resultsSection.classList.add('visible');
        btnDownload.href = `/api/download/${currentJobId}`;

        // Load 3D preview
        loadOBJPreview(`/api/preview/${currentJobId}`);
    }

    // ── Three.js 3D Preview ───────────────────────────────
    function loadOBJPreview(url) {
        // Clear previous content (except hint)
        const hint = viewerContainer.querySelector('.viewer-hint');
        viewerContainer.innerHTML = '';
        if (hint) viewerContainer.appendChild(hint);

        const width = viewerContainer.clientWidth;
        const height = viewerContainer.clientHeight;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x12121a);

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.001, 1000);
        camera.position.set(0, 0.15, 0.2);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        viewerContainer.insertBefore(renderer.domElement, hint);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404050, 0.6);
        scene.add(ambientLight);

        const dirLight1 = new THREE.DirectionalLight(0x5b9cf5, 0.8);
        dirLight1.position.set(5, 10, 7);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xa78bfa, 0.4);
        dirLight2.position.set(-5, 5, -5);
        scene.add(dirLight2);

        // Controls
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.5;

        // Load OBJ
        const loader = new THREE.OBJLoader();
        loader.load(url, (obj) => {
            // Compute bounding box and center
            const box = new THREE.Box3().setFromObject(obj);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);

            // Normalize scale
            const scale = 0.15 / maxDim;
            obj.scale.set(scale, scale, scale);
            obj.position.sub(center.multiplyScalar(scale));

            // Material
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshPhongMaterial({
                        color: 0x8899aa,
                        specular: 0x5b9cf5,
                        shininess: 80,
                        side: THREE.DoubleSide
                    });
                }
            });

            scene.add(obj);
            controls.target.set(0, 0, 0);

            // Position camera
            camera.position.set(0, maxDim * scale * 1.5, maxDim * scale * 2);
            controls.update();
        });

        // Animation loop
        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        // Resize handling
        const resizeObserver = new ResizeObserver(() => {
            const w = viewerContainer.clientWidth;
            const h = viewerContainer.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });
        resizeObserver.observe(viewerContainer);
    }

    // ── Utilities ─────────────────────────────────────────
    function addLog(message, isError = false) {
        const entry = document.createElement('div');
        entry.className = 'log-entry' + (isError ? ' error' : '');

        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = new Date().toLocaleTimeString();

        const msg = document.createElement('span');
        msg.className = 'log-msg';
        msg.textContent = message;

        entry.appendChild(time);
        entry.appendChild(msg);
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    function resetButton() {
        btnGenerate.disabled = false;
        btnGenerate.classList.remove('loading');
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
})();
