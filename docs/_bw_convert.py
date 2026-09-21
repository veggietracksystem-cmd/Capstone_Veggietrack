import sys
import numpy as np
from PIL import Image
from scipy import ndimage

def composite(im):
    im = im.convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, im).convert('RGB')

def convert(path_in, path_out, threshold=150, erase_boxes=None):
    im = Image.open(path_in)
    im = composite(im)
    arr = np.array(im).astype(np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    maxc = arr.max(axis=2)
    minc = arr.min(axis=2)
    sat = np.where(maxc > 0, (maxc - minc) / np.maximum(maxc, 1e-5), 0)

    green_dominant = (g > r + 15) & (g > b + 15)
    green_mask = green_dominant & (sat > 0.4) & (lum < 200) & (lum > 30)

    opened = ndimage.binary_opening(green_mask, structure=np.ones((5, 5)))
    lbl, n = ndimage.label(opened)
    sizes = ndimage.sum(opened, lbl, range(1, n + 1))

    base_black = lum < threshold
    out_black = base_black.copy()
    boxes = []
    for i in range(1, n + 1):
        if sizes[i - 1] < 600:
            continue
        ys, xs = np.where(lbl == i)
        x0, x1 = max(xs.min() - 3, 0), min(xs.max() + 4, arr.shape[1])
        y0, y1 = max(ys.min() - 3, 0), min(ys.max() + 4, arr.shape[0])
        boxes.append((x0, x1, y0, y1))
        region_green = green_mask[y0:y1, x0:x1]
        out_black[y0:y1, x0:x1] = ~region_green

    out = np.where(out_black, 0, 255).astype(np.uint8)

    if erase_boxes:
        for (x0, x1, y0, y1) in erase_boxes:
            out[y0:y1, x0:x1] = 255

    Image.fromarray(out).save(path_out)
    return boxes

if __name__ == '__main__':
    b = convert(sys.argv[1], sys.argv[2])
    print('green boxes:', b)
