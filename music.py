import random
import uuid

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "pentatonic": [0, 2, 4, 7, 9],
}
TEMPOS = {"slow": 72, "medium": 100, "fast": 132}
CONTOURS = ("rising", "falling", "arch")
RHYTHMS = {
    "straight": [0.5] * 8,
    "syncopated": [0.75, 0.25, 0.5, 0.5, 0.75, 0.25, 0.5, 0.5],
}
KEYS = {"C": 60, "D": 62, "E": 64, "F": 65, "G": 67, "A": 57}


def random_features(rng=random):
    return {
        "scale": rng.choice(list(SCALES)),
        "tempo": rng.choice(list(TEMPOS)),
        "contour": rng.choice(CONTOURS),
        "rhythm": rng.choice(list(RHYTHMS)),
    }


def shape(degrees, contour):
    ordered = sorted(degrees)
    if contour == "falling":
        return ordered[::-1]
    if contour == "arch":
        return ordered[::2] + ordered[1::2][::-1]
    return ordered


def to_midi(degree, root, steps):
    octave, step = divmod(degree, len(steps))
    return root + 12 * octave + steps[step]


def new_idea(rng=random):
    features = random_features(rng)
    key = rng.choice(list(KEYS))
    steps = SCALES[features["scale"]]
    degrees = shape(rng.sample(range(len(steps) * 2), 8), features["contour"])
    notes = [
        {"midi": to_midi(d, KEYS[key], steps), "beats": b}
        for d, b in zip(degrees, RHYTHMS[features["rhythm"]])
    ]
    return {
        "id": uuid.uuid4().hex[:8],
        "key": key,
        "bpm": TEMPOS[features["tempo"]],
        "features": features,
        "notes": notes,
    }


def label(idea):
    f = idea["features"]
    return f"{idea['key']} {f['scale']}, {f['tempo']}, {f['contour']}, {f['rhythm']}"
