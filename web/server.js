const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve Julia binary — try PATH first, fall back to known install location
let JULIA_BIN = 'julia';
try {
    execSync('julia --version', { stdio: 'ignore' });
} catch {
    const knownPath = path.join(
        process.env.LOCALAPPDATA || '',
        'Programs', 'Julia-1.12.6', 'bin', 'julia.exe'
    );
    if (fs.existsSync(knownPath)) {
        JULIA_BIN = knownPath;
        console.log(`  ℹ  Using Julia at: ${JULIA_BIN}`);
    } else {
        console.warn('  ⚠  Julia not found! Processing will fail. Install Julia and restart.');
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// In-memory job store
const jobs = new Map();

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|bmp|gif|tiff|webp)$/i;
        if (allowed.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Upload endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }

    const jobId = uuidv4();
    const inputPath = req.file.path;
    const outputPath = path.join(OUTPUT_DIR, `${jobId}.obj`);

    // Parse optional settings
    const width = parseInt(req.body.width) || 200;
    const artifactSize = parseFloat(req.body.artifactSize) || 0.1;
    const focalLength = parseFloat(req.body.focalLength) || 0.2;
    const iterations = parseInt(req.body.iterations) || 4;

    const job = {
        id: jobId,
        status: 'queued',
        logs: [],
        inputPath,
        outputPath,
        originalName: req.file.originalname,
        createdAt: Date.now()
    };
    jobs.set(jobId, job);

    // Spawn Julia process
    const projectRoot = path.resolve(__dirname, '..');
    const cliScript = path.join(projectRoot, 'caustics_cli.jl');

    const args = [
        cliScript,
        inputPath,
        outputPath,
        '--width', String(width),
        '--artifact-size', String(artifactSize),
        '--focal-length', String(focalLength),
        '--iterations', String(iterations)
    ];

    console.log(`[Job ${jobId}] Starting: julia ${args.join(' ')}`);
    job.status = 'processing';
    job.logs.push({ time: Date.now(), message: 'Job started — Julia process spawning...' });

    const proc = spawn(JULIA_BIN, args, {
        cwd: projectRoot,
        env: { ...process.env }
    });

    proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
            console.log(`[Job ${jobId}] stdout: ${line}`);
            try {
                const parsed = JSON.parse(line);
                job.logs.push({ time: Date.now(), message: parsed.message || line });
                if (parsed.status === 'done') {
                    job.status = 'done';
                }
            } catch {
                // Non-JSON output from Julia (e.g., debug prints)
                job.logs.push({ time: Date.now(), message: line });
            }
        }
    });

    proc.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
            console.error(`[Job ${jobId}] stderr: ${text}`);
            job.logs.push({ time: Date.now(), message: `[stderr] ${text}` });
        }
    });

    proc.on('close', (code) => {
        console.log(`[Job ${jobId}] Process exited with code ${code}`);
        if (code !== 0 && job.status !== 'done') {
            job.status = 'error';
            job.logs.push({ time: Date.now(), message: `Process exited with code ${code}` });
        } else if (job.status !== 'done') {
            // Check if OBJ file was actually created
            if (fs.existsSync(outputPath)) {
                job.status = 'done';
                job.logs.push({ time: Date.now(), message: 'Processing complete!' });
            } else {
                job.status = 'error';
                job.logs.push({ time: Date.now(), message: 'OBJ file was not generated' });
            }
        }
    });

    proc.on('error', (err) => {
        console.error(`[Job ${jobId}] Spawn error:`, err);
        job.status = 'error';
        job.logs.push({ time: Date.now(), message: `Failed to start Julia: ${err.message}. Is Julia installed and on PATH?` });
    });

    res.json({ jobId, status: 'queued' });
});

// Status endpoint
app.get('/api/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
        id: job.id,
        status: job.status,
        logs: job.logs,
        originalName: job.originalName
    });
});

// Download endpoint
app.get('/api/download/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    if (job.status !== 'done') {
        return res.status(400).json({ error: 'Job not yet complete' });
    }
    if (!fs.existsSync(job.outputPath)) {
        return res.status(404).json({ error: 'Output file not found' });
    }
    const downloadName = path.basename(job.originalName, path.extname(job.originalName)) + '_caustic.obj';
    res.download(job.outputPath, downloadName);
});

// Serve OBJ for Three.js preview
app.get('/api/preview/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.status !== 'done' || !fs.existsSync(job.outputPath)) {
        return res.status(404).json({ error: 'Not available' });
    }
    res.setHeader('Content-Type', 'text/plain');
    res.sendFile(job.outputPath);
});

// Cleanup old jobs (run every 30 minutes)
setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of jobs) {
        if (job.createdAt < oneHourAgo) {
            try { fs.unlinkSync(job.inputPath); } catch { }
            try { fs.unlinkSync(job.outputPath); } catch { }
            jobs.delete(id);
            console.log(`[Cleanup] Removed job ${id}`);
        }
    }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`\n  ✨ Caustics Engineering Web UI`);
    console.log(`  🌐 http://localhost:${PORT}\n`);
});
