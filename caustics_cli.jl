#!/usr/bin/env julia
# Caustics CLI — headless wrapper for the caustics engineering pipeline
# Usage: julia caustics_cli.jl <input_image> <output.obj> [--width N] [--artifact-size F] [--focal-length F] [--iterations N]

using Pkg
Pkg.activate(@__DIR__)

using Images, CausticsEngineering

function parse_args(args)
    input_path = nothing
    output_path = nothing
    width = 200
    artifact_size = 0.1
    focal_length = 0.2
    iterations = 4

    i = 1
    while i <= length(args)
        arg = args[i]
        if arg == "--width" && i < length(args)
            i += 1
            width = parse(Int, args[i])
        elseif arg == "--artifact-size" && i < length(args)
            i += 1
            artifact_size = parse(Float64, args[i])
        elseif arg == "--focal-length" && i < length(args)
            i += 1
            focal_length = parse(Float64, args[i])
        elseif arg == "--iterations" && i < length(args)
            i += 1
            iterations = parse(Int, args[i])
        elseif input_path === nothing
            input_path = arg
        elseif output_path === nothing
            output_path = arg
        end
        i += 1
    end

    if input_path === nothing || output_path === nothing
        println(stderr, "Usage: julia caustics_cli.jl <input_image> <output.obj> [--width N] [--artifact-size F] [--focal-length F] [--iterations N]")
        exit(1)
    end

    return (input_path=input_path, output_path=output_path, width=width,
            artifact_size=artifact_size, focal_length=focal_length, iterations=iterations)
end

function main()
    opts = parse_args(ARGS)

    println("{\"status\":\"processing\",\"step\":\"loading\",\"message\":\"Loading image: $(opts.input_path)\"}")
    flush(stdout)

    img = Images.load(opts.input_path)
    orig_w, orig_h = size(img)

    # Resize to target width while maintaining aspect ratio
    target_w = opts.width
    target_h = round(Int, orig_h * (target_w / orig_w))

    println("{\"status\":\"processing\",\"step\":\"resize\",\"message\":\"Resizing from $(orig_w)x$(orig_h) to $(target_w)x$(target_h)\"}")
    flush(stdout)

    img_resized = imresize(img, (target_w, target_h))

    engineer_caustics(
        img_resized;
        output_path=opts.output_path,
        artifact_size=opts.artifact_size,
        focal_length=opts.focal_length,
        iterations=opts.iterations
    )
end

main()
