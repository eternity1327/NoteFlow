import pytest

import app as server

SETUP = {"name": "Gian", "genre": "lofi", "mood": "dark", "bpm": 80}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA_DIR", tmp_path)
    server.sessions.clear()
    return server.app.test_client()


def test_each_visitor_gets_their_own_agent(client):
    other = server.app.test_client()
    assert client.get("/api/state").json["ready"] is False
    assert client.post("/api/setup", json=SETUP).json["state"]["ready"] is True
    assert other.get("/api/state").json["ready"] is False
    assert len(server.sessions) == 2


def test_feedback_learns_and_returns_next_idea(client):
    idea = client.post("/api/setup", json=SETUP).json["suggestion"]["idea"]
    result = client.post("/api/request", json={"id": idea["id"], "changes": ["darker"]}).json
    assert result["entry"]["changes"]
    assert result["suggestion"]["idea"]["key"].endswith("minor")


def test_old_sessions_are_dropped(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_SESSIONS", 2)
    for _ in range(3):
        server.app.test_client().get("/api/state")
    assert len(server.sessions) == 2


def test_bad_input_is_rejected(client):
    assert client.post("/api/setup", json={"genre": "metal"}).status_code == 400
    assert client.post("/api/feedback", data="not json").status_code == 400
    assert client.post("/api/splits", json={"contributors": "x"}).status_code == 400
    assert client.post("/api/splits", json={"contributors": [1, {"name": "A", "roles": [["x"]]}]}).status_code == 200
