from fastapi import APIRouter, Query, Request

from api.database import connect
from api.security import require_session

router = APIRouter(prefix="/api/me")


@router.get("/stats")
def stats(request: Request):
    account = require_session(request)
    with connect() as connection:
        totals = connection.execute("SELECT * FROM user_statistics WHERE user_id=%s", (account["id"],)).fetchone() or {}
        outcomes = connection.execute("SELECT participants.outcome,participants.role_id,participants.faction_id FROM match_players participants JOIN matches games ON games.id=participants.match_id WHERE participants.user_id=%s AND games.status='completed' ORDER BY games.ended_at,games.id", (account["id"],)).fetchall()
    current, best = 0, 0
    roles, factions = {}, {}
    for outcome in outcomes:
        if outcome["outcome"] == "win":
            current += 1
            best = max(best, current)
        elif outcome["outcome"] == "loss":
            current = 0
        for groups, key in ((roles, outcome["role_id"]), (factions, outcome["faction_id"])):
            group = groups.setdefault(key, {"id": key, "played": 0, "wins": 0, "losses": 0})
            group["played"] += 1
            group["wins"] += int(outcome["outcome"] == "win")
            group["losses"] += int(outcome["outcome"] == "loss")
    for groups in (roles, factions):
        for group in groups.values():
            denominator = group["wins"] + group["losses"]
            group["winRate"] = group["wins"] / denominator if denominator else None
    wins, losses = totals.get("wins", 0), totals.get("losses", 0)
    return {
        "participated": totals.get("participated", 0), "inProgress": totals.get("in_progress", 0),
        "completed": totals.get("completed", 0), "abandoned": totals.get("abandoned", 0),
        "wins": wins, "losses": losses, "noWinner": totals.get("no_winner", 0),
        "winRate": wins / (wins + losses) if wins + losses else None,
        "currentWinStreak": current, "bestWinStreak": best,
        "totalPlaySeconds": totals.get("total_play_seconds", 0),
        "averageCompletedSeconds": float(totals["average_completed_seconds"]) if totals.get("average_completed_seconds") is not None else None,
        "roles": list(roles.values()), "factions": list(factions.values()),
    }


@router.get("/matches")
def matches(request: Request, page: int = Query(1, ge=1), pageSize: int = Query(10, ge=1, le=50)):
    account = require_session(request)
    with connect() as connection:
        total = connection.execute("SELECT count(*) AS total FROM match_players WHERE user_id=%s", (account["id"],)).fetchone()["total"]
        items = connection.execute("SELECT games.id, games.level, games.status, games.started_at AS \"startedAt\", games.ended_at AS \"endedAt\", games.result_reason AS reason, games.abandon_reason AS \"abandonReason\", participants.role_id AS \"roleId\", participants.faction_id AS \"factionId\", participants.outcome, extract(epoch FROM games.ended_at-games.started_at)::integer AS \"durationSeconds\", (SELECT count(*) FROM match_players roster WHERE roster.match_id=games.id)::integer AS \"playerCount\" FROM match_players participants JOIN matches games ON games.id=participants.match_id WHERE participants.user_id=%s ORDER BY games.started_at DESC,games.id DESC LIMIT %s OFFSET %s", (account["id"], pageSize, (page-1)*pageSize)).fetchall()
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}
