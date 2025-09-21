from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, join_room, leave_room, emit
import os
import random
from collections import defaultdict

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory state storage per room and mode.
# rooms_state[room]['plane'] or ['line'] -> last known state (dict)
rooms_state = defaultdict(lambda: {'plane': None, 'line': None, 'battleship': None, 'memewars': None})
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


# Socket.IO events
@socketio.on('join')
def handle_join(data):
    room = (data or {}).get('room') or request.args.get('room') or request.path or '/'
    mode = (data or {}).get('mode') or 'plane'
    join_room(room)
    room_members[room].add(request.sid)

    # Team role assignment (Battleship and Meme Wars): first joiner = 'A', second = 'B', others spectate
    if (mode or '').lower() in ('battleship', 'memewars', 'meme-wars'):
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
    state = rooms_state[room].get(mode)
    if state is not None:
        emit('state', {'room': room, 'mode': mode, 'state': state})


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
    state = (data or {}).get('state')
    if state is None:
        return
    # Store and broadcast to room except sender
    rooms_state[room][mode] = state
    emit('state_update', {'room': room, 'mode': mode, 'clientId': client_id, 'state': state}, room=room, include_self=False)


if __name__ == '__main__':
    # Use SocketIO server to enable WebSockets
    socketio.run(app, debug=True)
