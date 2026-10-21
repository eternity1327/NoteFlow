import random

import pytest

import composer
from agent import Agent

IDEA = {
    "mood": "melancholic",
    "progression": "dramatic",
    "harmony": "triads",
    "rhythm": "arpeggio",
    "tempo": "fast",
    "structure": "classic",
    "theme": "love",
}


@pytest.fixture
def agent(tmp_path):
    a = Agent(tmp_path)
    a.setup("Gian", "lofi", "dark", 76)
    return a


def test_waits_for_setup(tmp_path):
    assert Agent(tmp_path).state() == {"ready": False}


def test_setup_builds_small_seed_from_preferences(agent):
    prefs = agent.prefs()
    assert prefs[("mood", "dark")] == 2
    assert prefs[("tempo", "slow")] == 2
    assert prefs[("harmony", "extended")] == 1
    assert prefs[("theme", "night")] == 1
    assert agent.state()["seed_count"] == 7


def test_keep_reinforces_every_feature(agent):
    entry = agent.rate(IDEA, "keep", "Kept", {})
    assert agent.score(IDEA) == 14
    assert "+ (pref progression dramatic 2)" in entry["diff"]
    assert len(entry["changes"]) == 7


def test_dislike_lowers_score(agent):
    agent.rate(IDEA, "dislike", "Disliked", {})
    assert agent.score(IDEA) == -7
    assert agent.rules()[0]["stance"] in {"dislikes", "likes", "loves", "avoids"}


def test_change_request_moves_weights_and_explains(agent):
    agent.request(IDEA, ["darker", "slower", "new-lyrics"], "Asked: darker", {})
    prefs = agent.prefs()
    assert prefs[("progression", "dark")] == 3
    assert prefs[("progression", "bright")] == -2
    assert prefs[("tempo", "slow")] == 4
    assert prefs[("theme", "love")] == -2
    reasons = {r["kind"]: r for r in agent.explain(IDEA | {"progression": "dark"})}
    assert reasons["progression"]["stance"] == "loves"
    assert reasons["progression"]["shaped_by"] == "Asked: darker"


def test_parse_request_reads_keywords(agent):
    assert agent.parse_request("Make it sadder, jazzier and faster") == ["darker", "richer", "faster"]
    assert agent.parse_request("hello") == []
    assert agent.parse_request("softer but more energetic") == ["softer", "more-energy"]


def test_unknown_inputs_are_rejected(agent):
    with pytest.raises(ValueError):
        agent.rate(IDEA, "love", "x", {})
    with pytest.raises(ValueError):
        agent.request(IDEA, ["louder"], "x", {})
    with pytest.raises(ValueError):
        agent.setup("Gian", "metal", "dark", 76)


def test_learning_persists_and_resets(tmp_path):
    Agent(tmp_path).setup("Gian", "pop", "happy", 120)
    first = Agent(tmp_path)
    first.rate(IDEA, "like", "Liked", {})
    restored = Agent(tmp_path)
    assert restored.score(IDEA) == first.score(IDEA)
    restored.reset()
    assert restored.prefs() == {k: v for k, v in Agent(tmp_path).prefs().items()}
    assert restored.state()["version"] == 0


def test_split_check_never_invents_shares(agent):
    ok = agent.check_split([
        {"name": "Gian", "roles": ["music", "melody"], "share": 50},
        {"name": "Rufert", "roles": ["lyrics"], "share": 30},
        {"name": "Michael", "roles": ["arrangement"], "share": 20},
    ])
    assert ok == {"total": 100, "status": "complete", "problems": [], "ok": True}
    bad = agent.check_split([{"name": "Gian", "roles": ["music"], "share": 70}, {"name": "", "roles": [], "share": 0}])
    assert bad["status"] == "under" and bad["total"] == 70 and not bad["ok"]
    assert len(bad["problems"]) == 4


def test_undo_restores_rules_and_history(agent):
    before = agent.prefs()
    agent.request(IDEA, ["softer", "more-energy"], "Asked", {})
    assert agent.prefs() != before and agent.state()["can_undo"]
    agent.undo()
    assert agent.prefs() == before
    assert agent.state()["version"] == 0 and not agent.state()["can_undo"]


def test_composer_builds_correct_chords():
    chord = composer.build_chord(0, "major", 4, 4)
    assert chord["name"] == "G7"
    assert composer.build_chord(10, "minor", 5, 5)["name"] == "Gbmaj9"
    idea = composer.new_idea(random.Random(1), preferred_bpm=76)
    assert len(idea["chords"]) == 4
    assert len(idea["lyrics"]) == 4
    assert set(idea["features"]) == set(composer.FEATURES)


def test_composer_honours_requested_and_avoided_values():
    rng = random.Random(2)
    for _ in range(20):
        idea = composer.new_idea(rng, fixed={"progression": "dark"}, avoid={("theme", "love")})
        assert idea["features"]["progression"] == "dark"
        assert idea["features"]["theme"] != "love"
        assert idea["key"].endswith("minor")
