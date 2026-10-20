import random
import uuid

FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SHARP_KEYS = {"major": {7, 2, 9, 4, 11}, "minor": {4, 11, 6, 1, 8}}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}
ROMAN = {
    "major": ["I", "ii", "iii", "IV", "V", "vi", "vii°"],
    "minor": ["i", "ii°", "III", "iv", "v", "VI", "VII"],
}
FUNCTIONS = {
    "major": ["Tonic", "Supertonic", "Mediant", "Subdominant", "Dominant", "Submediant", "Leading tone"],
    "minor": ["Tonic", "Supertonic", "Mediant", "Subdominant", "Dominant", "Submediant", "Subtonic"],
}
PROGRESSIONS = {
    "bright": ("major", [0, 4, 5, 3]),
    "nostalgic": ("major", [0, 5, 3, 4]),
    "jazzy": ("major", [1, 4, 0, 5]),
    "dark": ("minor", [0, 5, 2, 6]),
    "dramatic": ("minor", [0, 3, 6, 5]),
}
HARMONY = {"triads": 3, "sevenths": 4, "extended": 5}
TEMPOS = {"slow": 78, "medium": 100, "fast": 128}
RHYTHMS = ("pad", "syncopated", "arpeggio")
STRUCTURES = {
    "short": [("Verse", 8), ("Chorus", 8), ("Verse", 8), ("Chorus", 8)],
    "classic": [("Intro", 4), ("Verse", 8), ("Pre-chorus", 4), ("Chorus", 8), ("Verse", 8), ("Chorus", 8), ("Bridge", 4), ("Chorus", 8)],
    "build-drop": [("Intro", 4), ("Build", 8), ("Drop", 8), ("Break", 4), ("Build", 8), ("Drop", 8), ("Outro", 4)],
}
GENRES = {"lofi": "Lo-fi", "pop": "Pop", "neosoul": "Neo-soul / R&B", "synthwave": "Synthwave", "cinematic": "Cinematic"}
MOODS = {"happy": "Happy", "melancholic": "Melancholic", "dark": "Dark", "chill": "Chill", "energetic": "Energetic"}
THEMES = {
    "love": ["your hand in mine", "the space between us", "a name I still keep", "two hearts in time"],
    "night": ["the city lights", "the midnight train", "neon in the rain", "the moon on the street"],
    "freedom": ["the open road", "the wind at my back", "a sky with no walls", "the wings I never used"],
    "memories": ["old photographs", "the summer we had", "a song on the radio", "the house we grew up in"],
    "rising": ["the morning sun", "every step I take", "the fire in my chest", "the top of the hill"],
}
FEELINGS = {
    "happy": ["golden", "alive", "brighter", "free"],
    "melancholic": ["fading", "quiet", "blue", "far away"],
    "dark": ["restless", "hollow", "burning", "lost"],
    "chill": ["easy", "slow", "soft", "drifting"],
    "energetic": ["electric", "wild", "louder", "unstoppable"],
}
LINES = [
    "Under {image}, I feel {feeling}",
    "{Image} keeps calling me home",
    "Hold on to {image} tonight",
    "Everything turns {feeling} with {image}",
    "We were {feeling}, we were {feeling2}",
    "Take me back to {image}",
    "Nothing feels {feeling} like {image}",
    "I'm {feeling}, I'm {feeling2}, I'm here",
]
TRIADS = {(4, 7): "", (3, 7): "m", (3, 6): "dim", (4, 8): "aug"}
SEVENTHS = {(4, 7, 11): "maj7", (4, 7, 10): "7", (3, 7, 10): "m7", (3, 6, 10): "m7b5", (3, 7, 11): "mMaj7"}
FEATURES = {
    "mood": list(MOODS),
    "progression": list(PROGRESSIONS),
    "harmony": list(HARMONY),
    "rhythm": list(RHYTHMS),
    "tempo": list(TEMPOS),
    "structure": list(STRUCTURES),
    "theme": list(THEMES),
}


def tempo_band(bpm):
    if bpm < 90:
        return "slow"
    if bpm < 115:
        return "medium"
    return "fast"


def quality(intervals):
    if len(intervals) == 3:
        return TRIADS[tuple(intervals[1:])]
    name = SEVENTHS[tuple(intervals[1:4])]
    if len(intervals) == 4:
        return name
    return name.replace("7", "9", 1) if intervals[4] == 14 else name + "(b9)"


def spelling(key, mode):
    return SHARPS if key in SHARP_KEYS[mode] else FLATS


def build_chord(key, mode, degree, size):
    names = spelling(key, mode)
    scale = SCALES[mode]
    steps = [scale[(degree + 2 * i) % 7] + 12 * ((degree + 2 * i) // 7) for i in range(size)]
    intervals = [s - steps[0] for s in steps]
    root = key + steps[0]
    base = 48 + root % 12
    if base > 54:
        base -= 12
    midi = [base + i for i in intervals]
    return {
        "name": names[root % 12] + quality(intervals),
        "roman": ROMAN[mode][degree],
        "function": FUNCTIONS[mode][degree],
        "midi": midi,
        "notes": [names[m % 12] + str(m // 12 - 1) for m in midi],
    }


def lyrics(theme, mood, rng):
    lines = []
    for template in rng.sample(LINES, 4):
        image = rng.choice(THEMES[theme])
        feeling, feeling2 = rng.sample(FEELINGS[mood], 2)
        lines.append(template.format(image=image, Image=image[0].upper() + image[1:], feeling=feeling, feeling2=feeling2))
    return lines


def pick(kind, values, fixed, avoid, rng):
    if kind in fixed:
        return fixed[kind]
    allowed = [v for v in values if (kind, v) not in avoid]
    return rng.choice(allowed or values)


def new_idea(rng=random, preferred_bpm=None, fixed=None, avoid=None):
    features = {kind: pick(kind, values, fixed or {}, avoid or set(), rng) for kind, values in FEATURES.items()}
    mode, degrees = PROGRESSIONS[features["progression"]]
    key = rng.randrange(12)
    bpm = TEMPOS[features["tempo"]]
    if preferred_bpm and tempo_band(preferred_bpm) == features["tempo"]:
        bpm = preferred_bpm
    return {
        "id": uuid.uuid4().hex[:8],
        "key": f"{spelling(key, mode)[key]} {mode}",
        "bpm": bpm,
        "features": features,
        "chords": [build_chord(key, mode, d, HARMONY[features["harmony"]]) for d in degrees],
        "structure": [{"section": s, "bars": b} for s, b in STRUCTURES[features["structure"]]],
        "lyrics": lyrics(features["theme"], features["mood"], rng),
    }


def summary(idea):
    chords = " → ".join(c["name"] for c in idea["chords"])
    return f"{chords} · {idea['key']} · {idea['bpm']} BPM"
