"""AnimeGANv3 Shinkai stylization via Python subprocess.

Reads input image bytes from --input file, runs ONNX inference,
writes JPEG output to --output file.
Debug copies go to /tmp/anime_stylize_outputs/ for visual inspection.

Args: --input PATH --output PATH --width N --model PATH
"""
import argparse
import os
import sys
import time
import numpy as np
import onnxruntime as ort
from PIL import Image

MIN_DIM = 256
ALIGN = 8


def compute_target_height(orig_w: int, orig_h: int, target_w: int) -> int:
    ratio = orig_h / orig_w
    h = max(int(target_w * ratio), MIN_DIM)
    return ((h + ALIGN - 1) // ALIGN) * ALIGN


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    # Load image
    img = Image.open(args.input).convert("RGB")
    orig_w, orig_h = img.size
    tw = args.width
    th = compute_target_height(orig_w, orig_h, tw)

    resized = img.resize((tw, th), Image.LANCZOS)
    arr = np.asarray(resized, dtype=np.float32)
    arr = (arr / 127.5) - 1.0  # HWC, [-1, 1]

    # Detect input layout (NCHW or NHWC) from model
    session = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    input_shape = session.get_inputs()[0].shape
    is_nchw = len(input_shape) == 4 and input_shape[1] == 3

    if is_nchw:
        tensor = np.transpose(arr, (2, 0, 1))[None, :, :, :]
    else:
        tensor = arr[None, :, :, :]
    tensor = np.ascontiguousarray(tensor, dtype=np.float32)

    outputs = session.run(None, {input_name: tensor})
    out = outputs[0]

    # Output format detection
    if out.ndim == 4:
        if out.shape[1] == 3:
            out = np.transpose(out[0], (1, 2, 0))  # NCHW -> HWC
        else:
            out = out[0]
    out = ((out + 1.0) * 127.5).clip(0, 255).astype(np.uint8)

    output_img = Image.fromarray(out, "RGB")
    final = output_img.resize((orig_w, orig_h), Image.LANCZOS)
    final.save(args.output, "JPEG", quality=95)

    # Debug: save copies for visual inspection (not cleaned up by Rust)
    debug_dir = "/tmp/anime_stylize_outputs"
    os.makedirs(debug_dir, exist_ok=True)
    ts = int(time.time() * 1000)
    debug_path = os.path.join(debug_dir, f"stylized_{ts}_{orig_w}x{orig_h}.jpg")
    final.save(debug_path, "JPEG", quality=95)
    # Also copy the input image for before/after comparison
    import shutil
    shutil.copy2(args.input, os.path.join(debug_dir, f"input_{ts}.jpg"))

    print(f"OK {final.size[0]}x{final.size[1]}", file=sys.stderr)


if __name__ == "__main__":
    main()
