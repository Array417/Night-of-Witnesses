import hmac
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AwareDatetime, Field
from psycopg.types.json import Jsonb

from api.auth import Payload
from api.config import settings
from api.database import connect
from api.security import resolve_user_session


def require_service(request: Request):
    expected = "Bearer " + settings().internal_secret
    if not hmac.compare_digest(request.headers.get("Authorization", "").encode(), expected.encode()):
        raise HTTPException(401, "Service authentication required")


router = APIRouter(prefix="/internal", dependencies=[Depends(require_service)])


class SessionPayload(Payload):
    sessionToken: str = Field(min_length=1, max_length=256)


class Instance(Payload):
    instanceId: UUID


class Room(Instance):
    roomId: UUID
    code: str = Field(pattern=r"^[A-Z0-9]{6}$")
    createdByUserId: UUID
    isPublic: bool
    createdAt: AwareDatetime


class Participant(Payload):
    playerId: UUID
    userId: UUID
    displayName: str = Field(min_length=1, max_length=24)


class MatchStart(Payload):
    matchId: UUID
    roomId: UUID
    roundNumber: int = Field(ge=1)
    level: Literal["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]
    startedAt: AwareDatetime
    players: list[Participant] = Field(min_length=3, max_length=6)


class Assignment(Payload):
    playerId: UUID
    roleId: Literal["murderer", "accomplice", "bomber", "lawyer", "rich_merchant", "detective", "butler", "guest"]
    factionId: Literal["murderer_faction", "bomber_faction", "witness_faction"]
    locationId: Literal["lounge", "gallery", "billiard_room", "study", "entrance_hall", "dining_room"]


class Result(Payload):
    endedAt: AwareDatetime
    winningFaction: Literal["murderer_faction", "bomber_faction", "witness_faction"]
    winningPlayerIds: list[UUID] = Field(max_length=6)
    reason: str = Field(min_length=1, max_length=1000)
    assignments: list[Assignment] = Field(min_length=3, max_length=6)


class Abandon(Payload):
    endedAt: AwareDatetime
    reason: str = Field(min_length=1, max_length=1000)


@router.post("/sessions/resolve")
def resolve(payload: SessionPayload):
    account = resolve_user_session(payload.sessionToken)
    if not account:
        raise HTTPException(401, "Session expired")
    return {"userId": str(account["id"]), "displayName": account["display_name"], "expiresAt": account["expires_at"].isoformat()}


@router.post("/instances")
def register_instance(payload: Instance):
    with connect() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(823194622)")
        connection.execute("UPDATE matches SET status = 'abandoned', ended_at = greatest(now(), started_at), abandon_reason = '遊戲伺服器重新啟動' WHERE status = 'in_progress' AND room_id IN (SELECT id FROM rooms WHERE server_instance_id <> %s AND closed_at IS NULL)", (payload.instanceId,))
        connection.execute("UPDATE match_players SET outcome = 'abandoned' WHERE outcome = 'pending' AND match_id IN (SELECT id FROM matches WHERE status = 'abandoned')")
        connection.execute("UPDATE rooms SET closed_at = greatest(now(), created_at) WHERE server_instance_id <> %s AND closed_at IS NULL", (payload.instanceId,))
    return {"ok": True}


@router.post("/rooms")
def create_room(payload: Room):
    with connect() as connection:
        previous = connection.execute("SELECT * FROM rooms WHERE id = %s", (payload.roomId,)).fetchone()
        if previous:
            if previous["code"] != payload.code or previous["server_instance_id"] != payload.instanceId or previous["created_by_user_id"] != payload.createdByUserId:
                raise HTTPException(409, "Conflicting room identity")
        else:
            connection.execute("INSERT INTO rooms(id,code,server_instance_id,created_by_user_id,is_public,created_at) VALUES (%s,%s,%s,%s,%s,%s)", (payload.roomId, payload.code, payload.instanceId, payload.createdByUserId, payload.isPublic, payload.createdAt))
    return {"ok": True}


@router.post("/rooms/{room_id}/close")
def close_room(room_id: UUID):
    with connect() as connection:
        connection.execute("UPDATE rooms SET closed_at = greatest(now(), created_at) WHERE id = %s AND closed_at IS NULL", (room_id,))
        connection.execute("UPDATE matches SET status = 'abandoned', ended_at = greatest(now(),started_at), abandon_reason = '房間已結束' WHERE room_id = %s AND status = 'in_progress'", (room_id,))
        connection.execute("UPDATE match_players SET outcome = 'abandoned' WHERE match_id IN (SELECT id FROM matches WHERE room_id = %s AND status = 'abandoned')", (room_id,))
    return {"ok": True}


@router.post("/matches")
def start_match(payload: MatchStart):
    if len({participant.userId for participant in payload.players}) != len(payload.players) or len({participant.playerId for participant in payload.players}) != len(payload.players):
        raise HTTPException(400, "Duplicate participant")
    with connect() as connection:
        room = connection.execute("SELECT * FROM rooms WHERE id = %s AND closed_at IS NULL FOR UPDATE", (payload.roomId,)).fetchone()
        if not room:
            raise HTTPException(409, "Room is closed")
        existing = connection.execute("SELECT * FROM matches WHERE id = %s", (payload.matchId,)).fetchone()
        if existing:
            roster = connection.execute("SELECT player_id,user_id FROM match_players WHERE match_id = %s", (payload.matchId,)).fetchall()
            if existing["room_id"] != payload.roomId or existing["round_number"] != payload.roundNumber or existing["level"] != payload.level or existing["started_at"] != payload.startedAt or {(entry["player_id"], entry["user_id"]) for entry in roster} != {(entry.playerId, entry.userId) for entry in payload.players}:
                raise HTTPException(409, "Conflicting match identity")
            return {"ok": True}
        if connection.execute("SELECT 1 FROM matches WHERE room_id = %s AND status = 'in_progress'", (payload.roomId,)).fetchone():
            raise HTTPException(409, "Match already active")
        connection.execute("INSERT INTO matches(id,room_id,round_number,level,started_at) VALUES (%s,%s,%s,%s,%s)", (payload.matchId, payload.roomId, payload.roundNumber, payload.level, payload.startedAt))
        for participant in payload.players:
            connection.execute("INSERT INTO match_players(match_id,player_id,user_id,display_name_snapshot) VALUES (%s,%s,%s,%s)", (payload.matchId, participant.playerId, participant.userId, participant.displayName))
    return {"ok": True}


@router.put("/matches/{match_id}/result")
def complete_match(match_id: UUID, payload: Result):
    canonical = payload.model_dump(mode="json")
    canonical["winningPlayerIds"] = sorted(canonical["winningPlayerIds"])
    canonical["assignments"] = sorted(canonical["assignments"], key=lambda entry: entry["playerId"])
    with connect() as connection:
        match = connection.execute("SELECT * FROM matches WHERE id = %s FOR UPDATE", (match_id,)).fetchone()
        if not match:
            raise HTTPException(404, "Unknown match")
        if match["status"] == "completed":
            if match["result_payload"] != canonical:
                raise HTTPException(409, "Conflicting result")
            return {"ok": True}
        if match["status"] != "in_progress" or payload.endedAt < match["started_at"]:
            raise HTTPException(409, "Match cannot be completed")
        roster = connection.execute("SELECT player_id FROM match_players WHERE match_id = %s", (match_id,)).fetchall()
        identities = {entry["player_id"] for entry in roster}
        if len(payload.assignments) != len(identities) or {entry.playerId for entry in payload.assignments} != identities or not set(payload.winningPlayerIds).issubset(identities) or len(set(payload.winningPlayerIds)) != len(payload.winningPlayerIds):
            raise HTTPException(400, "Result does not match roster")
        for assignment in payload.assignments:
            faction = "murderer_faction" if assignment.roleId in ("murderer", "accomplice") else "bomber_faction" if assignment.roleId == "bomber" else "witness_faction"
            if faction != assignment.factionId:
                raise HTTPException(400, "Role faction mismatch")
            outcome = "no_winner" if not payload.winningPlayerIds else "win" if assignment.playerId in payload.winningPlayerIds else "loss"
            connection.execute("UPDATE match_players SET role_id=%s,faction_id=%s,location_id=%s,outcome=%s WHERE match_id=%s AND player_id=%s", (assignment.roleId, assignment.factionId, assignment.locationId, outcome, match_id, assignment.playerId))
        connection.execute("UPDATE matches SET status='completed',ended_at=%s,winning_faction=%s,result_reason=%s,result_payload=%s WHERE id=%s", (payload.endedAt, payload.winningFaction, payload.reason, Jsonb(canonical), match_id))
    return {"ok": True}


@router.put("/matches/{match_id}/abandon")
def abandon_match(match_id: UUID, payload: Abandon):
    with connect() as connection:
        match = connection.execute("SELECT * FROM matches WHERE id=%s FOR UPDATE", (match_id,)).fetchone()
        if not match:
            raise HTTPException(404, "Unknown match")
        if match["status"] == "completed":
            raise HTTPException(409, "Completed matches cannot be abandoned")
        if match["status"] == "in_progress":
            if payload.endedAt < match["started_at"]:
                raise HTTPException(400, "Invalid end time")
            connection.execute("UPDATE matches SET status='abandoned',ended_at=%s,abandon_reason=%s WHERE id=%s", (payload.endedAt, payload.reason, match_id))
            connection.execute("UPDATE match_players SET outcome='abandoned' WHERE match_id=%s", (match_id,))
    return {"ok": True}
