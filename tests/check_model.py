"""Verify anonymous asset access without downloading model weights. No dependencies."""

import pathlib
import re
import subprocess
import sys


def main():
    html = (pathlib.Path(__file__).resolve().parent.parent / "index.html").read_text()
    model = re.search(r"const MODEL = '([^']+)'", html).group(1)
    dtype = re.search(r"dtype: '([^']+)'", html).group(1)
    if dtype != "q4":
        raise ValueError("Update this asset check for the newly configured precision")

    files = ["config.json", "tokenizer_config.json", "tokenizer.json", "onnx/model_q4.onnx"]
    for filename in files:
        url = f"https://huggingface.co/{model}/resolve/main/{filename}"
        # curl preserves HEAD across redirects; no credentials or weight bodies.
        result = subprocess.run(
            ["curl", "--head", "--location", "--fail", "--silent", "--show-error",
             "--connect-timeout", "15", "--max-time", "60", "--retry", "2",
             "--output", "/dev/null", url],
            check=False,
        )
        if result.returncode:
            print(f"FAIL: public model asset unavailable: {url}", file=sys.stderr)
            return 1
        print(f"PASS: {url}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
