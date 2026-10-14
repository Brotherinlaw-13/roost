#!/usr/bin/env python3
"""Writes pet/ghost.json: the roost ghost as a Lottie animation.

Looping segments, chosen by the pet at run time (named markers):
  idle · working · alert · sleep · happy (PR approved / session done) ·
  serious (failed / changes requested) · tired (quota nearly spent)
Colours follow the terminal ghost and Claude Code's dark-daltonized theme:
amber = needs you, blue = good news, red = bad news.
Lottie draws the FIRST shape item on top, so groups are listed front to back.
"""
import json, os

FR, W, H = 30, 140, 150
LENS = [('idle', 90), ('working', 60), ('alert', 60), ('sleep', 120), ('happy', 60), ('serious', 60), ('tired', 120)]
SEG, t = {}, 0
for name, n in LENS:
    SEG[name] = (t, t + n)
    t += n
END = t

rgb = lambda r, g, b, a=1: [r / 255, g / 255, b / 255, a]
BODY = rgb(150, 176, 200)
AMBER = rgb(255, 204, 0)
BLUE = rgb(51, 153, 255)
RED = rgb(255, 102, 102)
EYE = rgb(22, 30, 44)
EASE = {'i': {'x': [0.42], 'y': [1]}, 'o': {'x': [0.58], 'y': [0]}}


def static(v): return {'a': 0, 'k': v}


def seg_anim(per_seg, default):
    """per_seg: {segment: [(frame within segment, value)]} or {'segment=': value};
    other segments hold default. Each segment ends where it starts: it loops alone."""
    keys = []
    for name, _ in LENS:
        a, b = SEG[name]
        pts = per_seg.get(name)
        if pts is None:
            v = per_seg.get(name + '=', default)
            pts = [(0, v), (b - a - 1, v)]
        keys += [(a + rel, v) for rel, v in pts]
    out = []
    for j, (f, v) in enumerate(keys):
        k = {'t': f, 's': v if isinstance(v, list) else [v]}
        if j < len(keys) - 1:
            k.update(EASE)
        out.append(k)
    return {'a': 1, 'k': out}


def hold(values, default):
    return seg_anim({f'{k}=': v for k, v in values.items()}, default)


def tr(p=(0, 0), s=None, r=0, o=100):
    wrap = lambda x: x if isinstance(x, dict) else static(list(x) if isinstance(x, tuple) else x)
    return {'ty': 'tr', 'p': wrap(p), 'a': static([0, 0]), 's': s or static([100, 100]), 'r': wrap(r), 'o': wrap(o)}


def path(vs, ins=None, outs=None, closed=True):
    z = [[0, 0]] * len(vs)
    return {'ty': 'sh', 'ks': static({'v': vs, 'i': ins or z, 'o': outs or z, 'c': closed})}


def fill(color): return {'ty': 'fl', 'c': color if isinstance(color, dict) else static(color), 'o': static(100), 'r': 1}
def stroke(color, w): return {'ty': 'st', 'c': color if isinstance(color, dict) else static(color), 'o': static(100), 'w': static(w), 'lc': 2, 'lj': 2}
def ellipse(c, size): return {'ty': 'el', 'p': static(list(c)), 's': static(list(size))}
def rect(c, size, r=0): return {'ty': 'rc', 'p': static(list(c)), 's': static(list(size)), 'r': static(r)}
def group(items, t=None, name=''): return {'ty': 'gr', 'nm': name, 'it': items + [t or tr()]}


# Body: a dome on top and a three-bump skirt, like the pixel ghost.
d = 17
body_v = [[-30, 24], [-30, -6], [0, -36], [30, -6], [30, 24], [20, 32], [10, 24], [0, 32], [-10, 24], [-20, 32]]
body_i = [[-4, 0], [0, d], [-d, 0], [0, -d], [0, 0], [4, 0], [3, 3], [4, 0], [3, 3], [4, 0]]
body_o = [[0, 0], [0, -d], [d, 0], [0, d], [-3, 3], [-4, 0], [-3, 3], [-4, 0], [-3, 3], [-4, 0]]

colour = hold({'alert': AMBER, 'happy': BLUE, 'serious': RED}, BODY)
jump = [(0, [0, 2]), (10, [0, -14]), (20, [0, 2]), (30, [0, -10]), (40, [0, 2]), (59, [0, 2])]
bob = seg_anim({
    'idle': [(0, [0, 3]), (45, [0, -3]), (89, [0, 3])],
    'working': [(0, [0, 2]), (15, [0, -4]), (30, [0, 2]), (45, [0, -4]), (59, [0, 2])],
    'alert': jump,
    'sleep': [(0, [0, 3]), (60, [0, 1]), (119, [0, 3])],
    'happy': [(0, [0, 2]), (8, [0, -16]), (16, [0, 2]), (24, [0, -12]), (32, [0, 2]), (59, [0, 2])],
    'serious': [(0, [0, 2]), (5, [-3, 2]), (10, [3, 2]), (15, [-3, 2]), (20, [3, 2]), (25, [0, 2]), (59, [0, 2])],
    'tired': [(0, [0, 6]), (60, [0, 8]), (119, [0, 6])],
}, [0, 2])
squash_jump = [(0, [100, 100]), (6, [94, 108]), (14, [104, 96]), (20, [100, 100]), (26, [96, 105]), (34, [103, 97]), (40, [100, 100]), (59, [100, 100])]
squash = seg_anim({'alert': squash_jump, 'happy': squash_jump, 'tired=': [106, 93]}, [100, 100])

blink = seg_anim({
    'idle': [(0, [100, 100]), (66, [100, 100]), (69, [100, 8]), (72, [100, 100]), (89, [100, 100])],
    'working': [(0, [100, 100]), (35, [100, 100]), (38, [100, 8]), (41, [100, 100]), (59, [100, 100])],
    'alert=': [110, 115], 'sleep=': [100, 8], 'happy=': [115, 22], 'serious=': [100, 65],
    'tired': [(0, [100, 45]), (80, [100, 45]), (90, [100, 8]), (100, [100, 45]), (119, [100, 45])],
}, [100, 100])
look = seg_anim({'working': [(0, [0, 0]), (8, [-3, 0]), (22, [-3, 0]), (30, [3, 0]), (50, [3, 0]), (59, [0, 0])],
                 'tired=': [0, 2]}, [0, 0])
sway = lambda side: seg_anim({
    'idle': [(0, 0), (45, 4), (89, 0)],
    'working': [(0, 0), (10, -8), (20, 8), (30, -8), (40, 8), (59, 0)],
    'alert': [(0, 0), (5, -14), (10, 14), (15, -12), (20, 12), (30, 0), (59, 0)],
    'sleep': [(0, 0), (60, 3), (119, 0)],
    'happy': [(0, 0), (8, -side * 18), (16, 0), (24, -side * 14), (32, 0), (59, 0)],
    'serious=': side * 10,
    'tired=': side * 35,
}, 0)

eye = lambda x: group([group([ellipse((1.5, -2.5), (2.6, 2.6)), fill(rgb(255, 255, 255, 0.9))]), ellipse((0, 0), (8, 11)), fill(EYE)],
                      tr((x, -4), s=blink), name='eye')
eyes = group([eye(-10), eye(10)], tr(p=look), name='eyes')
brow = lambda side: group([path([[side * 5, -2], [-side * 4, 2]], closed=False), stroke(EYE, 2.4)], tr((side * 10, -13)))
brows = group([brow(-1), brow(1)], tr(o=hold({'serious': 100}, 0)), name='brows')
antenna = lambda side: group([
    path([[0, 0], [side * 5, -14]], closed=False), stroke(colour, 3),
    group([ellipse((side * 5, -16), (6, 6)), fill(colour)]),
], tr((side * 12, -33), r=sway(side)), name='antenna')
body = group([path(body_v, body_i, body_o), fill(colour)], name='body')

zee = lambda x, y, s: [path([[x, y], [x + s, y], [x, y + s], [x + s, y + s]], closed=False), stroke(rgb(200, 210, 230), 2)]
zzz = group([group(zee(26, -44, 7)), group(zee(36, -56, 5))],
            tr(p=seg_anim({'sleep': [(0, [0, 4]), (119, [4, -6])]}, [0, 0]),
               o=seg_anim({'sleep': [(0, 0), (15, 100), (100, 100), (119, 0)]}, 0)), name='zzz')
drop = path([[0, -5], [3.5, 1.5], [0, 4], [-3.5, 1.5]], [[0, 0], [0, -3], [2, 0], [0, 2]], [[0, 3], [0, 2], [-2, 0], [0, -3]])
sweat = group([drop, fill(rgb(150, 200, 255))],
              tr(p=seg_anim({'tired': [(0, [26, -22]), (59, [27, -10]), (60, [26, -22]), (119, [27, -10])]}, [26, -22]),
                 s=static([140, 140]),
                 o=seg_anim({'tired': [(0, 0), (10, 100), (50, 100), (59, 0), (60, 0), (70, 100), (110, 100), (119, 0)]}, 0)),
              name='sweat')

layer = lambda ind, nm, p, shapes: {
    'ddd': 0, 'ind': ind, 'ty': 4, 'nm': nm, 'sr': 1, 'ip': 0, 'op': END, 'st': 0, 'bm': 0,
    'ks': {'o': static(100), 'r': static(0), 'p': static([W / 2, p, 0]), 'a': static([0, 0, 0]), 's': static([100, 100, 100])},
    'shapes': shapes}
shadow_jump = [(0, [100, 100]), (10, [70, 70]), (20, [100, 100]), (30, [78, 78]), (40, [100, 100]), (59, [100, 100])]
shadow_scale = seg_anim({'alert': shadow_jump, 'happy': shadow_jump}, [100, 100])
# The ghost sits 8px lower than the canvas centre: a jump must stay inside the
# canvas, or the canvas renderer leaves a row of it in later frames.
doc = {'v': '5.7.4', 'fr': FR, 'ip': 0, 'op': END, 'w': W, 'h': H, 'nm': 'roost ghost', 'ddd': 0, 'assets': [],
       'layers': [layer(1, 'ghost', H / 2 + 8, [group([zzz, sweat, brows, eyes, body, antenna(-1), antenna(1)], tr(p=bob, s=squash), name='ghost')]),
                  layer(2, 'shadow', H / 2 + 52, [group([ellipse((0, 0), (46, 8)), fill([0, 0, 0, 1])], tr(s=shadow_scale, o=22))])],
       'markers': [{'tm': a, 'cm': name, 'dr': b - a} for name, (a, b) in SEG.items()]}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ghost.json')
json.dump(doc, open(out, 'w'), separators=(',', ':'))
print('wrote', out, os.path.getsize(out), 'bytes')
