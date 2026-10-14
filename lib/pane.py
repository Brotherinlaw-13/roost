#!/usr/bin/env python3
"""iTerm side pane for roost, through iTerm's Python API (AppleScript can split
a tab but cannot size the panes).

Runs as a helper that stays connected: one JSON request per line on stdin,
one JSON reply per line on stdout. Connecting takes most of a second, so
roost starts it once and every open/close after that is quick.

  {"id": 1, "op": "open", "tty": "/dev/ttys001", "ratio": 0.4, "command": "...", "title": "..."}
      -> {"id": 1, "pane": "<session id>"}   the new pane on the right takes
         RATIO of the width; focus stays on the left
  {"id": 2, "op": "close", "panes": ["<session id>", ...]}
      -> {"id": 2}
  {"id": 3, "op": "alive", "panes": ["<session id>", ...]}
      -> {"id": 3, "panes": [those still open]}  a pane can close itself
"""
import asyncio
import json
import sys
import iterm2


async def find_by_tty(app, tty):
    for window in app.terminal_windows:
        for tab in window.tabs:
            for session in tab.sessions:
                if await session.async_get_variable('tty') == tty:
                    return session, tab
    return None, None


# pane id -> (session id, its width before the split), to give the width back.
ORIGINAL = {}


async def open_pane(app, req):
    session, tab = await find_by_tty(app, req['tty'])
    if not session:
        return {'error': f"no iTerm session on {req['tty']}"}
    profile = iterm2.LocalWriteOnlyProfile()
    profile.set_use_custom_command('Yes')
    profile.set_command(req['command'])
    if req.get('title'):
        profile.set_name(req['title'])
    # The width is read from iTerm right before the split: the cached
    # grid_size can be a column off, and the widths just after the split are
    # still provisional; either way the sum came out short, iTerm shrank the
    # window to match and the session lost columns. Two panes share the width
    # with a 1-column divider.
    total = int(await session.async_get_variable('columns'))
    height = int(await session.async_get_variable('rows'))
    pane = await session.async_split_pane(vertical=True, profile_customizations=profile)
    right = max(30, round(total * req['ratio']))
    session.preferred_size = iterm2.util.Size(total - right - 1, height)
    pane.preferred_size = iterm2.util.Size(right, height)
    await tab.async_update_layout()
    await session.async_activate()
    ORIGINAL[pane.session_id] = (session.session_id, total)
    return {'pane': pane.session_id}


async def close_panes(app, req):
    for pane_id in req.get('panes', []):
        pane = app.get_session_by_id(pane_id)
        if pane:
            await pane.async_close(force=True)
        await restore_width(app, pane_id)
    return {}


async def restore_width(app, pane_id):
    """iTerm can round a column away when it splits; without this the session
    would come back narrower each time."""
    session_id, total = ORIGINAL.pop(pane_id, (None, None))
    session = app.get_session_by_id(session_id) if session_id else None
    if not session:
        return
    columns = int(await session.async_get_variable('columns'))
    if columns >= total:
        return
    rows = int(await session.async_get_variable('rows'))
    session.preferred_size = iterm2.util.Size(total, rows)
    for window in app.terminal_windows:
        for tab in window.tabs:
            if any(x.session_id == session_id for x in tab.sessions):
                await tab.async_update_layout()
                return


async def alive_panes(app, req):
    alive = []
    for p in req.get('panes', []):
        if app.get_session_by_id(p):
            alive.append(p)
        else:
            await restore_width(app, p)
    return {'panes': alive}


HANDLERS = {'open': open_pane, 'close': close_panes, 'alive': alive_panes}


async def main(connection):
    app = await iterm2.async_get_app(connection)
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    print(json.dumps({'ready': True}), flush=True)
    while line := await reader.readline():
        req = {}
        try:
            req = json.loads(line)
            reply = await HANDLERS[req['op']](app, req)
        except Exception as e:  # one bad request must not stop the helper
            reply = {'error': str(e)}
        print(json.dumps({'id': req.get('id'), **reply}), flush=True)


iterm2.run_until_complete(main)
