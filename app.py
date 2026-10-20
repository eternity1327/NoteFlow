import random

from flask import Flask, jsonify, request

import composer
from agent import Agent

CANDIDATES = 12
EXPLORE_RATE = 0.15
VERDICT_LABELS = {"like": "Liked", "dislike": "Disliked", "keep": "Kept for the song"}

app = Flask(__name__, static_folder="static", static_url_path="")
app.json.sort_keys = False
agent = Agent()
ideas = {}
song = []


def options():
    return {
        "genres": composer.GENRES,
        "moods": composer.MOODS,
        "requests": agent.requests(),
        "roles": agent.roles(),
    }


def current_state():
    return agent.state() | {"song": song, "options": options()}


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
    preferred = agent.profile["bpm"]
    candidates = [composer.new_idea(preferred_bpm=preferred, fixed=fixed, avoid=avoid) for _ in range(CANDIDATES)]
    explored = explore and random.random() < EXPLORE_RATE
    idea = random.choice(candidates) if explored else max(candidates, key=lambda i: agent.score(i["features"]))
    ideas[idea["id"]] = idea
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


def who(body):
    return str(body.get("who") or "").strip() or agent.profile["name"]


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/state")
def state():
    return jsonify(current_state() if agent.profile else {"ready": False, "options": options()})


@app.post("/api/setup")
def setup():
    body = request.get_json()
    try:
        agent.setup(body.get("name", ""), body.get("genre"), body.get("mood"), int(body.get("bpm", 0)))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify({"state": current_state(), "suggestion": compose(explore=False)})


@app.post("/api/suggest")
def suggest():
    if not agent.profile:
        return jsonify({"error": "Set your preferences first"}), 400
    return jsonify(compose())


@app.post("/api/feedback")
def feedback():
    body = request.get_json()
    idea = ideas.get(body.get("id"))
    verdict = body.get("verdict")
    if not idea or verdict not in VERDICT_LABELS:
        return jsonify({"error": "Unknown idea or verdict"}), 400
    person = who(body)
    if verdict == "keep":
        song.append({"who": person, "summary": composer.summary(idea), "idea": idea})
    extra = {"who": person, "before": composer.summary(idea)}
    entry = agent.rate(idea["features"], verdict, f"{VERDICT_LABELS[verdict]} by {person}", extra)
    return after_learning(entry, explore=True)


@app.post("/api/request")
def change_request():
    body = request.get_json()
    idea = ideas.get(body.get("id"))
    if not idea:
        return jsonify({"error": "Unknown idea"}), 400
    text = str(body.get("text") or "").strip()
    wanted = list(body.get("changes") or []) + (agent.parse_request(text) if text else [])
    labels = agent.requests()
    wanted = [w for i, w in enumerate(wanted) if w in labels and w not in wanted[:i]]
    if not wanted:
        hint = ", ".join(labels.values())
        return jsonify({"error": f"I couldn't match that to a change yet. Try: {hint}."}), 400
    person = who(body)
    names = ", ".join(labels[w] for w in wanted)
    extra = {"who": person, "before": composer.summary(idea), "quote": text or None}
    entry = agent.request(idea["features"], wanted, f"Asked by {person}: {names}", extra)
    return after_learning(entry, False, *steer(entry["changes"]))


@app.post("/api/reset")
def reset():
    if not agent.profile:
        return jsonify({"error": "Set your preferences first"}), 400
    agent.reset()
    return jsonify({"state": current_state(), "suggestion": compose(explore=False)})


@app.post("/api/splits")
def splits():
    body = request.get_json()
    return jsonify({"rows": agent.split_sheet(body.get("contributors", []))})


if __name__ == "__main__":
    app.run(port=5000, threaded=False)
