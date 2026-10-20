CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK (email = lower(btrim(email))),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 24),
    password_hash text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    UNIQUE (email)
);
CREATE TABLE system_admins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
    display_name text NOT NULL DEFAULT '系統管理員',
    password_hash text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);
CREATE TABLE user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX user_sessions_owner ON user_sessions(user_id);
CREATE INDEX user_sessions_expiry ON user_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE TABLE admin_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    system_admin_id uuid NOT NULL REFERENCES system_admins(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX admin_sessions_owner ON admin_sessions(system_admin_id);
CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX password_reset_owner ON password_reset_tokens(user_id);
CREATE TABLE rooms (
    id uuid PRIMARY KEY,
    code varchar(6) NOT NULL CHECK (code ~ '^[A-Z0-9]{6}$'),
    server_instance_id uuid NOT NULL,
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    is_public boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL,
    closed_at timestamptz,
    CHECK (closed_at IS NULL OR closed_at >= created_at)
);
CREATE UNIQUE INDEX open_room_code ON rooms(code) WHERE closed_at IS NULL;
CREATE INDEX rooms_instance ON rooms(server_instance_id) WHERE closed_at IS NULL;
CREATE TABLE matches (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL REFERENCES rooms(id),
    round_number integer NOT NULL CHECK (round_number > 0),
    level varchar(2) NOT NULL CHECK (level IN ('L1','L2','L3','L4','L5','L6','L7','L8')),
    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    winning_faction text CHECK (winning_faction IN ('murderer_faction','bomber_faction','witness_faction')),
    result_reason text,
    abandon_reason text,
    result_payload jsonb,
    UNIQUE (room_id, round_number),
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK ((status = 'in_progress' AND ended_at IS NULL) OR (status <> 'in_progress' AND ended_at IS NOT NULL))
);
CREATE INDEX matches_finished ON matches(ended_at DESC, id);
CREATE INDEX matches_status ON matches(status);
CREATE TABLE match_players (
    match_id uuid NOT NULL REFERENCES matches(id),
    player_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    display_name_snapshot text NOT NULL,
    role_id text CHECK (role_id IN ('murderer','accomplice','bomber','lawyer','rich_merchant','detective','butler','guest')),
    faction_id text CHECK (faction_id IN ('murderer_faction','bomber_faction','witness_faction')),
    location_id text CHECK (location_id IN ('lounge','gallery','billiard_room','study','entrance_hall','dining_room')),
    outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','win','loss','no_winner','abandoned')),
    PRIMARY KEY (match_id, player_id),
    UNIQUE (match_id, user_id)
);
CREATE INDEX match_players_user ON match_players(user_id, match_id);
CREATE VIEW user_statistics AS
SELECT participants.user_id,
       count(*)::integer AS participated,
       count(*) FILTER (WHERE games.status = 'in_progress')::integer AS in_progress,
       count(*) FILTER (WHERE games.status = 'completed')::integer AS completed,
       count(*) FILTER (WHERE games.status = 'abandoned')::integer AS abandoned,
       count(*) FILTER (WHERE participants.outcome = 'win')::integer AS wins,
       count(*) FILTER (WHERE participants.outcome = 'loss')::integer AS losses,
       count(*) FILTER (WHERE participants.outcome = 'no_winner')::integer AS no_winner,
       coalesce(sum(extract(epoch FROM games.ended_at - games.started_at)), 0)::bigint AS total_play_seconds,
       avg(extract(epoch FROM games.ended_at - games.started_at)) FILTER (WHERE games.status = 'completed') AS average_completed_seconds
FROM match_players participants JOIN matches games ON games.id = participants.match_id
GROUP BY participants.user_id;
