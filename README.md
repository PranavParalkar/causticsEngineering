# Caustics Engineering

This repo is for generating 3D surface meshes that project caustic images. It is written in Julia.

See the write-up [here](https://mattferraro.dev/posts/caustics-engineering)!

## Prerequisites

- **Julia**: You need Julia installed on your system and available in your PATH.
- **Node.js**: Required if you want to use the Web UI.

## How to Run

There are three ways to use this project: via the interactive Web UI, the command-line interface (CLI), or through the original script.

### 1. Web UI (Recommended)

The project includes a web interface that allows you to upload an image and tweak settings to generate the corresponding OBJ file.

1. Navigate to the `web` directory:
   ```bash
   cd web
   ```
2. Install the Node.js dependencies:
   ```bash
   npm install
   ```
3. Start the web server:
   ```bash
   npm start
   ```
4. Open your browser and go to `http://localhost:3000`.

### 2. Command Line Interface (CLI)

You can run the caustics generation via a headless CLI wrapper without starting the web server.

**Usage:**
```bash
julia caustics_cli.jl <input_image> <output.obj> [--width N] [--artifact-size F] [--focal-length F] [--iterations N]
```

**Example:**
```bash
julia caustics_cli.jl ./examples/cat_posing.jpg output.obj --width 200 --iterations 4
```

### 3. Original Hardcoded Example

To run the simple cat example from the blogpost (the image file is hard-coded in `run.jl`):

```bash
julia ./run.jl
```
_Alternatively, run line by line from `src/scratchpad.jl`._
