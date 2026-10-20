from uuid import uuid4
import os
import psycopg
from datetime import datetime, timedelta, timezone

from api.tests.conftest import register


def test_history_requires_identity_and_internal_service_secret(client):
    assert client.get("/api/me/stats").status_code == 401
    assert client.post("/internal/instances", json={"instanceId": str(uuid4())}).status_code == 401
    account = register(client)
    stats = client.get("/api/me/stats").json()
    assert stats["participated"] == 0
    assert stats["winRate"] is None
    assert client.get("/api/me/matches").json()["items"] == []
    assert account["user"]["id"]


def test_result_is_idempotent_and_no_winner_is_not_a_loss(client):
    account = register(client)
    headers = {"Authorization": "Bearer " + os.environ["INTERNAL_API_SECRET"]}
    instance, room, match, player = [str(uuid4()) for _ in range(4)]
    assert client.post("/internal/instances", headers=headers, json={"instanceId": instance}).status_code == 200
    assert client.post("/internal/rooms", headers=headers, json={"roomId": room, "code": "ABCDEF", "instanceId": instance, "createdByUserId": account["user"]["id"], "isPublic": True, "createdAt": "2026-10-20T00:00:00Z"}).status_code == 200
    players = [{"playerId": player, "userId": account["user"]["id"], "displayName": "目擊者"}]
    for index in range(2):
        identity = register(client, f"other{index}@example.com", f"其他{index}")["user"]
        players.append({"playerId": str(uuid4()), "userId": identity["id"], "displayName": identity["displayName"]})
    client.post("/api/auth/login", json={"email": "player@example.com", "password": "Test-Password123!"})
    start = {"matchId": match, "roomId": room, "roundNumber": 1, "level": "L1", "startedAt": "2026-10-20T00:00:00Z", "players": players}
    assert client.post("/internal/matches", headers=headers, json=start).status_code == 200
    result = {"endedAt": "2026-10-20T00:10:00Z", "winningFaction": "witness_faction", "winningPlayerIds": [], "reason": "無獲勝者", "assignments": [{"playerId": entry["playerId"], "roleId": "guest", "factionId": "witness_faction", "locationId": location} for entry, location in zip(players, ["lounge", "gallery", "study"])]}
    for _ in range(2):
        assert client.put(f"/internal/matches/{match}/result", headers=headers, json=result).status_code == 200
    stats = client.get("/api/me/stats").json()
    assert (stats["participated"], stats["completed"], stats["noWinner"], stats["losses"]) == (1, 1, 1, 0)
    assert stats["totalPlaySeconds"] == 600
    result["winningPlayerIds"] = [player]
    assert client.put(f"/internal/matches/{match}/result", headers=headers, json=result).status_code == 409


def test_win_loss_no_winner_abandoned_and_active_statistics(client):
    owner = register(client)["user"]
    identities = [owner] + [register(client, f"friend{index}@example.com", f"朋友{index}")["user"] for index in range(2)]
    client.post("/api/auth/login", json={"email":"player@example.com", "password":"Test-Password123!"})
    headers = {"Authorization": "Bearer " + os.environ["INTERNAL_API_SECRET"]}
    instance, room = str(uuid4()), str(uuid4())
    client.post("/internal/instances", headers=headers, json={"instanceId": instance})
    timestamp = datetime(2026, 10, 20, tzinfo=timezone.utc)
    client.post("/internal/rooms", headers=headers, json={"roomId":room, "code":"STATS1", "instanceId":instance, "createdByUserId":owner["id"], "isPublic":False, "createdAt":timestamp.isoformat()})
    players = [{"playerId":str(uuid4()),"userId":identity["id"],"displayName":identity["displayName"]} for identity in identities]
    for round_number, outcome in enumerate(["win", "win", "loss", "no_winner", "abandoned", "pending"], start=1):
        match = str(uuid4())
        started = timestamp + timedelta(minutes=round_number*2)
        result = client.post("/internal/matches", headers=headers, json={"matchId":match,"roomId":room,"roundNumber":round_number,"level":"L1","startedAt":started.isoformat(),"players":players})
        assert result.status_code == 200, result.text
        if outcome == "pending":
            continue
        if outcome == "abandoned":
            assert client.put(f"/internal/matches/{match}/abandon", headers=headers, json={"endedAt":(started+timedelta(minutes=1)).isoformat(),"reason":"測試中斷"}).status_code == 200
        else:
            winners = [] if outcome == "no_winner" else [players[0 if outcome == "win" else 1]["playerId"]]
            payload = {"endedAt":(started+timedelta(minutes=1)).isoformat(),"winningFaction":"witness_faction","winningPlayerIds":winners,"reason":"測試結算","assignments":[{"playerId":player["playerId"],"roleId":"guest","factionId":"witness_faction","locationId":location} for player, location in zip(players,["lounge","gallery","study"])]}
            assert client.put(f"/internal/matches/{match}/result", headers=headers, json=payload).status_code == 200
    stats = client.get("/api/me/stats").json()
    assert [stats[key] for key in ["participated","completed","wins","losses","noWinner","abandoned","inProgress"]] == [6,4,2,1,1,1,1]
    assert stats["winRate"] == 2/3
    assert stats["currentWinStreak"] == 0
    assert stats["bestWinStreak"] == 2
    assert stats["totalPlaySeconds"] == 300
    assert stats["averageCompletedSeconds"] == 60
