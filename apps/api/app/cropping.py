"""Crops an uploaded image to the rectangle picked in the app's crop editor (Pillow).

The rectangle is in the pixels of the original after the quarter turn (`rotate`, clockwise).
Animated GIF and WebP are cropped frame by frame and keep their frame times and loop; the output
keeps the input's format. The result is scaled down (never up) to fit `max_size`.
"""

import io
from dataclasses import dataclass

from PIL import Image, ImageSequence, UnidentifiedImageError

from app.schemas import ImageCrop

# Decoded pixels across all frames we accept to work on (an 8 MB GIF can unpack to a lot).
MAX_SOURCE_PIXELS = 100_000_000
# The same pixel budget per frame Pillow uses to refuse decompression bombs.
Image.MAX_IMAGE_PIXELS = 50_000_000

_TURNS = {
    90: Image.Transpose.ROTATE_270,  # Pillow's turns are counterclockwise
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}
_DEFAULT_FRAME_MS = 100


class CropError(Exception):
    """The image can't be cropped: unreadable, too big to decode, or the rectangle misses it."""


@dataclass
class Cropped:
    data: bytes
    content_type: str
    ext: str
    width: int
    height: int


def crop(data: bytes, rect: ImageCrop, max_size: tuple[int, int]) -> Cropped:
    try:
        with Image.open(io.BytesIO(data)) as im:
            return _crop(im, rect, max_size)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as err:
        raise CropError("unreadable image") from err


def _crop(im: Image.Image, rect: ImageCrop, max_size: tuple[int, int]) -> Cropped:
    fmt = im.format
    if fmt not in ("PNG", "JPEG", "GIF", "WEBP"):
        raise CropError("unsupported format")
    frames_in = getattr(im, "n_frames", 1)
    if im.width * im.height * frames_in > MAX_SOURCE_PIXELS:
        raise CropError("too many pixels")

    turned_w, turned_h = (im.height, im.width) if rect.rotate in (90, 270) else (im.width, im.height)
    left, top = min(rect.x, turned_w), min(rect.y, turned_h)
    right, bottom = min(rect.x + rect.width, turned_w), min(rect.y + rect.height, turned_h)
    if right <= left or bottom <= top:
        raise CropError("the rectangle is outside the image")
    box = (left, top, right, bottom)
    scale = min(1.0, max_size[0] / (right - left), max_size[1] / (bottom - top))
    size = (max(1, round((right - left) * scale)), max(1, round((bottom - top) * scale)))

    animated = frames_in > 1 and fmt in ("GIF", "WEBP")
    frames: list[Image.Image] = []
    durations: list[int] = []
    for frame in ImageSequence.Iterator(im) if animated else [im]:
        out = frame.convert("RGBA")
        if rect.rotate:
            out = out.transpose(_TURNS[rect.rotate])
        out = out.crop(box)
        if out.size != size:
            out = out.resize(size, Image.Resampling.LANCZOS)
        frames.append(out)
        durations.append(int(frame.info.get("duration") or _DEFAULT_FRAME_MS))

    buffer = io.BytesIO()
    if animated:
        extra: dict[str, object] = {}
        if "loop" in im.info:  # no loop key: the original plays once, and so does the copy
            extra["loop"] = im.info["loop"]
        if fmt == "GIF":
            extra["disposal"] = 2
        else:
            extra["quality"] = 90
        frames[0].save(buffer, fmt, save_all=True, append_images=frames[1:], duration=durations, **extra)
    elif fmt == "JPEG":
        frames[0].convert("RGB").save(buffer, "JPEG", quality=90)
    elif fmt == "WEBP":
        frames[0].save(buffer, "WEBP", quality=90)
    else:
        frames[0].save(buffer, fmt)

    content_type, ext = {
        "PNG": ("image/png", "png"),
        "JPEG": ("image/jpeg", "jpg"),
        "GIF": ("image/gif", "gif"),
        "WEBP": ("image/webp", "webp"),
    }[fmt]
    return Cropped(buffer.getvalue(), content_type, ext, *size)
