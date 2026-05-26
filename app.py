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
IS_PROD = bool(os.environ.get('RENDER'))
_secret = os.environ.get('SECRET_KEY')
if not _secret:
    if IS_PROD:
        raise RuntimeError(
            'SECRET_KEY environment variable must be set in production. '
            'Set it in the Render dashboard (envVars).'
        )
    _secret = 'dev-' + os.urandom(16).hex()
    print('[WARN] No SECRET_KEY set; using ephemeral dev key (sessions reset on restart).')
app.config['SECRET_KEY'] = _secret
app.config['GOOGLE_CLIENT_ID'] = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_ID = app.config.get('GOOGLE_CLIENT_ID')

# Initialize DB and migrations
db = SQLAlchemy(app)
migrate = Migrate(app, db)


# Cross-DB BigInt: use Integer on SQLite so primary keys autoincrement correctly
BigInt = BigInteger().with_variant(Integer(), 'sqlite')

# SocketIO server
# Tune ping intervals to detect dead connections faster without spamming
_origins_env = os.environ.get('ALLOWED_ORIGINS', '').strip()
if _origins_env:
    _cors_origins = [o.strip() for o in _origins_env.split(',') if o.strip()]
elif IS_PROD:
    print('[WARN] ALLOWED_ORIGINS not set in production; falling back to "*". Set ALLOWED_ORIGINS to your domain(s).')
    _cors_origins = '*'
else:
    _cors_origins = '*'
socketio = SocketIO(
    app,
    cors_allowed_origins=_cors_origins,
    ping_interval=float(os.environ.get('PING_INTERVAL_SEC', '5')),
    ping_timeout=float(os.environ.get('PING_TIMEOUT_SEC', '10')),
)

# Make GOOGLE_CLIENT_ID available to templates
@app.context_processor
def inject_globals():
    return {
        'GOOGLE_CLIENT_ID': app.config.get('GOOGLE_CLIENT_ID'),
        'now': datetime.datetime.now(datetime.timezone.utc),
    }

# ======================
# SQLAlchemy data models
# ======================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(BigInt, primary_key=True, autoincrement=True)
    google_sub = db.Column(db.Text, unique=True, nullable=False)
    role = db.Column(db.Text, nullable=False)
    display_name = db.Column(db.Text)  # first name for leaderboard/social features
    coins = db.Column(db.Integer, nullable=False, server_default=db.text('0'))
    # total_xp is denormalized for perf: incremented on each record_result call.
    # Falls back to live recompute via compute_xp_and_level() if NULL (e.g., legacy rows
    # before the column was added). Backfill happens on first read.
    total_xp = db.Column(db.Integer)
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
    standard_code = db.Column(db.Text, nullable=False, unique=True)
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
    # Use cross-DB BigInt so SQLite gets Integer-with-autoincrement.
    # (Plain BigInteger does NOT autoincrement on SQLite, which is why this
    # used to do manual `id=max+1` assignment — that was racy under eventlet.)
    id = db.Column(BigInt, primary_key=True, autoincrement=True)
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


class ShopItem(db.Model):
    __tablename__ = 'shop_items'
    id = db.Column(BigInt, primary_key=True, autoincrement=True)
    code = db.Column(db.Text, unique=True, nullable=False)
    name = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text)
    category = db.Column(db.Text, nullable=False)   # title, board_theme, avatar_frame
    rarity = db.Column(db.Text, nullable=False)      # common, rare, epic, legendary
    price = db.Column(db.Integer, nullable=False)
    icon = db.Column(db.Text)                        # emoji or image filename
    data_json = db.Column(db.JSON)                   # category-specific data (CSS class, color, etc.)

    __table_args__ = (
        db.CheckConstraint("category IN ('title','board_theme','avatar_frame')", name='ck_shop_category'),
        db.CheckConstraint("rarity IN ('common','rare','epic','legendary')", name='ck_shop_rarity'),
    )


class UserItem(db.Model):
    __tablename__ = 'user_items'
    id = db.Column(BigInt, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('users.id'), nullable=False)
    item_id = db.Column(db.BigInteger, db.ForeignKey('shop_items.id'), nullable=False)
    equipped = db.Column(db.Boolean, nullable=False, default=False)
    acquired_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'item_id', name='uq_user_item_once'),
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

# Ensure display_name column exists on users table (dev/SQLite auto-migration)
try:
    with app.app_context():
        from sqlalchemy import text as _text
        with db.engine.connect() as conn:
            try:
                conn.execute(_text("SELECT display_name FROM users LIMIT 1"))
            except Exception:
                conn.execute(_text("ALTER TABLE users ADD COLUMN display_name TEXT"))
                conn.commit()
except Exception:
    pass

# Ensure coins column exists on users table (dev/SQLite auto-migration)
try:
    with app.app_context():
        from sqlalchemy import text as _text2
        with db.engine.connect() as conn:
            try:
                conn.execute(_text2("SELECT coins FROM users LIMIT 1"))
            except Exception:
                conn.execute(_text2("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0"))
                conn.commit()
except Exception:
    pass

# Ensure total_xp column exists on users table (dev/SQLite auto-migration)
try:
    with app.app_context():
        from sqlalchemy import text as _text3
        with db.engine.connect() as conn:
            try:
                conn.execute(_text3("SELECT total_xp FROM users LIMIT 1"))
            except Exception:
                conn.execute(_text3("ALTER TABLE users ADD COLUMN total_xp INTEGER"))
                conn.commit()
except Exception:
    pass

# In-memory state storage per room and mode.
# rooms_state[room]['plane'] or ['line'] -> last known state (dict)
rooms_state = defaultdict(lambda: {'plane': None, 'line': None, 'battleship': None, 'memewars': None, 'ratios': None, 'memedash': None})
# Track last authoritative update timestamp per room/mode for owner failover (epoch seconds)
last_state_ts = defaultdict(lambda: {'plane': 0.0, 'line': 0.0, 'battleship': 0.0, 'memewars': 0.0, 'ratios': 0.0, 'memedash': 0.0})
# Rate-limit outbound state broadcasts to reduce network load (seconds between emits)
EMIT_INTERVAL_MIN = float(os.environ.get('EMIT_INTERVAL_MIN', '0.05'))  # 20 Hz default
last_emit_ts = defaultdict(lambda: {'plane': 0.0, 'line': 0.0, 'battleship': 0.0, 'memewars': 0.0, 'ratios': 0.0, 'memedash': 0.0})
# Owner takeover detection window in seconds (how long without owner updates before accepting a new owner)
# School Wi-Fi jitter routinely exceeds 800ms; 2.5s is the practical floor that
# stops a momentary stall (GC pause, tab background) from triggering a takeover.
OWNER_TAKEOVER_SEC = float(os.environ.get('OWNER_TAKEOVER_SEC', '2.5'))
# Track connections per room for presence
room_members = defaultdict(set)  # room -> set of sids
# Battleship role assignment per room: first joiner = 'A', second = 'B', others spectate
battleship_roles = defaultdict(lambda: {'A': None, 'B': None})


def _get_static_images():
    """Return list of image filenames in the static directory."""
    static_dir = os.path.join(app.root_path, 'static')
    exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}
    try:
        return [name for name in os.listdir(static_dir) if os.path.splitext(name)[1].lower() in exts]
    except OSError:
        return []


@app.route('/')
def home():
    return render_template('home.html')


@app.route('/plane')
def plane():
    return render_template('index.html', available_images=_get_static_images())


@app.route('/line-mode')
def line_mode():
    return render_template('line_mode.html')


@app.route('/battleship')
def battleship():
    return render_template('battleship.html')


@app.route('/meme-wars')
def meme_wars():
    return render_template('meme_wars.html', available_images=_get_static_images())


@app.route('/meme-dash')
def meme_dash():
    return render_template('meme_dash.html', available_images=_get_static_images())


@app.route('/ratios')
def ratios_mode():
    return render_template('ratios.html', available_images=_get_static_images())


@app.route('/subitize')
def subitize_mode():
    return render_template('subitize.html')


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

    # Persist display name for leaderboard/social features
    if given_name and not user.display_name:
        user.display_name = given_name
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

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
#
# OUTCOME VOCABULARY (two-tier intentional):
#   1. Skill/challenge contexts (coord plane, ratios, line):
#        'success' = student got it right
#        'incorrect' / 'fail' / 'wrong' = student got it wrong
#   2. Multiplayer game contexts (battleship, memewars, memedash):
#        'win' = the player's team won the game
#        'lose' / 'lost' = the player's team lost the game
#   3. 'completed' = legacy, non-judgmental "play happened"
#
# Both vocabularies are accepted; the backend maps them via SUCCESS_OUTCOMES
# (correct/win) vs the explicit incorrect set further down. Mastery updates
# fire when outcome OR details.correct provides a clear correctness signal.
SUCCESS_OUTCOMES = {'win', 'completed', 'success'}

# Anti-cheat / abuse protection on /api/results.
# Accept the canonical vocabulary plus None.
CANONICAL_OUTCOMES = {
    None, '', 'win', 'lose', 'lost', 'completed', 'success',
    'fail', 'failure', 'incorrect', 'wrong', 'played',
}
# Per-mode upper bound for `score`. Submissions above the cap are clamped
# rather than rejected (forgiving for legacy clients).
MODE_MAX_SCORE = {
    'plane': 1000,
    'line': 1000,
    'battleship': 100,
    'memewars': 100,
    'memedash': 500,
    'ratios': 200,
}
DEFAULT_MAX_SCORE = 1000
MAX_DETAILS_BYTES = 16 * 1024  # 16KB cap on details_json after JSON encoding
# Minimum gap between submissions per user. With a 1.5s floor, a determined
# script can still submit ~40/min; that's enough to be useful for legitimate
# fast-fire ratios drills but kills automated XP farming.
RESULT_RATE_LIMIT_SEC = 1.5
_last_result_at = {}  # user_id -> monotonic timestamp

# 60-second leaderboard cache. The legacy compute path was O(N users * full XP
# scan) per request — ~1200 queries for 200 users. With this cache the heavy
# work runs at most once per minute per process; record_result invalidates it
# eagerly so a fresh play shows in the rankings within seconds.
LEADERBOARD_CACHE_TTL_SEC = 60.0
_leaderboard_cache = {'data': None, 'expires_at': 0.0}

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


import math

# XP and leveling constants
XP_PER_GAME = 10        # base XP for playing any game
XP_SUCCESS_BONUS = 15   # bonus for a successful outcome
XP_SCORE_MULTIPLIER = 2 # XP = score * this (when score exists)
XP_PER_LEVEL = 100      # XP needed scales as XP_PER_LEVEL * level

# Coin economy constants
COINS_PER_GAME = 5          # base coins for playing any game
COINS_SUCCESS_BONUS = 10    # bonus for a successful outcome
COINS_SCORE_FACTOR = 0.5    # coins = floor(score * this)

# ===== Standards & Mastery System (G1 + G2) =====

# Common Core standards our game modes actually address (grades 5-8)
STANDARDS_CATALOG = [
    # --- Grade 5: Geometry ---
    {'code': '5.G.A.1', 'name': 'Graph points on the coordinate plane',
     'strand': 'Geometry', 'grade': 5, 'difficulty': 1,
     'description': 'Use a pair of perpendicular number lines to define a coordinate system; graph points using ordered pairs.'},
    {'code': '5.G.A.2', 'name': 'Graph real-world problems on coordinate plane',
     'strand': 'Geometry', 'grade': 5, 'difficulty': 1,
     'description': 'Represent real-world and mathematical problems by graphing points in the first quadrant.'},

    # --- Grade 6: Ratios & Proportional Relationships ---
    {'code': '6.RP.A.1', 'name': 'Understand ratio concepts',
     'strand': 'Ratios & Proportional Relationships', 'grade': 6, 'difficulty': 2,
     'description': 'Understand the concept of a ratio and use ratio language to describe a ratio relationship.'},
    {'code': '6.RP.A.2', 'name': 'Understand unit rates',
     'strand': 'Ratios & Proportional Relationships', 'grade': 6, 'difficulty': 2,
     'description': 'Understand the concept of a unit rate a/b associated with a ratio a:b.'},
    {'code': '6.RP.A.3', 'name': 'Use ratio reasoning to solve problems',
     'strand': 'Ratios & Proportional Relationships', 'grade': 6, 'difficulty': 2,
     'description': 'Use ratio and rate reasoning to solve real-world and mathematical problems.'},
    {'code': '6.RP.A.3a', 'name': 'Make tables of equivalent ratios',
     'strand': 'Ratios & Proportional Relationships', 'grade': 6, 'difficulty': 2,
     'description': 'Make tables of equivalent ratios, find missing values, and plot pairs on the coordinate plane.'},

    # --- Grade 6: The Number System ---
    {'code': '6.NS.C.6b', 'name': 'Ordered pairs indicate quadrant locations',
     'strand': 'The Number System', 'grade': 6, 'difficulty': 2,
     'description': 'Understand signs of numbers in ordered pairs as indicating locations in quadrants of the coordinate plane.'},
    {'code': '6.NS.C.8', 'name': 'Graph points in all four quadrants',
     'strand': 'The Number System', 'grade': 6, 'difficulty': 2,
     'description': 'Solve problems by graphing points in all four quadrants; use coordinates and absolute value to find distances.'},

    # --- Grade 6: Geometry ---
    {'code': '6.G.A.3', 'name': 'Draw polygons on coordinate plane',
     'strand': 'Geometry', 'grade': 6, 'difficulty': 2,
     'description': 'Draw polygons in the coordinate plane given coordinates for the vertices.'},

    # --- Grade 7: Ratios & Proportional Relationships ---
    {'code': '7.RP.A.1', 'name': 'Compute unit rates with fractions',
     'strand': 'Ratios & Proportional Relationships', 'grade': 7, 'difficulty': 3,
     'description': 'Compute unit rates associated with ratios of fractions.'},
    {'code': '7.RP.A.2', 'name': 'Recognize proportional relationships',
     'strand': 'Ratios & Proportional Relationships', 'grade': 7, 'difficulty': 3,
     'description': 'Recognize and represent proportional relationships between quantities.'},
    {'code': '7.RP.A.2a', 'name': 'Decide if proportional relationship exists',
     'strand': 'Ratios & Proportional Relationships', 'grade': 7, 'difficulty': 3,
     'description': 'Decide whether two quantities are in a proportional relationship.'},
    {'code': '7.RP.A.2b', 'name': 'Identify constant of proportionality',
     'strand': 'Ratios & Proportional Relationships', 'grade': 7, 'difficulty': 3,
     'description': 'Identify the constant of proportionality (unit rate) in tables, graphs, diagrams, equations.'},

    # --- Grade 8: Expressions & Equations ---
    {'code': '8.EE.B.5', 'name': 'Graph proportional relationships as slope',
     'strand': 'Expressions & Equations', 'grade': 8, 'difficulty': 4,
     'description': 'Graph proportional relationships, interpreting the unit rate as the slope of the graph.'},
    {'code': '8.EE.B.6', 'name': 'Derive slope using similar triangles',
     'strand': 'Expressions & Equations', 'grade': 8, 'difficulty': 4,
     'description': 'Use similar triangles to explain why the slope is the same between any two distinct points on a non-vertical line.'},

    # --- Grade 8: Functions ---
    {'code': '8.F.A.1', 'name': 'Understand functions as input-output rules',
     'strand': 'Functions', 'grade': 8, 'difficulty': 4,
     'description': 'Understand that a function assigns to each input exactly one output.'},
    {'code': '8.F.A.3', 'name': 'Interpret y = mx + b as a linear function',
     'strand': 'Functions', 'grade': 8, 'difficulty': 4,
     'description': 'Interpret the equation y = mx + b as defining a linear function whose graph is a straight line.'},
    {'code': '8.F.B.4', 'name': 'Construct linear functions from data',
     'strand': 'Functions', 'grade': 8, 'difficulty': 4,
     'description': 'Construct a function to model a linear relationship; determine rate of change and initial value.'},
    {'code': '8.F.B.5', 'name': 'Analyze graphs of functions',
     'strand': 'Functions', 'grade': 8, 'difficulty': 4,
     'description': 'Describe qualitatively the functional relationship between two quantities by analyzing a graph.'},

    # --- Grade 8: Geometry (Transformations) ---
    {'code': '8.G.A.1', 'name': 'Properties of rigid transformations',
     'strand': 'Geometry', 'grade': 8, 'difficulty': 4,
     'description': 'Verify experimentally the properties of rotations, reflections, and translations.'},
    {'code': '8.G.A.2', 'name': 'Congruence through transformations',
     'strand': 'Geometry', 'grade': 8, 'difficulty': 4,
     'description': 'Understand that a figure is congruent to another if obtained by rotations, reflections, and translations.'},
    {'code': '8.G.A.3', 'name': 'Describe transformation effects using coordinates',
     'strand': 'Geometry', 'grade': 8, 'difficulty': 4,
     'description': 'Describe the effect of dilations, translations, rotations, and reflections on 2D figures using coordinates.'},
    {'code': '8.G.A.4', 'name': 'Similarity through transformations',
     'strand': 'Geometry', 'grade': 8, 'difficulty': 4,
     'description': 'Understand that a figure is similar to another if obtained by rotations, reflections, translations, and dilations.'},
    {'code': '8.G.B.8', 'name': 'Distance between points using Pythagorean Theorem',
     'strand': 'Geometry', 'grade': 8, 'difficulty': 4,
     'description': 'Apply the Pythagorean Theorem to find the distance between two points in a coordinate system.'},

    # --- Grade 5: Operations & Algebraic Thinking ---
    {'code': '5.OA.A.1', 'name': 'Use grouping symbols in expressions',
     'strand': 'Operations & Algebraic Thinking', 'grade': 5, 'difficulty': 1,
     'description': 'Use parentheses, brackets, or braces in numerical expressions, and evaluate expressions with these symbols.'},
    # --- Grade 6: Number System (Division) ---
    {'code': '6.NS.B.2', 'name': 'Fluently divide multi-digit numbers',
     'strand': 'The Number System', 'grade': 6, 'difficulty': 2,
     'description': 'Fluently divide multi-digit numbers using the standard algorithm.'},
    # --- Grade 5: Number & Operations in Base Ten ---
    {'code': '5.NBT.B.5', 'name': 'Fluently multiply multi-digit whole numbers',
     'strand': 'Number & Operations in Base Ten', 'grade': 5, 'difficulty': 1,
     'description': 'Fluently multiply multi-digit whole numbers using the standard algorithm.'},
    {'code': '5.NBT.B.6', 'name': 'Divide with up to 4-digit dividends',
     'strand': 'Number & Operations in Base Ten', 'grade': 5, 'difficulty': 1,
     'description': 'Find whole-number quotients of whole numbers with up to four-digit dividends and two-digit divisors.'},
]

# Map (mode, challenge_type) -> list of standard codes practiced
# Used to tag game results with standards and update mastery
CHALLENGE_STANDARD_MAP = {
    # Coordinate Plane
    ('plane', 'vertex'):       ['5.G.A.1', '5.G.A.2', '6.NS.C.6b', '6.NS.C.8'],
    ('plane', 'line'):         ['8.EE.B.5', '8.F.A.3', '8.F.B.4'],
    ('plane', 'quadrant'):     ['5.G.A.1', '5.G.A.2'],
    ('plane', 'reflect'):      ['8.G.A.1', '8.G.A.3'],
    ('plane', 'midpoint'):     ['5.G.A.1', '6.NS.C.8'],
    ('plane', 'twopoints'):    ['8.EE.B.5', '8.EE.B.6', '8.F.A.3'],
    ('plane', 'distance'):     ['8.G.B.8', '6.NS.C.8'],
    ('plane', 'slopegraph'):   ['8.EE.B.5', '8.EE.B.6'],
    ('plane', 'transform'):    ['8.G.A.1', '8.G.A.2', '8.G.A.3'],
    ('plane', 'polygon'):      ['6.G.A.3', '5.G.A.1'],
    # Line Graphing
    ('line', 'line'):          ['8.EE.B.5', '8.EE.B.6', '8.F.A.3', '8.F.B.4', '8.F.B.5'],
    ('line', 'slope'):         ['8.EE.B.5', '8.EE.B.6', '8.F.B.4'],
    ('line', 'equation'):      ['8.EE.B.5', '8.EE.B.6', '8.F.A.3', '8.F.B.4'],
    ('line', 'predict'):       ['8.F.A.1', '8.F.A.3', '8.F.B.4'],
    # Ratios
    ('ratios', 'create'):      ['6.RP.A.1'],
    ('ratios', 'partpart'):    ['6.RP.A.1'],
    ('ratios', 'partwhole'):   ['6.RP.A.1', '6.RP.A.3'],
    ('ratios', 'equiv'):       ['6.RP.A.3', '6.RP.A.3a'],
    ('ratios', 'unitrate'):    ['6.RP.A.2', '6.RP.A.3'],
    ('ratios', 'table'):       ['6.RP.A.3', '6.RP.A.3a'],
    ('ratios', 'master'):      ['6.RP.A.1', '6.RP.A.3', '6.RP.A.2'],
    ('ratios', 'ratio'):       ['6.RP.A.1'],
    # Battleship / Meme Wars (coordinate grid navigation)
    ('battleship', 'battleship'): ['5.G.A.1', '6.NS.C.6b'],
    ('memewars', 'memewars'):     ['5.G.A.1', '6.NS.C.6b'],
    # Meme Dash (math gates + spatial reasoning)
    ('memedash', 'memedash'):     ['5.OA.A.1', '5.NBT.B.5'],
    # Subitize (operations via visual grouping)
    ('subitize', 'multiply'):     ['5.NBT.B.5', '5.OA.A.1'],
    ('subitize', 'add'):          ['5.OA.A.1'],
    ('subitize', 'subtract'):     ['5.OA.A.1'],
    ('subitize', 'divide'):       ['6.NS.B.2', '5.NBT.B.6'],
    ('subitize', 'mixed'):        ['5.OA.A.1', '5.NBT.B.5'],
}

# Bayesian mastery update parameters
MASTERY_LEARN_RATE = 0.15   # how much correct answers increase mastery
MASTERY_SLIP_RATE = 0.10    # how much incorrect answers decrease mastery
MASTERY_PRIOR = 0.3         # starting mastery probability for new skills


def ensure_standards_seed():
    """Populate the skills table with Common Core standards. Idempotent per code."""
    existing_codes = {s.standard_code for s in Skill.query.all()}
    if len(existing_codes) >= len(STANDARDS_CATALOG):
        return
    for s in STANDARDS_CATALOG:
        if s['code'] in existing_codes:
            continue
        skill = Skill(
            standard_code=s['code'],
            name=s['name'],
            strand=s['strand'],
            difficulty=s.get('difficulty', s.get('grade', 1) - 4),
        )
        db.session.add(skill)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
    # Invalidate the standard->skill_id cache so future lookups re-read the table
    _standard_to_skill_id.clear()


# Cache: standard_code -> skill.id (populated on first use)
_standard_to_skill_id = {}


def get_standard_skill_id(standard_code):
    """Look up skill ID for a standard code, using a cache."""
    if not _standard_to_skill_id:
        for sk in Skill.query.all():
            _standard_to_skill_id[sk.standard_code] = sk.id
    return _standard_to_skill_id.get(standard_code)


def resolve_standards_for_result(mode, details_json):
    """Given a game result's mode and details, return the list of standard codes practiced."""
    det = details_json or {}
    challenge_type = det.get('challenge_type', '')
    # Try specific ratio mode variant first
    ratio_mode = det.get('ratio_mode', '')
    if mode == 'ratios' and ratio_mode:
        codes = CHALLENGE_STANDARD_MAP.get(('ratios', ratio_mode))
        if codes:
            return codes
    # Try (mode, challenge_type)
    codes = CHALLENGE_STANDARD_MAP.get((mode, challenge_type))
    if codes:
        return codes
    # Fallback: try (mode, mode) for modes like battleship
    codes = CHALLENGE_STANDARD_MAP.get((mode, mode))
    if codes:
        return codes
    return []


def update_mastery_for_result(user_id, mode, details_json, is_correct):
    """Update mastery snapshots for all standards practiced in this result."""
    ensure_standards_seed()
    standard_codes = resolve_standards_for_result(mode, details_json)
    if not standard_codes:
        return []

    updated_standards = []
    for code in standard_codes:
        skill_id = get_standard_skill_id(code)
        if not skill_id:
            continue

        snap = MasterySnapshot.query.filter_by(user_id=user_id, skill_id=skill_id).first()
        if not snap:
            snap = MasterySnapshot(
                user_id=user_id,
                skill_id=skill_id,
                mastery_prob=MASTERY_PRIOR,
                se=0.5,
                opportunities=0,
            )
            db.session.add(snap)
            try:
                db.session.flush()
            except Exception:
                # A concurrent request may have created the same (user, skill)
                # row in the gap between our SELECT and INSERT. Roll back this
                # add and re-fetch the canonical row so we update it.
                db.session.rollback()
                snap = MasterySnapshot.query.filter_by(user_id=user_id, skill_id=skill_id).first()
                if not snap:
                    continue

        # Bayesian-inspired update
        p = float(snap.mastery_prob or MASTERY_PRIOR)
        if is_correct:
            p = p + (1 - p) * MASTERY_LEARN_RATE
        else:
            p = p - p * MASTERY_SLIP_RATE

        snap.mastery_prob = round(max(0.01, min(0.99, p)), 3)
        snap.opportunities = (snap.opportunities or 0) + 1
        snap.se = round(max(0.05, 1.0 / math.sqrt((snap.opportunities or 1) + 1)), 3)
        snap.last_evidence_at = func.now()
        snap.updated_at = func.now()

        updated_standards.append({
            'code': code,
            'name': next((s['name'] for s in STANDARDS_CATALOG if s['code'] == code), code),
            'mastery': float(snap.mastery_prob),
            'opportunities': int(snap.opportunities),
        })

    db.session.flush()  # will be committed by the caller
    return updated_standards


def compute_xp_earned(outcome, score):
    """Compute XP earned for a single game result. Centralized so record_result and
    backfill paths agree on the formula."""
    xp = XP_PER_GAME
    if outcome in SUCCESS_OUTCOMES:
        xp += XP_SUCCESS_BONUS
    if score is not None:
        try:
            xp += max(0, int(float(score) * XP_SCORE_MULTIPLIER))
        except (TypeError, ValueError):
            pass
    return xp


def _recompute_total_xp(user_id):
    """Sum XP across all game_results for this user. Used for backfill/repair."""
    rows = db.session.query(GameResult.outcome, GameResult.score).filter_by(user_id=user_id).all()
    return sum(compute_xp_earned(o, s) for o, s in rows)


def compute_xp_and_level(user_id):
    """Return XP/level info. Reads denormalized User.total_xp; backfills from
    game_results on first call (or after schema migration) if NULL."""
    user = User.query.get(user_id)
    total_xp = int(user.total_xp) if (user and user.total_xp is not None) else None
    if total_xp is None:
        total_xp = _recompute_total_xp(user_id)
        if user is not None:
            user.total_xp = total_xp
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
    # Level formula: solve XP_PER_LEVEL * L*(L+1)/2 = totalXP -> L ~ sqrt(2*totalXP/XP_PER_LEVEL)
    level = int((-1 + math.sqrt(1 + 8 * total_xp / XP_PER_LEVEL)) / 2) if total_xp > 0 else 0
    xp_for_current = int(XP_PER_LEVEL * level * (level + 1) / 2)
    xp_for_next = int(XP_PER_LEVEL * (level + 1) * (level + 2) / 2)
    return {
        'total_xp': total_xp,
        'level': level,
        'xp_in_level': total_xp - xp_for_current,
        'xp_needed': xp_for_next - xp_for_current,
    }


LEVEL_TITLES = [
    'Math Rookie', 'Number Cruncher', 'Equation Explorer', 'Graph Guru',
    'Ratio Ruler', 'Data Detective', 'Coordinate Champion', 'Algebra Ace',
    'Geometry Genius', 'Calculus Conqueror', 'Math Wizard', 'Number Ninja',
    'Pattern Pro', 'Function Master', 'Proof Machine', 'Math Legend',
]


def get_level_title(level):
    idx = min(level, len(LEVEL_TITLES) - 1)
    return LEVEL_TITLES[idx]


# Daily streak and goal tracking
DAILY_GOAL_TARGET = 5  # games per day to hit the daily goal


def compute_streak_and_daily(user_id):
    """Compute login streak (consecutive days with activity) and daily goal progress.
    Uses game_results.played_at timestamps. No extra DB columns needed."""
    # Fetch all distinct activity dates for the user (UTC date)
    rows = db.session.query(
        func.date(GameResult.played_at)
    ).filter(
        GameResult.user_id == user_id
    ).distinct().all()

    activity_dates = sorted({r[0] for r in rows if r[0] is not None}, reverse=True)

    today = datetime.date.today()

    # Streak: count consecutive days going backwards from today/yesterday
    streak = 0
    if activity_dates:
        # Check if today or yesterday has activity (streak can still be alive)
        first = activity_dates[0]
        # Convert to date if it's a string (SQLite returns strings)
        if isinstance(first, str):
            activity_dates = [datetime.date.fromisoformat(d) if isinstance(d, str) else d for d in activity_dates]
            activity_dates.sort(reverse=True)
            first = activity_dates[0]

        if first == today:
            streak = 1
            check_date = today - datetime.timedelta(days=1)
        elif first == today - datetime.timedelta(days=1):
            # Yesterday counts - streak still alive but at risk today
            streak = 1
            check_date = today - datetime.timedelta(days=2)
        else:
            streak = 0
            check_date = None

        if check_date is not None:
            date_set = set(activity_dates)
            while check_date in date_set:
                streak += 1
                check_date -= datetime.timedelta(days=1)

    # Daily goal: how many games played today
    games_today = db.session.query(func.count(GameResult.id)).filter(
        GameResult.user_id == user_id,
        func.date(GameResult.played_at) == today
    ).scalar() or 0

    played_today = activity_dates[0] == today if activity_dates else False

    return {
        'streak': streak,
        'played_today': played_today,
        'games_today': int(games_today),
        'daily_goal': DAILY_GOAL_TARGET,
        'daily_goal_met': int(games_today) >= DAILY_GOAL_TARGET,
        'best_streak': streak,  # TODO: track historical best separately
    }


# ---- Daily Quest System ----
import hashlib

QUEST_TEMPLATES = [
    {'type': 'play_mode', 'mode': 'plane', 'count': 3, 'label': 'Play 3 Coordinate Plane games', 'icon': '\U0001f9ed'},
    {'type': 'play_mode', 'mode': 'ratios', 'count': 3, 'label': 'Play 3 Ratio games', 'icon': '\u2797'},
    {'type': 'play_mode', 'mode': 'battleship', 'count': 2, 'label': 'Play 2 Battleship games', 'icon': '\U0001f6a2'},
    {'type': 'play_mode', 'mode': 'memewars', 'count': 2, 'label': 'Play 2 Meme Wars games', 'icon': '\u2694\ufe0f'},
    {'type': 'play_mode', 'mode': 'memedash', 'count': 2, 'label': 'Play 2 Meme Dash games', 'icon': '\u26a1'},
    {'type': 'win_mode', 'mode': 'plane', 'count': 2, 'label': 'Win 2 Coordinate Plane challenges', 'icon': '\U0001f3af'},
    {'type': 'win_mode', 'mode': 'ratios', 'count': 2, 'label': 'Win 2 Ratio challenges', 'icon': '\U0001f3af'},
    {'type': 'win_mode', 'mode': 'battleship', 'count': 1, 'label': 'Win a Battleship game', 'icon': '\U0001f3c6'},
    {'type': 'play_modes', 'count': 3, 'label': 'Play 3 different game modes', 'icon': '\U0001f3ae'},
    {'type': 'play_modes', 'count': 4, 'label': 'Play 4 different game modes', 'icon': '\U0001f579\ufe0f'},
    {'type': 'total_games', 'count': 5, 'label': 'Complete 5 total games', 'icon': '\u2b50'},
    {'type': 'total_games', 'count': 8, 'label': 'Complete 8 total games', 'icon': '\U0001f31f'},
    {'type': 'total_games', 'count': 3, 'label': 'Complete 3 total games', 'icon': '\u2728'},
]
QUESTS_PER_DAY = 3


def get_daily_quests(date=None):
    """Return 3 deterministically-selected quests for the given date."""
    if date is None:
        date = datetime.date.today()
    n = len(QUEST_TEMPLATES)
    indices = []
    for i in range(QUESTS_PER_DAY):
        h = hashlib.sha256(f"{date.isoformat()}:quest:{i}".encode()).hexdigest()
        idx = int(h, 16) % n
        attempts = 0
        while idx in indices and attempts < n:
            idx = (idx + 1) % n
            attempts += 1
        indices.append(idx)
    return [dict(QUEST_TEMPLATES[i], id=i) for i in indices]


def compute_quest_progress(user_id):
    """Compute progress on today's quests from game_results."""
    today = datetime.date.today()
    quests = get_daily_quests(today)

    today_results = GameResult.query.filter(
        GameResult.user_id == user_id,
        func.date(GameResult.played_at) == today
    ).all()

    games_by_mode = {}
    wins_by_mode = {}
    modes_played = set()
    total_games = len(today_results)

    for gr in today_results:
        mode = canonicalize_mode(gr.mode)
        games_by_mode[mode] = games_by_mode.get(mode, 0) + 1
        modes_played.add(mode)
        if gr.outcome in SUCCESS_OUTCOMES:
            wins_by_mode[mode] = wins_by_mode.get(mode, 0) + 1

    result = []
    for q in quests:
        qtype = q['type']
        target = q['count']
        if qtype == 'play_mode':
            current = games_by_mode.get(q['mode'], 0)
        elif qtype == 'win_mode':
            current = wins_by_mode.get(q['mode'], 0)
        elif qtype == 'play_modes':
            current = len(modes_played)
        elif qtype == 'total_games':
            current = total_games
        else:
            current = 0

        completed = current >= target
        result.append({
            'id': q['id'],
            'label': q['label'],
            'icon': q['icon'],
            'target': target,
            'current': min(current, target),
            'completed': completed,
            'progress': min(1.0, current / target) if target > 0 else 1.0,
        })

    all_done = all(r['completed'] for r in result)
    return {
        'quests': result,
        'all_completed': all_done,
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

    # Cross-mode achievements (exploration, streak, mastery)
    cross_mode_achievements = [
        ('explore_3', 'Renaissance Explorer', 'Play at least 3 different game modes', None, 3),
        ('explore_all', 'Renaissance Master', 'Play all 7 game modes', None, 7),
        ('streak_5', 'On Fire', 'Get 5 correct answers in a row (any mode)', None, 5),
        ('streak_10', 'Blazing', 'Get 10 correct answers in a row (any mode)', None, 10),
        ('total_100', 'Century', 'Complete 100 challenges across all modes', None, 100),
        ('total_500', 'Half Thousand', 'Complete 500 challenges across all modes', None, 500),
        ('subitize_t10', 'Subitize 10', 'Complete 10 Subitize challenges', 'subitize', 10),
        ('subitize_t50', 'Subitize 50', 'Complete 50 Subitize challenges', 'subitize', 50),
    ]
    for code, title, desc, m, t in cross_mode_achievements:
        if code not in existing_codes:
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

    # Per-user rate limit (anti-grinding)
    now_ts = time.monotonic()
    last_ts = _last_result_at.get(g.user_id, 0)
    if now_ts - last_ts < RESULT_RATE_LIMIT_SEC:
        return jsonify({
            'error': 'rate_limited',
            'retry_after': round(RESULT_RATE_LIMIT_SEC - (now_ts - last_ts), 2),
        }), 429

    mode = canonicalize_mode(body.get('mode'))
    if mode == 'unknown' or mode not in MODE_SYNONYMS:
        return jsonify({'error': 'invalid_mode'}), 400

    game_name_raw = (body.get('game_name') or mode)
    game_name = (str(game_name_raw)[:120]).strip() or mode

    outcome = (body.get('outcome') or '').strip().lower() or None
    if outcome not in CANONICAL_OUTCOMES:
        return jsonify({'error': 'invalid_outcome'}), 400

    # Validate and clamp score
    score = body.get('score')
    if score is not None:
        try:
            score = float(score)
            if not math.isfinite(score):
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({'error': 'invalid_score'}), 400
        score = max(0.0, min(score, MODE_MAX_SCORE.get(mode, DEFAULT_MAX_SCORE)))

    duration_ms = body.get('duration_ms')
    if duration_ms is not None:
        try:
            duration_ms = max(0, min(int(duration_ms), 24 * 60 * 60 * 1000))
        except (TypeError, ValueError):
            duration_ms = None

    room_pin = body.get('room_pin')
    if room_pin is not None:
        room_pin = str(room_pin)[:32]

    activity_id = body.get('activity_id')

    details_json = body.get('details_json') or body.get('details')
    if details_json is not None:
        try:
            import json as _json_mod
            if len(_json_mod.dumps(details_json)) > MAX_DETAILS_BYTES:
                details_json = None  # silently drop oversized payloads
        except (TypeError, ValueError):
            details_json = None

    # Stamp rate limit AFTER validation passes so failed payloads don't lock the user out
    _last_result_at[g.user_id] = now_ts

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

    # Award coins
    coins_earned = COINS_PER_GAME
    if outcome in SUCCESS_OUTCOMES:
        coins_earned += COINS_SUCCESS_BONUS
    if score is not None:
        coins_earned += max(0, int(float(score) * COINS_SCORE_FACTOR))
    # Increment denormalized total_xp (replaces full table scan in compute_xp_and_level)
    xp_earned = compute_xp_earned(outcome, score)
    user = User.query.get(g.user_id)
    if user:
        user.coins = (user.coins or 0) + coins_earned
        user.total_xp = (user.total_xp or 0) + xp_earned
    # Invalidate leaderboard cache since the rankings can shift
    _leaderboard_cache['expires_at'] = 0

    # Update standards mastery
    det = details_json or {}
    is_correct = det.get('correct') is True or outcome in SUCCESS_OUTCOMES
    is_incorrect = det.get('correct') is False or (outcome or '').lower() in {'incorrect', 'fail', 'wrong', 'lose', 'lost'}
    standards_practiced = []
    if is_correct or is_incorrect:
        standards_practiced = update_mastery_for_result(g.user_id, mode, details_json, is_correct)

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
        # Cross-mode achievements
        unlocked_ids = {ua.achievement_id for ua in UserAchievement.query.filter_by(user_id=g.user_id).all()}
        cross_achs = Achievement.query.filter_by(mode=None).all()
        for a in cross_achs:
            if a.id in unlocked_ids:
                continue
            met = False
            if a.code.startswith('explore_'):
                modes_played = db.session.query(GameResult.mode).filter_by(user_id=g.user_id).distinct().count()
                met = modes_played >= a.threshold
            elif a.code.startswith('total_'):
                total_all = db.session.query(func.count(GameResult.id)).filter(
                    GameResult.user_id == g.user_id,
                    (GameResult.outcome == None) | (GameResult.outcome.in_(list(SUCCESS_OUTCOMES)))
                ).scalar() or 0
                met = int(total_all) >= a.threshold
            if met:
                db.session.add(UserAchievement(user_id=g.user_id, achievement_id=a.id))
                newly_unlocked.append({'code': a.code, 'title': a.title, 'threshold': a.threshold, 'name': a.title})

        if newly_unlocked:
            db.session.commit()

    return jsonify({
        'ok': True,
        'id': int(r.id),
        'new_achievements': newly_unlocked,
        'coins_earned': coins_earned,
        'total_coins': int(user.coins) if user else 0,
        'standards': standards_practiced,
    })


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

    # Pre-compute per-mode completed counts toward achievements.
    # Single GROUP BY query (replaces N separate COUNTs per mode).
    relevant_modes = sorted({a.mode for a in all_achs})
    raw_counts = dict(db.session.query(
        GameResult.mode, func.count(GameResult.id)
    ).filter(
        GameResult.user_id == uid,
        (GameResult.outcome == None) | (GameResult.outcome.in_(list(SUCCESS_OUTCOMES)))
    ).group_by(GameResult.mode).all())
    progress_counts = {}
    for m in relevant_modes:
        modes_list = canonical_mode_group(m)
        progress_counts[m] = sum(int(raw_counts.get(mm, 0) or 0) for mm in modes_list)

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

    # XP and level
    xp_data = compute_xp_and_level(uid)
    xp_data['title'] = get_level_title(xp_data['level'])

    # Streak and daily goal
    streak_data = compute_streak_and_daily(uid)

    # Daily quests
    quest_data = compute_quest_progress(uid)

    # Coins balance
    user = User.query.get(uid)
    coins = int(user.coins or 0) if user else 0

    # Equipped cosmetics
    equipped_items = {}
    if user:
        equipped = UserItem.query.filter_by(user_id=uid, equipped=True).all()
        for ui in equipped:
            item = ShopItem.query.get(ui.item_id)
            if item:
                equipped_items[item.category] = {
                    'code': item.code,
                    'name': item.name,
                    'icon': item.icon,
                    'data': item.data_json,
                }

    # Standards mastery
    ensure_standards_seed()
    all_skills = Skill.query.order_by(Skill.standard_code).all()
    snapshots = {ms.skill_id: ms for ms in MasterySnapshot.query.filter_by(user_id=uid).all()}
    standards_out = []
    strands_summary = {}
    for sk in all_skills:
        snap = snapshots.get(sk.id)
        mastery = float(snap.mastery_prob) if snap else 0.0
        opps = int(snap.opportunities) if snap else 0
        cat_entry = next((s for s in STANDARDS_CATALOG if s['code'] == sk.standard_code), {})
        grade = cat_entry.get('grade', 5)
        standards_out.append({
            'code': sk.standard_code,
            'name': sk.name,
            'strand': sk.strand,
            'grade': grade,
            'mastery': mastery,
            'opportunities': opps,
            'attempted': opps > 0,
        })
        # Aggregate by strand
        ss = strands_summary.setdefault(sk.strand, {'total': 0, 'attempted': 0, 'mastery_sum': 0.0})
        ss['total'] += 1
        if opps > 0:
            ss['attempted'] += 1
            ss['mastery_sum'] += mastery

    # Compute strand averages
    strands_out = []
    for strand_name, ss in sorted(strands_summary.items()):
        avg = (ss['mastery_sum'] / ss['attempted']) if ss['attempted'] > 0 else 0.0
        strands_out.append({
            'strand': strand_name,
            'total': ss['total'],
            'attempted': ss['attempted'],
            'avg_mastery': round(avg, 3),
        })

    return jsonify({
        'recent': recent,
        'per_mode': per_mode,
        'achievements': achievements,
        'xp': xp_data,
        'streak': streak_data,
        'quests': quest_data,
        'coins': coins,
        'equipped': equipped_items,
        'standards': standards_out,
        'strands': strands_out,
    })


def _build_leaderboard_entries():
    """Compute the full sorted leaderboard. Pulled out of /api/leaderboard so the
    cache layer can call it once per TTL window."""
    user_ids = [r[0] for r in db.session.query(GameResult.user_id).distinct().all()]
    entries = []
    for uid in user_ids:
        xp = compute_xp_and_level(uid)
        user = User.query.get(uid)
        name = (user.display_name if user and user.display_name else None) or f'Player {uid}'
        streak = compute_streak_and_daily(uid)

        # Check for equipped cosmetics
        custom_title = None
        frame_data = None
        equipped_cosmetics = UserItem.query.filter_by(user_id=uid, equipped=True).all()
        for ui in equipped_cosmetics:
            item = ShopItem.query.get(ui.item_id)
            if item and item.category == 'title':
                custom_title = item.name
            elif item and item.category == 'avatar_frame':
                frame_data = item.data_json

        entries.append({
            'user_id': int(uid),
            'display_name': name,
            'total_xp': xp['total_xp'],
            'level': xp['level'],
            'title': custom_title or get_level_title(xp['level']),
            'streak': streak['streak'],
            'frame': frame_data,
        })

    entries.sort(key=lambda e: e['total_xp'], reverse=True)
    for i, e in enumerate(entries):
        e['rank'] = i + 1
    return entries


@app.get('/api/leaderboard')
def api_leaderboard():
    """Top XP earners. Auth optional — includes caller's rank if token provided.
    Cached for LEADERBOARD_CACHE_TTL_SEC; invalidated eagerly by record_result."""
    limit = min(int(request.args.get('limit', 20)), 50)

    now_ts = time.monotonic()
    if _leaderboard_cache['data'] is not None and now_ts < _leaderboard_cache['expires_at']:
        entries = _leaderboard_cache['data']
    else:
        entries = _build_leaderboard_entries()
        _leaderboard_cache['data'] = entries
        _leaderboard_cache['expires_at'] = now_ts + LEADERBOARD_CACHE_TTL_SEC

    # Include caller's rank if authenticated
    my_rank = None
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        try:
            token = auth.split(' ', 1)[1]
            claims = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            my_uid = claims.get('uid')
            for e in entries:
                if e['user_id'] == my_uid:
                    my_rank = e
                    break
        except Exception:
            pass

    return jsonify({
        'leaderboard': entries[:limit],
        'total_players': len(entries),
        'my_rank': my_rank,
    })


@app.get('/dashboard')
def dashboard_page():
    return render_template('dashboard.html')


# ------- Shop / Cosmetics API -------

RARITY_ORDER = {'common': 0, 'rare': 1, 'epic': 2, 'legendary': 3}
RARITY_COLORS = {'common': '#9ca3af', 'rare': '#3b82f6', 'epic': '#a855f7', 'legendary': '#f59e0b'}


def ensure_shop_seed():
    """Seed the shop with starter items if empty."""
    if ShopItem.query.first():
        return

    next_id = 1
    items = [
        # Titles — Common
        ShopItem(id=next_id, code='title_meme_lord', name='Meme Lord', description='A title fit for royalty', category='title', rarity='common', price=50, icon='\U0001f451', data_json={}),
        ShopItem(id=(next_id := next_id + 1), code='title_math_nerd', name='Math Nerd', description='Wear it with pride', category='title', rarity='common', price=50, icon='\U0001f913', data_json={}),
        ShopItem(id=(next_id := next_id + 1), code='title_graph_master', name='Graph Master', description='Lines and curves bow to you', category='title', rarity='common', price=75, icon='\U0001f4c8', data_json={}),
        ShopItem(id=(next_id := next_id + 1), code='title_ratio_king', name='Ratio King', description='The ratios obey your command', category='title', rarity='common', price=75, icon='\U0001f468\u200d\U0001f4bb', data_json={}),
        # Titles — Rare
        ShopItem(id=(next_id := next_id + 1), code='title_sigma', name='Sigma Grindset', description='On that grind 24/7', category='title', rarity='rare', price=200, icon='\U0001f4aa', data_json={}),
        ShopItem(id=(next_id := next_id + 1), code='title_galaxy_brain', name='Galaxy Brain', description='Your intellect is cosmic', category='title', rarity='rare', price=250, icon='\U0001f30c', data_json={}),
        ShopItem(id=(next_id := next_id + 1), code='title_speed_demon', name='Speed Demon', description='Fast and furious with numbers', category='title', rarity='rare', price=200, icon='\u26a1', data_json={}),
        # Titles — Epic
        ShopItem(id=(next_id := next_id + 1), code='title_goat', name='The G.O.A.T.', description='Greatest Of All Time', category='title', rarity='epic', price=800, icon='\U0001f410', data_json={}),
        ShopItem(id=(next_id := next_id + 1), code='title_legend', name='Living Legend', description='They write math textbooks about you', category='title', rarity='epic', price=1000, icon='\u2728', data_json={}),
        # Titles — Legendary
        ShopItem(id=(next_id := next_id + 1), code='title_skibidi', name='Skibidi Mathematician', description='The rarest title in the land', category='title', rarity='legendary', price=2500, icon='\U0001f480', data_json={}),

        # Board Themes — Common
        ShopItem(id=(next_id := next_id + 1), code='theme_ocean', name='Ocean Blue', description='Cool blue waters', category='board_theme', rarity='common', price=100, icon='\U0001f30a',
                 data_json={'surface': '#0c1929', 'accent': '#0ea5e9', 'border': '#1e3a5f', 'bg': '#060f1a'}),
        ShopItem(id=(next_id := next_id + 1), code='theme_forest', name='Forest Green', description='Deep in the woods', category='board_theme', rarity='common', price=100, icon='\U0001f332',
                 data_json={'surface': '#0c1f0c', 'accent': '#22c55e', 'border': '#1a3d1a', 'bg': '#061206'}),
        ShopItem(id=(next_id := next_id + 1), code='theme_sunset', name='Sunset Orange', description='Golden hour vibes', category='board_theme', rarity='common', price=100, icon='\U0001f305',
                 data_json={'surface': '#1f150c', 'accent': '#f97316', 'border': '#3d2a1a', 'bg': '#120b06'}),
        # Board Themes — Rare
        ShopItem(id=(next_id := next_id + 1), code='theme_neon', name='Neon Nights', description='Cyberpunk glow', category='board_theme', rarity='rare', price=300, icon='\U0001f3ae',
                 data_json={'surface': '#1a0a2e', 'accent': '#e040fb', 'border': '#2d1b69', 'bg': '#0d0519'}),
        ShopItem(id=(next_id := next_id + 1), code='theme_rose', name='Rose Gold', description='Elegant and refined', category='board_theme', rarity='rare', price=300, icon='\U0001f339',
                 data_json={'surface': '#1f1018', 'accent': '#f472b6', 'border': '#3d1a2e', 'bg': '#120810'}),
        # Board Themes — Epic
        ShopItem(id=(next_id := next_id + 1), code='theme_galaxy', name='Galaxy', description='Stars and nebulae', category='board_theme', rarity='epic', price=800, icon='\U0001f30c',
                 data_json={'surface': '#0a0a1f', 'accent': '#818cf8', 'border': '#1e1e4a', 'bg': '#050510'}),
        # Board Themes — Legendary
        ShopItem(id=(next_id := next_id + 1), code='theme_rainbow', name='Rainbow', description='All the colors', category='board_theme', rarity='legendary', price=2000, icon='\U0001f308',
                 data_json={'surface': '#151524', 'accent': '#f43f5e', 'border': '#2a2a40', 'bg': '#0a0a14',
                            'gradient': 'linear-gradient(135deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7)'}),

        # Avatar Frames — Common
        ShopItem(id=(next_id := next_id + 1), code='frame_fire', name='Fire Frame', description='Your name burns bright', category='avatar_frame', rarity='common', price=75, icon='\U0001f525',
                 data_json={'border_color': '#ef4444', 'glow': 'rgba(239,68,68,0.4)'}),
        ShopItem(id=(next_id := next_id + 1), code='frame_ice', name='Ice Frame', description='Cool as ice', category='avatar_frame', rarity='common', price=75, icon='\u2744\ufe0f',
                 data_json={'border_color': '#38bdf8', 'glow': 'rgba(56,189,248,0.4)'}),
        # Avatar Frames — Rare
        ShopItem(id=(next_id := next_id + 1), code='frame_gold', name='Gold Frame', description='Dripping in gold', category='avatar_frame', rarity='rare', price=250, icon='\U0001f4b0',
                 data_json={'border_color': '#fbbf24', 'glow': 'rgba(251,191,36,0.5)'}),
        # Avatar Frames — Epic
        ShopItem(id=(next_id := next_id + 1), code='frame_diamond', name='Diamond Frame', description='Brilliant and unbreakable', category='avatar_frame', rarity='epic', price=1000, icon='\U0001f48e',
                 data_json={'border_color': '#a78bfa', 'glow': 'rgba(167,139,250,0.5)', 'animated': True}),
        # Avatar Frames — Legendary
        ShopItem(id=(next_id := next_id + 1), code='frame_prismatic', name='Prismatic Frame', description='Shifts through every color', category='avatar_frame', rarity='legendary', price=3000, icon='\U0001fa84',
                 data_json={'border_color': '#f43f5e', 'glow': 'rgba(244,63,94,0.5)', 'animated': True, 'rainbow': True}),
    ]

    db.session.add_all(items)
    db.session.commit()


@app.get('/api/shop')
@require_auth
def api_shop():
    """Browse shop items with ownership/equipped status."""
    ensure_shop_seed()
    uid = g.user_id
    user = User.query.get(uid)
    coins = int(user.coins or 0) if user else 0

    # Get user's owned items
    owned = {ui.item_id: ui.equipped for ui in UserItem.query.filter_by(user_id=uid).all()}

    all_items = ShopItem.query.order_by(ShopItem.category, ShopItem.price).all()
    items_out = []
    for item in all_items:
        items_out.append({
            'id': int(item.id),
            'code': item.code,
            'name': item.name,
            'description': item.description,
            'category': item.category,
            'rarity': item.rarity,
            'rarity_color': RARITY_COLORS.get(item.rarity, '#9ca3af'),
            'price': item.price,
            'icon': item.icon,
            'data': item.data_json,
            'owned': item.id in owned,
            'equipped': owned.get(item.id, False),
            'can_afford': coins >= item.price,
        })

    return jsonify({
        'items': items_out,
        'coins': coins,
        'categories': ['title', 'board_theme', 'avatar_frame'],
    })


@app.post('/api/shop/buy')
@require_auth
def api_shop_buy():
    """Purchase a shop item."""
    ensure_shop_seed()
    body = request.get_json(silent=True) or {}
    item_id = body.get('item_id')
    if not item_id:
        return jsonify({'error': 'missing item_id'}), 400

    item = ShopItem.query.get(item_id)
    if not item:
        return jsonify({'error': 'item_not_found'}), 404

    user = User.query.get(g.user_id)
    if not user:
        return jsonify({'error': 'user_not_found'}), 404

    # Already owned?
    existing = UserItem.query.filter_by(user_id=g.user_id, item_id=item_id).first()
    if existing:
        return jsonify({'error': 'already_owned'}), 400

    # Atomic decrement: only succeeds if coins >= price (prevents double-spend race
    # across concurrent buys, double-clicks, multiple tabs).
    result = db.session.execute(
        db.text("UPDATE users SET coins = coins - :price WHERE id = :uid AND coins >= :price"),
        {'price': int(item.price), 'uid': int(g.user_id)},
    )
    if result.rowcount == 0:
        db.session.rollback()
        balance = int(user.coins or 0)
        return jsonify({'error': 'insufficient_coins', 'have': balance, 'need': item.price}), 400

    ui = UserItem(user_id=g.user_id, item_id=item_id, equipped=False)
    db.session.add(ui)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'database_error'}), 500

    db.session.refresh(user)
    return jsonify({
        'ok': True,
        'item_code': item.code,
        'item_name': item.name,
        'coins_remaining': int(user.coins or 0),
    })


@app.post('/api/shop/equip')
@require_auth
def api_shop_equip():
    """Equip or unequip an owned item. Only one item per category can be equipped."""
    body = request.get_json(silent=True) or {}
    item_id = body.get('item_id')
    equip = body.get('equip', True)

    if not item_id:
        return jsonify({'error': 'missing item_id'}), 400

    item = ShopItem.query.get(item_id)
    if not item:
        return jsonify({'error': 'item_not_found'}), 404

    ui = UserItem.query.filter_by(user_id=g.user_id, item_id=item_id).first()
    if not ui:
        return jsonify({'error': 'not_owned'}), 400

    if equip:
        # Unequip any other item in same category
        category_items = db.session.query(UserItem).join(ShopItem).filter(
            UserItem.user_id == g.user_id,
            ShopItem.category == item.category,
            UserItem.equipped == True
        ).all()
        for ci in category_items:
            ci.equipped = False
        ui.equipped = True
    else:
        ui.equipped = False

    db.session.commit()

    return jsonify({
        'ok': True,
        'item_code': item.code,
        'equipped': ui.equipped,
    })


@app.get('/shop')
def shop_page():
    return render_template('shop.html')


@app.get('/api/me/theme')
@require_auth
def api_my_theme():
    """Lightweight endpoint returning only the user's equipped board theme CSS vars."""
    equipped = UserItem.query.filter_by(user_id=g.user_id, equipped=True).all()
    for ui in equipped:
        item = ShopItem.query.get(ui.item_id)
        if item and item.category == 'board_theme' and item.data_json:
            return jsonify({'theme': item.data_json, 'name': item.name})
    return jsonify({'theme': None})


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
                if inactivity > OWNER_TAKEOVER_SEC:
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

    # Throttle broadcast frequency per room/mode to reduce flooding
    try:
        t = time.time()
        last_emit = float(last_emit_ts[room].get(mode) or 0.0)
        if (t - last_emit) >= EMIT_INTERVAL_MIN:
            emit('state_update', {'room': room, 'mode': mode, 'clientId': client_id, 'state': out_state}, room=room, include_self=False)
            last_emit_ts[room][mode] = t
        # always update last_state_ts to reflect owner activity
        last_state_ts[room][mode] = t
    except Exception:
        try:
            emit('state_update', {'room': room, 'mode': mode, 'clientId': client_id, 'state': out_state}, room=room, include_self=False)
        except Exception:
            pass


# Per-room cooldown to prevent amplification of spurious memedash_win events.
# Real games end at most every ~30s, so a 5s floor is conservative.
_memedash_win_cooldown_sec = 5.0
_memedash_last_win_at = {}  # room_pin -> monotonic timestamp


@socketio.on('memedash_win')
def handle_memedash_win(data):
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'memedash'
    winner_id = (data or {}).get('winnerId')
    winner_name = (data or {}).get('winnerName')
    score = (data or {}).get('score')

    # Sender must be in the room (rejects cross-room spoof attempts)
    sid = request.sid if hasattr(request, 'sid') else None
    if sid and sid not in room_members.get(room, set()):
        return

    # Per-room cooldown — drop duplicates within the cooldown window
    now_ts = time.monotonic()
    last = _memedash_last_win_at.get(room, 0)
    if now_ts - last < _memedash_win_cooldown_sec:
        return
    _memedash_last_win_at[room] = now_ts

    # Sanitize: cap score, truncate name, require basic types
    try:
        score_num = float(score) if score is not None else 0.0
        if not math.isfinite(score_num):
            score_num = 0.0
        score_num = max(0.0, min(score_num, MODE_MAX_SCORE.get('memedash', DEFAULT_MAX_SCORE)))
    except (TypeError, ValueError):
        score_num = 0.0
    if winner_name is not None:
        winner_name = str(winner_name)[:60]
    if winner_id is not None:
        winner_id = str(winner_id)[:80]

    try:
        emit('memedash_win', {'room': room, 'mode': mode, 'winnerId': winner_id, 'winnerName': winner_name, 'score': score_num}, room=room)
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
