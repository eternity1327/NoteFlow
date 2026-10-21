import difflib
import json
import re
from datetime import datetime
from pathlib import Path

from hyperon import MeTTa

from composer import FEATURES, GENRES, MOODS, tempo_band

ROOT = Path(__file__).parent
METTA_DIR = ROOT / "metta"
DATA_DIR = ROOT / "data"
VERDICTS = ("like", "dislike", "keep")


def pref_line(kind, value, weight):
    return f"(pref {kind} {value} {weight})"


def diff(old, new):
    return [line for line in difflib.ndiff(old.splitlines(), new.splitlines()) if line[:1] in "+-"]


def percentages(points):
    total = sum(points)
    if not total:
        return [0] * len(points)
    raw = [p * 100 / total for p in points]
    result = [int(r) for r in raw]
    order = sorted(range(len(raw)), key=lambda i: raw[i] - result[i], reverse=True)
    for i in order[: 100 - sum(result)]:
        result[i] += 1
    return result


def as_args(features):
    return " ".join(features[k] for k in FEATURES)


class Agent:
    def __init__(self, data_dir=DATA_DIR):
        self.data_dir = Path(data_dir)
        self.metta = MeTTa()
        for name in ("logic", "hints", "changes", "splits"):
            self.metta.run((METTA_DIR / f"{name}.metta").read_text())
        self.profile = None
        self.seed_text = ""
        self.history = []
        self.shaped_by = {}
        if self.setup_file.exists():
            self.calibrate(**json.loads(self.setup_file.read_text()))
            if self.learned_file.exists():
                self.load(self.learned_file.read_text())
                self.record("restore", "Restored saved learning", {})

    @property
    def setup_file(self):
        return self.data_dir / "setup.json"

    @property
    def learned_file(self):
        return self.data_dir / "learned.metta"

    def ask(self, expr):
        return self.metta.run(f"!{expr}")[0]

    def number(self, expr):
        return int(str(self.ask(expr)[0]))

    def stance(self, weight):
        return str(self.ask(f"(stance {weight})")[0]) if weight else "neutral"

    def load(self, text):
        self.ask("(forget-all)")
        self.metta.run(text)

    def prefs(self):
        found = self.ask("(collapse (match &self (pref $k $v $w) ($k $v $w)))")[0].get_children()
        rows = [[str(x) for x in atom.get_children()] for atom in found]
        return {(k, v): int(w) for k, v, w in rows}

    def rules(self):
        return [
            {"kind": k, "value": v, "weight": w, "stance": self.stance(w)}
            for (k, v), w in sorted(self.prefs().items())
        ]

    def render(self):
        rules = self.rules()
        prefs = [pref_line(r["kind"], r["value"], r["weight"]) for r in rules]
        beliefs = sorted(f"({r['stance']} {r['kind']} {r['value']})" for r in rules)
        return "\n".join(prefs + [""] + beliefs)

    def save(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.setup_file.write_text(json.dumps(self.profile))
        self.learned_file.write_text("".join(pref_line(k, v, w) + "\n" for (k, v), w in sorted(self.prefs().items())))

    def calibrate(self, name, genre, mood, bpm):
        if genre not in GENRES or mood not in MOODS or not 60 <= int(bpm) <= 180:
            raise ValueError("Unknown genre, mood, or tempo")
        self.profile = {"name": name.strip() or "You", "genre": genre, "mood": mood, "bpm": int(bpm)}
        self.ask(f"(setup {genre} {mood} {tempo_band(int(bpm))})")
        self.seed_text = self.render()
        self.history = []
        self.shaped_by = {key: "Your preferences" for key in self.prefs()}
        self.record("setup", f"Calibrated from preferences: {GENRES[genre]}, {MOODS[mood]}, {int(bpm)} BPM", {})

    def setup(self, name, genre, mood, bpm):
        self.calibrate(name, genre, mood, bpm)
        self.save()

    def reset(self):
        self.setup(**self.profile)

    def score(self, features):
        return self.number(f"(score {as_args(features)})")

    def explain(self, features):
        reasons = []
        for kind in FEATURES:
            value = features[kind]
            weight = self.number(f"(feature-score {kind} {value})")
            reasons.append({
                "kind": kind,
                "value": value,
                "weight": weight,
                "stance": self.stance(weight),
                "shaped_by": self.shaped_by.get((kind, value)),
            })
        return reasons

    def focus(self, features):
        self.ask("(forget-idea)")
        self.metta.run("\n".join(f"(idea-has {k} {features[k]})" for k in FEATURES))

    def changes(self, before, label):
        after = self.prefs()
        result = []
        for key in sorted(set(before) | set(after)):
            old, new = before.get(key, 0), after.get(key, 0)
            if old != new:
                self.shaped_by[key] = label
                result.append({
                    "kind": key[0],
                    "value": key[1],
                    "from": old,
                    "to": new,
                    "from_stance": self.stance(old),
                    "to_stance": self.stance(new),
                })
        return result

    def learn(self, features, kind, label, commands, extra):
        self.focus(features)
        before = self.prefs()
        for command in commands:
            self.ask(command)
        changes = self.changes(before, label)
        self.save()
        return self.record(kind, label, extra | {"changes": changes})

    def rate(self, features, verdict, label, extra):
        if verdict not in VERDICTS:
            raise ValueError(f"Unknown verdict: {verdict}")
        return self.learn(features, verdict, label, [f"(rate {verdict})"], extra)

    def request(self, features, requests, label, extra):
        known = self.requests()
        if not requests or any(r not in known for r in requests):
            raise ValueError("Unknown change request")
        return self.learn(features, "request", label, [f"(request {r})" for r in requests], extra)

    def requests(self):
        found = self.ask("(collapse (match &self (request-label $r $l) ($r $l)))")[0].get_children()
        pairs = [atom.get_children() for atom in found]
        return {str(r): str(l).strip('"') for r, l in pairs}

    def parse_request(self, text):
        found = []
        for word in re.findall(r"[a-z]+", text.lower()):
            for atom in self.ask(f"(collapse (match &self (keyword {word} $r) $r))")[0].get_children():
                if str(atom) not in found:
                    found.append(str(atom))
        return found

    def record(self, kind, label, extra):
        text = self.render()
        previous = self.history[-1]["text"] if self.history else text
        entry = {
            "version": len(self.history),
            "kind": kind,
            "label": label,
            "time": datetime.now().isoformat(timespec="seconds"),
            "text": text,
            "count": len(self.prefs()),
            "diff": diff(previous, text),
            "changes": [],
        } | extra
        self.history.append(entry)
        return entry

    def state(self):
        if not self.profile:
            return {"ready": False}
        last = self.history[-1]
        return {
            "ready": True,
            "profile": self.profile,
            "version": last["version"],
            "rules_text": last["text"],
            "seed_text": self.seed_text,
            "rule_count": last["count"],
            "seed_count": self.history[0]["count"],
            "since_setup": diff(self.seed_text, last["text"]),
            "history": [{k: v for k, v in h.items() if k != "text"} for h in self.history],
        }

    def roles(self):
        found = self.ask("(collapse (match &self (role-share $r $p) ($r $p)))")[0].get_children()
        pairs = [atom.get_children() for atom in found]
        return {str(r): int(str(p)) for r, p in pairs}

    def split_sheet(self, contributors):
        known = self.roles()
        people = {}
        for person in contributors:
            if not isinstance(person, dict):
                continue
            name = str(person.get("name", "")).strip()
            roles = [r for r in person.get("roles") or [] if isinstance(r, str) and r in known]
            if name and roles:
                people.setdefault(name, set()).update(roles)
        names = list(people)
        points = [self.number(f"(points ({' '.join(sorted(people[n]))}))") for n in names]
        return [
            {"name": n, "roles": sorted(people[n]), "points": p, "percent": s}
            for n, p, s in zip(names, points, percentages(points))
        ]
