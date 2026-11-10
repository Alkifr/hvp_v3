import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image


def find(o):
    if isinstance(o, dict):
        if isinstance(o.get("data"), str) and len(o["data"]) > 1000:
            return o["data"]
        for v in o.values():
            r = find(v)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v)
            if r:
                return r
    return None


def main():
    src, dest = sys.argv[1], sys.argv[2]
    data = json.loads(Path(src).read_text())
    im = Image.open(io.BytesIO(base64.b64decode(find(data))))
    im.crop((0, 0, min(1464, im.size[0]), min(758, im.size[1]))).save(dest)
    print(dest, im.size)


if __name__ == "__main__":
    main()
