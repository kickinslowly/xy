from flask import Flask, render_template, request, jsonify, g
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from sqlalchemy import func, BigInteger, Integer
import os
import random
from collections import defaultdict
from functools import wraps
import jwt, datetime
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from dotenv import load_dotenv
import time

# Load environment variables from a .env file, if present
load_dotenv()

# Flask application
app = Flask(__name__)

# Database configuration (privacy-first, no PII by default)
# Use DATABASE_URL for Postgres in production (e.g., postgres://...), else fallback to local SQLite
# Normalize DATABASE_URL for SQLAlchemy/psycopg2 and set stable local SQLite fallback
raw_db_url = os.environ.get('DATABASE_URL')
if raw_db_url and raw_db_url.startswith('postgres://'):
    # SQLAlchemy prefers postgresql+psycopg2
    raw_db_url = raw_db_url.replace('postgres://', 'postgresql+psycopg2://', 1)

os.makedirs(app.instance_path, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = raw_db_url or f"sqlite:///{os.path.join(app.instance_path, 'app.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# Nice-to-have for managed DBs (avoids stale connections)
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = { 'pool_pre_ping': True }
# Secrets and OAuth config
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-insecure')
app.config['GOOGLE_CLIENT_ID'] = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_ID = app.config.get('GOOGLE_CLIENT_ID')

# Initialize DB and migrations
db = SQLAlchemy(app)
migrate = Migrate(app, db)


# Cross-DB BigInt: use Integer on SQLite so primary keys autoincrement correctly
BigInt = BigInteger().with_variant(Integer(), 'sqlite')

# SocketIO server
socketio = SocketIO(app, cors_allowed_origins="*")

# Make GOOGLE_CLIENT_ID available to templates
@app.context_processor
def inject_globals():
    return {'GOOGLE_CLIENT_ID': app.config.get('GOOGLE_CLIENT_ID')}

# ======================
# SQLAlchemy data models
# ======================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(BigInt, primary_key=True, autoincrement=True)
    google_sub = db.Column(db.Text, unique=True, nullable=False)
    role = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at = db.Column(db.DateTime(timezone=True))

    __table_args__ = (
        db.CheckConstraint("role IN ('student','teacher','admin')", name='ck_users_role'),
    )


class Class(db.Model):
    __tablename__ = 'classes'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    teacher_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.Text, nullable=False)
    join_code = db.Column(db.Text, unique=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)


class ClassMembership(db.Model):
    __tablename__ = 'class_memberships'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    class_id = db.Column(db.BigInteger, db.ForeignKey('classes.id'), nullable=False)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    role = db.Column(db.Text, nullable=False, server_default='student')
    joined_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Tier 3 minimal-real-name variant: show First + Last initial to students
    display_name = db.Column(db.Text)  # per-class visible name (e.g., "Ava S.")
    nickname_locked = db.Column(db.Boolean, nullable=False, default=False)

    __table_args__ = (
        db.UniqueConstraint('class_id', 'user_id', name='uq_class_user'),
    )


class Skill(db.Model):
    __tablename__ = 'skills'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    standard_code = db.Column(db.Text, nullable=False)
    name = db.Column(db.Text, nullable=False)
    strand = db.Column(db.Text, nullable=False)
    difficulty = db.Column(db.Integer)


class Activity(db.Model):
    __tablename__ = 'activities'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    activity_type = db.Column(db.Text, nullable=False)
    skill_id = db.Column(db.BigInteger, db.ForeignKey('skills.id'))
    params_json = db.Column(db.JSON)


class Assignment(db.Model):
    __tablename__ = 'assignments'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    class_id = db.Column(db.BigInteger, db.ForeignKey('classes.id'), nullable=False)
    activity_id = db.Column(db.BigInteger, db.ForeignKey('activities.id'), nullable=False)
    assigned_by = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    due_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)


class Submission(db.Model):
    __tablename__ = 'submissions'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    assignment_id = db.Column(db.BigInteger, db.ForeignKey('assignments.id'), nullable=False)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.Text, nullable=False)
    score = db.Column(db.Numeric(5, 2))
    attempts_count = db.Column(db.Integer, nullable=False, server_default=db.text('0'))
    time_on_task_ms = db.Column(db.BigInteger)
    started_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))


class SessionModel(db.Model):
    __tablename__ = 'sessions'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    started_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at = db.Column(db.DateTime(timezone=True))
    device_type = db.Column(db.Text)
    browser_family = db.Column(db.Text)


class Event(db.Model):
    __tablename__ = 'events'
    id = db.Column(BigInt, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    session_id = db.Column(db.BigInteger, db.ForeignKey('sessions.id'))
    event_type = db.Column(db.Text, nullable=False)
    activity_id = db.Column(db.BigInteger, db.ForeignKey('activities.id'))
    skill_id = db.Column(db.BigInteger, db.ForeignKey('skills.id'))
    room_pin = db.Column(db.Text)
    role = db.Column(db.Text)
    timestamp = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)
    duration_ms = db.Column(db.BigInteger)
    payload_json = db.Column(db.JSON)


class MasterySnapshot(db.Model):
    __tablename__ = 'mastery_snapshots'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    skill_id = db.Column(db.BigInteger, db.ForeignKey('skills.id'), nullable=False)
    mastery_prob = db.Column(db.Numeric(4, 3))
    se = db.Column(db.Numeric(4, 3))
    opportunities = db.Column(db.Integer, nullable=False, server_default=db.text('0'))
    last_evidence_at = db.Column(db.DateTime(timezone=True))
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'skill_id', name='uq_mastery_user_skill'),
    )


class ErrorType(db.Model):
    __tablename__ = 'error_types'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    label = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text)


class Strand(db.Model):
    __tablename__ = 'strands'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    name = db.Column(db.Text, nullable=False)


class TeacherPrivateName(db.Model):
    __tablename__ = 'teacher_private_names'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    class_id = db.Column(db.BigInteger, db.ForeignKey('classes.id'), nullable=False)
    student_user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    private_name = db.Column(db.Text, nullable=False)
    created_by = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('class_id', 'student_user_id', name='uq_private_name_per_class'),
    )


class AccessLog(db.Model):
    __tablename__ = 'access_logs'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)  # who viewed
    class_id = db.Column(db.BigInteger, db.ForeignKey('classes.id'))
    action = db.Column(db.Text, nullable=False)  # e.g., 'view_names', 'export_named_csv'
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)


# ========= Added for results and achievements =========
# Standardized Result Schema (details_json and fields)
# - mode: short snake-case key for the mode. Use 'plane' for coordinate plane tasks, including line and vertex challenges.
# - game_name: human label for the specific task, e.g., 'Vertex Challenge', 'Line Challenge', 'Create This Ratio'.
# - outcome: one of 'success'/'completed'/'win' (treated as correct), or 'lose'/'fail'/'incorrect' (treated as incorrect). May be null for neutral.
# - score: optional numeric score.
# - duration_ms: optional duration in ms.
# - room_pin: optional PIN for room-based sessions.
# - activity_id: optional activity id.
# - details_json: JSON payload with the following naming structure:
#     challenge_type: string categorizing the task, e.g., 'vertex','line','ratio','memedash','battleship','memewars'.
#     correct: boolean where true = correct/success, false = incorrect; omitted if not applicable.
#     correct_count, incorrect_count, total_attempts: integers when available.
#     extra fields specific to the challenge for analytics (e.g., x,y for vertex; m,b for line).
# Storage:
#   Stored in game_results table per completion/attempt. Use SUCCESS_OUTCOMES to interpret correctness.
#   Realtime events can also be captured in events table via /events.
class GameResult(db.Model):
    __tablename__ = 'game_results'
    id = db.Column(BigInt, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    mode = db.Column(db.Text, nullable=False)  # e.g., 'plane','battleship','memewars','ratios','memedash'
    game_name = db.Column(db.Text, nullable=False)  # specific game/activity name within a mode
    outcome = db.Column(db.Text)  # e.g., 'win','lose','draw','completed','success','incorrect','fail'
    score = db.Column(db.Numeric(10, 2))
    duration_ms = db.Column(db.BigInteger)
    room_pin = db.Column(db.Text)
    activity_id = db.Column(db.BigInteger, db.ForeignKey('activities.id'))
    details_json = db.Column(db.JSON)
    played_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        db.Index('ix_results_user_mode', 'user_id', 'mode'),
    )


class Achievement(db.Model):
    __tablename__ = 'achievements'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    code = db.Column(db.Text, unique=True, nullable=False)
    title = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text)
    mode = db.Column(db.Text, nullable=False)  # per-mode achievements
    threshold = db.Column(db.Integer, nullable=False)  # number of completed tasks required
    icon = db.Column(db.Text)  # optional icon filename


class UserAchievement(db.Model):
    __tablename__ = 'user_achievements'
    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    achievement_id = db.Column(db.BigInteger, db.ForeignKey('achievements.id'), nullable=False)
    unlocked_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'achievement_id', name='uq_user_achievement_once'),
    )

# Ensure tables exist in dev if migrations haven't been run (after models are defined)
try:
    with app.app_context():
        db.create_all()
        # SQLite fix: if game_results.id isn't INTEGER PRIMARY KEY, drop and recreate table (no data expected yet)
        if app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite'):
            from sqlalchemy import text
            with db.engine.connect() as conn:
                res = conn.execute(text("SELECT sql FROM sqlite_master WHERE type='table' AND name='game_results'"))
                row = res.fetchone()
                if row and row[0] and ('"id" INTEGER' not in row[0] and ' id INTEGER' not in row[0]):
                    # table exists with wrong id type; drop and recreate
                    conn.execute(text('DROP TABLE IF EXISTS game_results'))
                    db.metadata.tables['game_results'].create(bind=conn)
except Exception:
    pass

# In-memory state storage per room and mode.
# rooms_state[room]['plane'] or ['line'] -> last known state (dict)
rooms_state = defaultdict(lambda: {'plane': None, 'line': None, 'battleship': None, 'memewars': None, 'ratios': None, 'memedash': None})
# Track last authoritative update timestamp per room/mode for owner failover (epoch seconds)
last_state_ts = defaultdict(lambda: {'plane': 0.0, 'line': 0.0, 'battleship': 0.0, 'memewars': 0.0, 'ratios': 0.0, 'memedash': 0.0})
# Track connections per room for presence
room_members = defaultdict(set)  # room -> set of sids
# Battleship role assignment per room: first joiner = 'A', second = 'B', others spectate
battleship_roles = defaultdict(lambda: {'A': None, 'B': None})


@app.route('/')
def index():
    # Gather available images from the static directory
    static_dir = os.path.join(app.root_path, 'static')
    exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}
    try:
        images = [name for name in os.listdir(static_dir) if os.path.splitext(name)[1].lower() in exts]
    except Exception:
        images = []
    return render_template('index.html', available_images=images)


@app.route('/line-mode')
def line_mode():
    return render_template('line_mode.html')


@app.route('/battleship')
def battleship():
    return render_template('battleship.html')


@app.route('/meme-wars')
def meme_wars():
    # Gather available images from the static directory for meme selection
    static_dir = os.path.join(app.root_path, 'static')
    exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}
    try:
        images = [name for name in os.listdir(static_dir) if os.path.splitext(name)[1].lower() in exts]
    except Exception:
        images = []
    return render_template('meme_wars.html', available_images=images)


@app.route('/meme-dash')
def meme_dash():
    # Fixed-level platformer using memes from static folder
    static_dir = os.path.join(app.root_path, 'static')
    exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}
    try:
        images = [name for name in os.listdir(static_dir) if os.path.splitext(name)[1].lower() in exts]
    except Exception:
        images = []
    return render_template('meme_dash.html', available_images=images)


@app.route('/ratios')
def ratios_mode():
    # Gather available images from the static directory for ratios challenges
    static_dir = os.path.join(app.root_path, 'static')
    exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}
    try:
        images = [name for name in os.listdir(static_dir) if os.path.splitext(name)[1].lower() in exts]
    except Exception:
        images = []
    return render_template('ratios.html', available_images=images)


def _generate_unique_pin(length=6):
    digits = '0123456789'
    for _ in range(10000):
        pin = ''.join(random.choice(digits) for _ in range(length))
        # Ensure no collision with existing rooms we are tracking
        if pin not in rooms_state and pin not in room_members:
            return pin
    # Fallback (extremely unlikely to reach here)
    return ''.join(random.choice(digits) for _ in range(length))


@app.get('/api/new-session')
def api_new_session():
    # Mode is accepted for potential future validation/logging; not used server-side to create rooms
    mode = (request.args.get('mode') or 'plane').strip().lower()
    pin = _generate_unique_pin(6)
    # Do not pre-create state; it will be created on first update. Returning the pin is enough.
    return jsonify({'pin': pin, 'mode': mode})


# Authentication utilities and endpoints

def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'auth_required'}), 401
        token = auth.split(' ', 1)[1]
        try:
            claims = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        except Exception:
            return jsonify({'error': 'invalid_token'}), 401
        g.user_id = claims.get('uid')
        g.role = claims.get('role')
        return f(*args, **kwargs)
    return wrapper


@app.post('/auth/google')
def google_auth():
    data = request.get_json(silent=True) or {}
    id_token_str = data.get('id_token')
    if not id_token_str:
        return jsonify({'error': 'missing id_token'}), 400

    try:
        idinfo = google_id_token.verify_oauth2_token(
            id_token_str, google_requests.Request(), GOOGLE_CLIENT_ID
        )
        sub = idinfo['sub']
    except Exception:
        return jsonify({'error': 'invalid_google_token'}), 401

    # Upsert user by google_sub
    user = User.query.filter_by(google_sub=sub).one_or_none()
    if not user:
        user = User(google_sub=sub, role='student')
        db.session.add(user)
        try:
            db.session.commit()
        except Exception as e:
            # Some SQLite databases created with BIGINT PK won't auto-assign id, causing NOT NULL on users.id.
            # Fallback: manually assign the next id and retry. This keeps login working without forcing a migration.
            from sqlalchemy.exc import IntegrityError
            db.session.rollback()
            if isinstance(e, IntegrityError):
                try:
                    next_id = (db.session.query(func.max(User.id)).scalar() or 0) + 1
                except Exception:
                    next_id = 1
                user.id = int(next_id)
                db.session.add(user)
                db.session.commit()
            else:
                raise

    # Session-only display name for personalization (privacy-first; not stored in DB)
    try:
        given_name = (idinfo.get('given_name') if 'idinfo' in locals() else None) or None
    except Exception:
        given_name = None

    payload = {
        'uid': int(user.id),
        'role': user.role,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=12)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

    user_obj = {'id': int(user.id), 'role': user.role}
    if given_name:
        user_obj['display_name'] = given_name
    else:
        user_obj['display_name'] = f"Player {int(user.id)}"

    return jsonify({'token': token, 'user': user_obj})


@app.post('/events')
@require_auth
def ingest_event():
    body = request.get_json(force=True)
    e = Event(
        user_id=g.user_id,
        session_id=body.get('session_id'),
        event_type=body.get('event_type'),
        activity_id=body.get('activity_id'),
        skill_id=body.get('skill_id'),
        room_pin=body.get('room_pin'),
        role=body.get('role'),
        duration_ms=body.get('duration_ms'),
        payload_json=body.get('payload_json')
    )
    db.session.add(e)
    db.session.commit()
    return jsonify({'ok': True, 'id': int(e.id)})


# ------- Results ingestion and dashboard API -------
SUCCESS_OUTCOMES = {'win', 'completed', 'success'}

# Canonicalize mode names to ensure consistent storage and counting
# Accept common synonyms and legacy variations and map them to canonical keys used across the app.
MODE_SYNONYMS = {
    'plane': {'plane', 'coordinate_plane', 'coordinate plane', 'graph', 'cartesian'},
    'line': {'line', 'line_graph', 'line graph'},
    'battleship': {'battleship', 'battle_ship', 'battle-ship'},
    'memewars': {'memewars', 'meme_wars', 'meme-wars', 'meme wars'},
    'memedash': {'memedash', 'meme_dash', 'meme-dash', 'meme dash'},
    'ratios': {'ratios', 'ratio'},
}


def canonicalize_mode(value: str) -> str:
    v = (value or '').strip().lower()
    if not v:
        return 'unknown'
    for canon, names in MODE_SYNONYMS.items():
        if v in names:
            return canon
    return v


def canonical_mode_group(target_mode: str):
    """Return list of mode keys that should be counted toward the given canonical mode bucket.
    Plane bucket includes legacy 'line'. Others include common synonyms to count historical data.
    """
    m = canonicalize_mode(target_mode)
    if m == 'plane':
        return ['plane', 'line']
    # include all known synonyms for robust counting
    names = set(MODE_SYNONYMS.get(m, {m}))
    # Always include the canonical itself
    names.add(m)
    return sorted(names)


def ensure_achievements_seed():
    modes = ['plane', 'line', 'battleship', 'memewars', 'ratios', 'memedash']
    tiers = [10, 50, 200]  # meaningful thresholds

    # Friendly labels per mode for consistent naming/spelling on dashboard
    mode_labels = {
        'plane': 'Coordinate Plane',
        'line': 'Line Graph',
        'battleship': 'Battleship',
        'memewars': 'Meme Wars',
        'ratios': 'Ratios',
        'memedash': 'Meme Dash',
    }

    # Collect existing achievement codes first to avoid autoflush side effects
    existing_codes = {a.code for a in Achievement.query.all()}

    # Determine the next id manually because on SQLite a BIGINT PK won't autoincrement
    # unless the column is exactly INTEGER PRIMARY KEY. Our initial table may not meet that,
    # so we assign ids explicitly to keep seeding robust across environments.
    next_id = int(db.session.query(func.max(Achievement.id)).scalar() or 0) + 1

    to_create = []
    for m in modes:
        for t in tiers:
            code = f"{m}_t{t}"
            if code not in existing_codes:
                label = mode_labels.get(m, m.title())
                title = f"{label} {t}"
                desc = f"Complete {t} {label} challenges"
                ach = Achievement(id=next_id, code=code, title=title, description=desc, mode=m, threshold=t)
                next_id += 1
                to_create.append(ach)

    if to_create:
        db.session.add_all(to_create)
        db.session.commit()

    # Ensure existing rows have correct human-friendly titles/descriptions
    updated = False
    for a in Achievement.query.all():
        label = mode_labels.get(a.mode, (a.mode or '').title())
        try:
            th = int(a.threshold)
        except Exception:
            th = a.threshold
        expected_title = f"{label} {th}"
        expected_desc = f"Complete {th} {label} challenges"
        if a.title != expected_title or (a.description or '') != expected_desc:
            a.title = expected_title
            a.description = expected_desc
            updated = True
    if updated:
        db.session.commit()


@app.post('/api/results')
@require_auth
def record_result():
    ensure_achievements_seed()
    body = request.get_json(silent=True) or {}
    mode = canonicalize_mode(body.get('mode'))
    game_name = (body.get('game_name') or mode).strip() or mode
    outcome = (body.get('outcome') or '').strip().lower() or None
    score = body.get('score')
    duration_ms = body.get('duration_ms')
    room_pin = body.get('room_pin')
    activity_id = body.get('activity_id')
    details_json = body.get('details_json') or body.get('details')

    r = GameResult(
        user_id=g.user_id,
        mode=mode,
        game_name=game_name,
        outcome=outcome,
        score=score,
        duration_ms=duration_ms,
        room_pin=room_pin,
        activity_id=activity_id,
        details_json=details_json,
    )
    db.session.add(r)
    db.session.commit()

    # Unlock achievements if thresholds met
    newly_unlocked = []
    if outcome in SUCCESS_OUTCOMES or outcome is None:
        # count completed/success tasks in this mode for user
        q = db.session.query(func.count(GameResult.id)).filter(
            GameResult.user_id == g.user_id,
            GameResult.mode == mode,
            (GameResult.outcome == None) | (GameResult.outcome.in_(list(SUCCESS_OUTCOMES)))
        )
        total_completed = int(q.scalar() or 0)
        # candidate achievements for this mode
        achs = Achievement.query.filter_by(mode=mode).all()
        # fetch already unlocked ids
        unlocked_ids = {ua.achievement_id for ua in UserAchievement.query.filter_by(user_id=g.user_id).all()}
        for a in achs:
            if a.threshold <= total_completed and a.id not in unlocked_ids:
                ua = UserAchievement(user_id=g.user_id, achievement_id=a.id)
                db.session.add(ua)
                newly_unlocked.append({'code': a.code, 'title': a.title, 'threshold': a.threshold})
        if newly_unlocked:
            db.session.commit()

    return jsonify({'ok': True, 'id': int(r.id), 'new_achievements': newly_unlocked})


@app.get('/api/dashboard')
@require_auth
def api_dashboard():
    ensure_achievements_seed()
    uid = g.user_id
    # Recent results
    recent = [
        {
            'id': int(gr.id),
            'mode': gr.mode,
            'game_name': gr.game_name,
            'outcome': gr.outcome,
            'score': float(gr.score) if gr.score is not None else None,
            'played_at': gr.played_at.isoformat() if gr.played_at else None
        }
        for gr in GameResult.query.filter_by(user_id=uid).order_by(GameResult.played_at.desc()).limit(25).all()
    ]

    # Per-mode aggregates (totals, wins, scores) using SQL, then enrich with accuracy and challenge breakdown in Python
    modes = ['plane', 'battleship', 'memewars', 'ratios', 'memedash']
    per_mode = {m: {
        'total_games': int(db.session.query(func.count(GameResult.id)).filter(
            GameResult.user_id == uid,
            GameResult.mode.in_(canonical_mode_group(m))
        ).scalar() or 0),
        'wins_or_completed': int(db.session.query(func.count(GameResult.id)).filter(
            GameResult.user_id == uid,
            GameResult.mode.in_(canonical_mode_group(m)),
            GameResult.outcome.in_(list(SUCCESS_OUTCOMES))
        ).scalar() or 0),
        'avg_score': (lambda v: float(v) if v is not None else None)(db.session.query(func.avg(GameResult.score)).filter(
            GameResult.user_id == uid,
            GameResult.mode.in_(canonical_mode_group(m)),
            GameResult.score != None
        ).scalar()),
        'best_score': (lambda v: float(v) if v is not None else None)(db.session.query(func.max(GameResult.score)).filter(
            GameResult.user_id == uid,
            GameResult.mode.in_(canonical_mode_group(m)),
            GameResult.score != None
        ).scalar()),
    } for m in modes}

    # Accuracy and challenge-type breakdown
    rows = GameResult.query.filter_by(user_id=uid).all()
    # helpers
    def classify(gr):
        det = gr.details_json or {}
        # canonical mode: map synonyms, then merge 'line' into 'plane' bucket
        base_mode = canonicalize_mode(gr.mode or '')
        cmode = 'plane' if base_mode in ('line', 'plane') else (base_mode or 'unknown')
        # challenge type
        ctype = det.get('challenge_type')
        if not ctype:
            # infer from mode/game_name
            if gr.mode == 'line' or (cmode == 'plane' and 'line' in (gr.game_name or '').lower()):
                ctype = 'line'
            elif cmode == 'plane' and 'vertex' in (gr.game_name or '').lower():
                ctype = 'vertex'
            elif cmode == 'ratios':
                ctype = 'ratio'
            else:
                ctype = cmode
        # correctness
        if det.get('correct') is True:
            corr = True
        elif det.get('correct') is False:
            corr = False
        else:
            if gr.outcome in SUCCESS_OUTCOMES:
                corr = True
            elif (gr.outcome or '').lower() in {'incorrect','fail','wrong','lose','lost'}:
                corr = False
            else:
                corr = None
        return cmode, ctype, corr

    # aggregate
    by_mode = {m: {'correct': 0, 'incorrect': 0, 'by_challenge': {}} for m in modes}
    for gr in rows:
        cmode, ctype, corr = classify(gr)
        if cmode not in by_mode:
            by_mode[cmode] = {'correct': 0, 'incorrect': 0, 'by_challenge': {}}
        bm = by_mode[cmode]
        bc = bm['by_challenge'].setdefault(ctype, {'correct': 0, 'incorrect': 0})
        if corr is True:
            bm['correct'] += 1
            bc['correct'] += 1
        elif corr is False:
            bm['incorrect'] += 1
            bc['incorrect'] += 1

    # finalize accuracy
    for m, stats in by_mode.items():
        tot = stats['correct'] + stats['incorrect']
        stats['accuracy'] = (stats['correct'] / tot) if tot > 0 else None
        # carry into per_mode
        if m in per_mode:
            per_mode[m]['correct'] = int(stats['correct'])
            per_mode[m]['incorrect'] = int(stats['incorrect'])
            per_mode[m]['accuracy'] = float(stats['accuracy']) if stats['accuracy'] is not None else None
            # challenge breakdown with accuracy
            per_mode[m]['by_challenge'] = {}
            for ct, s in stats['by_challenge'].items():
                t = s['correct'] + s['incorrect']
                acc = (s['correct']/t) if t>0 else None
                per_mode[m]['by_challenge'][ct] = {
                    'correct': int(s['correct']),
                    'incorrect': int(s['incorrect']),
                    'accuracy': float(acc) if acc is not None else None,
                    'total': int(t),
                }

    # Achievements with progress info
    all_achs = Achievement.query.order_by(Achievement.mode, Achievement.threshold).all()
    unlocked = {ua.achievement_id: ua.unlocked_at for ua in UserAchievement.query.filter_by(user_id=uid).all()}

    # Pre-compute per-mode completed counts toward achievements
    relevant_modes = sorted({a.mode for a in all_achs})
    progress_counts = {}
    for m in relevant_modes:
        modes_list = canonical_mode_group(m)
        cnt = db.session.query(func.count(GameResult.id)).filter(
            GameResult.user_id == uid,
            GameResult.mode.in_(modes_list),
            (GameResult.outcome == None) | (GameResult.outcome.in_(list(SUCCESS_OUTCOMES)))
        ).scalar()
        progress_counts[m] = int(cnt or 0)

    achievements = []
    for a in all_achs:
        unlocked_at = unlocked.get(a.id)
        current = progress_counts.get(a.mode, 0)
        thr = int(a.threshold)
        percent = (current / thr) if thr > 0 else 0.0
        if percent > 1:
            percent = 1.0
        achievements.append({
            'code': a.code,
            'title': a.title,
            'description': a.description,
            'mode': a.mode,
            'threshold': thr,
            'current': int(current),
            'remaining': max(0, thr - int(current)),
            'percent': float(percent),
            'progress_text': f"{min(int(current), thr)}/{thr}",
            'unlocked': unlocked_at is not None or (current >= thr),
            'unlocked_at': unlocked_at.isoformat() if unlocked_at else None
        })

    return jsonify({'recent': recent, 'per_mode': per_mode, 'achievements': achievements})


@app.get('/dashboard')
def dashboard_page():
    return render_template('dashboard.html')


# Socket.IO events
@socketio.on('connect')
def handle_connect(auth):
    # Accept unauthenticated for now to avoid breaking existing clients; if token supplied, verify.
    token = None
    try:
        if isinstance(auth, dict):
            token = auth.get('token')
    except Exception:
        token = None
    if token:
        try:
            claims = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.environ['uid'] = claims.get('uid')
            request.environ['role'] = claims.get('role')
        except Exception:
            # Reject if an invalid token was explicitly provided
            return False
@socketio.on('join')
def handle_join(data):
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'plane'
    mode_l = (mode or '').lower()

    # Block joining Meme Dash if TERMINATOR mode is active in this room
    if mode_l in ('memedash', 'meme-dash', 'meme_dash'):
        cur = rooms_state[room].get('memedash')
        try:
            if isinstance(cur, dict) and cur.get('terminatorMode'):
                emit('join_denied', {'room': room, 'mode': 'memedash', 'reason': 'terminator_active'}, room=request.sid)
                return
        except Exception:
            pass

    join_room(room)
    room_members[room].add(request.sid)

    # Team role assignment (Battleship and Meme Wars): first joiner = 'A', second = 'B', others spectate
    if mode_l in ('battleship', 'memewars', 'meme-wars'):
        role = None
        roles = battleship_roles[room]
        if roles.get('A') is None:
            roles['A'] = request.sid
            role = 'A'
        elif roles.get('B') is None and roles.get('A') != request.sid:
            roles['B'] = request.sid
            role = 'B'
        # Notify only the joining client about their role
        emit('role', {'room': room, 'role': role}, room=request.sid)

    # Send current presence to room
    emit('presence', {'room': room, 'count': len(room_members[room])}, room=room)
    # Optionally send the current state to the new client
    st = rooms_state[room].get(mode)
    if st is not None:
        emit('state', {'room': room, 'mode': mode, 'state': st})


@socketio.on('leave')
def handle_leave(data):
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'plane'
    leave_room(room)

    # Free team role if applicable for Battleship or Meme Wars
    if (mode or '').lower() in ('battleship', 'memewars', 'meme-wars'):
        roles = battleship_roles.get(room)
        if roles:
            if roles.get('A') == request.sid:
                roles['A'] = None
            if roles.get('B') == request.sid:
                roles['B'] = None

    if request.sid in room_members[room]:
        room_members[room].remove(request.sid)
        emit('presence', {'room': room, 'count': len(room_members[room])}, room=room)


@socketio.on('disconnect')
def handle_disconnect():
    # Remove from all rooms where present
    for room, members in list(room_members.items()):
        if request.sid in members:
            members.remove(request.sid)
            # Free battleship role if this sid was A or B in this room
            roles = battleship_roles.get(room)
            if roles:
                if roles.get('A') == request.sid:
                    roles['A'] = None
                if roles.get('B') == request.sid:
                    roles['B'] = None
            emit('presence', {'room': room, 'count': len(members)}, room=room)


@socketio.on('request_state')
def handle_request_state(data):
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'plane'
    state = rooms_state[room].get(mode)
    emit('state', {'room': room, 'mode': mode, 'state': state})


@socketio.on('state_update')
def handle_state_update(data):
    # Expected: {room, mode, clientId, state}
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'plane'
    client_id = (data or {}).get('clientId')
    incoming = (data or {}).get('state') or {}
    if incoming is None:
        return

    # Fetch current known state for this room/mode
    current = rooms_state[room].get(mode)

    try:
        # Normalize players dicts
        inc_players = (incoming or {}).get('players') or {}
        cur_players = (current or {}).get('players') or {}

        if current is None:
            # First writer becomes the owner; accept as-is
            rooms_state[room][mode] = incoming
            last_state_ts[room][mode] = time.time()
            out_state = incoming
        else:
            cur_owner = (current or {}).get('ownerId')
            inc_owner = (incoming or {}).get('ownerId')
            if cur_owner and inc_owner and cur_owner == inc_owner:
                # Authoritative owner update: accept whole snapshot
                rooms_state[room][mode] = incoming
                last_state_ts[room][mode] = time.time()
                out_state = incoming
            else:
                # If current owner appears inactive, allow takeover by accepting incoming snapshot
                inactivity = time.time() - float(last_state_ts[room].get(mode) or 0.0)
                if inactivity > 2.0:
                    rooms_state[room][mode] = incoming
                    last_state_ts[room][mode] = time.time()
                    out_state = incoming
                else:
                    # Non-owner update: merge only the sender's player presence/cosmetics; do not override simulation
                    out_state = dict(current)
                    # Deep copy nested structures we will mutate
                    out_state['players'] = dict(cur_players)

                    inc_me = inc_players.get(client_id)
                    if inc_me:
                        if client_id not in out_state['players']:
                            # Add full player object so the owner has necessary defaults (size, name, etc.)
                            out_state['players'][client_id] = inc_me
                        else:
                            # Update only cosmetic fields; keep kinematics and scores authoritative
                            me = dict(out_state['players'][client_id])
                            for k in ('name', 'color'):  # allow harmless cosmetic updates
                                if inc_me.get(k) is not None:
                                    me[k] = inc_me.get(k)
                            out_state['players'][client_id] = me
                    # Keep everything else (memes, powerups, counts) from current
                    rooms_state[room][mode] = out_state
    except Exception:
        # On any error, fall back to storing incoming to avoid stalling the room
        rooms_state[room][mode] = incoming
        out_state = incoming

    emit('state_update', {'room': room, 'mode': mode, 'clientId': client_id, 'state': out_state}, room=room, include_self=False)


@socketio.on('memedash_win')
def handle_memedash_win(data):
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'memedash'
    winner_id = (data or {}).get('winnerId')
    winner_name = (data or {}).get('winnerName')
    score = (data or {}).get('score')
    try:
        emit('memedash_win', {'room': room, 'mode': mode, 'winnerId': winner_id, 'winnerName': winner_name, 'score': score}, room=room)
    except Exception:
        pass

@socketio.on('input_update')
def handle_input_update(data):
    # Relay per-player input to the room so the owner can simulate all players
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'plane'
    client_id = (data or {}).get('clientId')
    input_state = (data or {}).get('input') or {}
    try:
        # Broadcast to everyone except the sender; the owner will consume it
        emit('input_update', {'room': room, 'mode': mode, 'clientId': client_id, 'input': input_state}, room=room, include_self=False)
    except Exception:
        pass


if __name__ == '__main__':
    # Use SocketIO server to enable WebSockets and listen on all interfaces for LAN access
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', '5000'))
    socketio.run(app, host=host, port=port, debug=True, allow_unsafe_werkzeug=True)
