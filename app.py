import random
import shutil
import uuid
from collections import OrderedDict

from flask import Flask, g, jsonify, request

import composer
from agent import DATA_DIR, Agent

CANDIDATES = 12
EXPLORE_RATE = 0.15
MAX_SESSIONS = 30
COOKIE_AGE = 60 * 60 * 24 * 30
HEX = set("0123456789abcdef")
VERDICT_LABELS = {"like": "Liked", "dislike": "Disliked", "keep": "Kept for the song"}

app = Flask(__name__, static_folder="static", static_url_path="")
app.json.sort_keys = False
sessions = OrderedDict()


class Session:
    def __init__(self, sid):
        self.agent = Agent(DATA_DIR / sid)
        self.ideas = {}
        self.song = []


def open_session(sid):
    if sid not in sessions:
        sessions[sid] = Session(sid)
        while len(sessions) > MAX_SESSIONS:
            old, _ = sessions.popitem(last=False)
            shutil.rmtree(DATA_DIR / old, ignore_errors=True)
    sessions.move_to_end(sid)
    return sessions[sid]


def valid(sid):
    return len(sid) == 32 and set(sid) <= HEX


@app.before_request
def load_session():
    if not request.path.startswith("/api/"):
        return
    sid = request.cookies.get("sid", "")
    g.new_sid = None if valid(sid) else uuid.uuid4().hex
    g.s = open_session(g.new_sid or sid)


@app.after_request
def remember(response):
    if g.get("new_sid"):
        response.set_cookie("sid", g.new_sid, max_age=COOKIE_AGE, httponly=True, samesite="Lax")
    return response


def body():
    return request.get_json(silent=True) or {}


def options():
    return {
        "genres": composer.GENRES,
        "moods": composer.MOODS,
        "requests": g.s.agent.requests(),
        "roles": g.s.agent.roles(),
    }


def current_state():
    return g.s.agent.state() | {"song": g.s.song, "options": options()}


def steer(changes):
    best = {}
    for c in changes:
        step = c["to"] - c["from"]
        if step > 0 and step > best.get(c["kind"], (0, None))[0]:
            best[c["kind"]] = (step, c["value"])
    fixed = {kind: value for kind, (_, value) in best.items()}
    avoid = {(c["kind"], c["value"]) for c in changes if c["to"] < c["from"] and c["kind"] not in fixed}
    return fixed, avoid


def compose(explore=True, fixed=None, avoid=None):
    agent = g.s.agent
    preferred = agent.profile["bpm"]
    candidates = [composer.new_idea(preferred_bpm=preferred, fixed=fixed, avoid=avoid) for _ in range(CANDIDATES)]
    explored = explore and random.random() < EXPLORE_RATE
    idea = random.choice(candidates) if explored else max(candidates, key=lambda i: agent.score(i["features"]))
    g.s.ideas[idea["id"]] = idea
    return describe(idea, explored)


def describe(idea, explored=False):
    agent = g.s.agent
    return {
        "idea": idea,
        "summary": composer.summary(idea),
        "score": agent.score(idea["features"]),
        "reasons": agent.explain(idea["features"]),
        "explored": explored,
        "considered": CANDIDATES,
    }


def after_learning(entry, explore, fixed=None, avoid=None):
    suggestion = compose(explore, fixed, avoid)
    entry["after"] = suggestion["summary"]
    return jsonify({"state": current_state(), "suggestion": suggestion, "entry": entry})


def who(data):
    return str(data.get("who") or "").strip()[:40] or g.s.agent.profile["name"]


def needs_setup():
    return jsonify({"error": "Set your preferences first"}), 400


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/state")
def state():
    return jsonify(current_state() if g.s.agent.profile else {"ready": False, "options": options()})


@app.post("/api/setup")
def setup():
    data = body()
    try:
        g.s.agent.setup(str(data.get("name", ""))[:40], data.get("genre"), data.get("mood"), int(data.get("bpm", 0)))
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
    return jsonify({"state": current_state(), "suggestion": compose(explore=False)})


@app.post("/api/suggest")
def suggest():
    if not g.s.agent.profile:
        return needs_setup()
    return jsonify(compose())


@app.post("/api/feedback")
def feedback():
    data = body()
    idea = g.s.ideas.get(str(data.get("id")))
    verdict = data.get("verdict")
    if not idea or verdict not in VERDICT_LABELS:
        return jsonify({"error": "Unknown idea or verdict"}), 400
    person = who(data)
    if verdict == "keep":
        g.s.song.append({"who": person, "summary": composer.summary(idea), "idea": idea})
    extra = {"who": person, "before": composer.summary(idea), "idea_id": idea["id"]}
    entry = g.s.agent.rate(idea["features"], verdict, f"{VERDICT_LABELS[verdict]} by {person}", extra)
    return after_learning(entry, explore=True)


@app.post("/api/request")
def change_request():
    data = body()
    idea = g.s.ideas.get(str(data.get("id")))
    if not idea:
        return jsonify({"error": "Unknown idea"}), 400
    text = str(data.get("text") or "").strip()[:200]
    agent = g.s.agent
    wanted = [w for w in data.get("changes") or [] if isinstance(w, str)] + (agent.parse_request(text) if text else [])
    labels = agent.requests()
    wanted = [w for i, w in enumerate(wanted) if w in labels and w not in wanted[:i]]
    if not wanted:
        hint = ", ".join(labels.values())
        return jsonify({"error": f"I couldn't match that to a change yet. Try: {hint}."}), 400
    person = who(data)
    names = ", ".join(labels[w] for w in wanted)
    extra = {"who": person, "before": composer.summary(idea), "idea_id": idea["id"], "quote": text or None}
    entry = agent.request(idea["features"], wanted, f"Asked by {person}: {names}", extra)
    return after_learning(entry, False, *steer(entry["changes"]))


@app.post("/api/reset")
def reset():
    if not g.s.agent.profile:
        return needs_setup()
    g.s.agent.reset()
    return jsonify({"state": current_state(), "suggestion": compose(explore=False)})


@app.post("/api/undo")
def undo():
    agent = g.s.agent
    if not agent.profile or not agent.undoable():
        return jsonify({"error": "Nothing to undo"}), 400
    entry = agent.undo()
    if entry["kind"] == "keep" and g.s.song:
        g.s.song.pop()
    idea = g.s.ideas.get(entry.get("idea_id"))
    suggestion = describe(idea) if idea else compose(explore=False)
    return jsonify({"state": current_state(), "suggestion": suggestion, "undone": entry["label"]})


@app.post("/api/splits")
def splits():
    contributors = body().get("contributors", [])
    if not isinstance(contributors, list):
        return jsonify({"error": "Contributors must be a list"}), 400
    return jsonify(g.s.agent.check_split(contributors[:20]))


if __name__ == "__main__":
    app.run(port=5000, threaded=False)
