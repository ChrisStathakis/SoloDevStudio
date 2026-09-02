"""REST endpoints for in-app project terminals."""
import json
import time

from django.http import StreamingHttpResponse
from django.conf import settings
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.renderers import BaseRenderer
from rest_framework.response import Response

from .models import Project
from .pathutils import normalize_path
from .services.terminal_manager import (
    STREAM_MAX_SECONDS,
    TerminalError,
    terminal_manager,
)


def _error_response(exc: TerminalError):
    return Response({'error': exc.message}, status=exc.http_status)


def _get_owned_project(request, pk):
    try:
        return Project.objects.get(pk=pk, owner=request.user)
    except Project.DoesNotExist:
        return None


def _serialize(sessions):
    return [s.to_dict() for s in sessions]


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def create_project_terminal(request, pk=None):
    """Create a terminal session for a project (mode: 'cmd' | 'script')."""
    project = _get_owned_project(request, pk)
    if project is None:
        return Response({'error': 'Project not found.'}, status=status.HTTP_404_NOT_FOUND)

    mode = (request.data.get('mode') or '').strip().lower()
    if mode not in ('cmd', 'script'):
        return Response(
            {'error': "mode is required and must be 'cmd' or 'script'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    cols = request.data.get('cols')
    rows = request.data.get('rows')

    def _int_or_none(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    cols_i = _int_or_none(cols) if cols is not None else None
    rows_i = _int_or_none(rows) if rows is not None else None
    force_new = request.data.get('force_new') is True

    try:
        if mode == 'cmd':
            cmd_kwargs = {
                'owner_id': request.user.id,
                'project_id': project.id,
                'project_title': project.title,
                'directory': normalize_path(project.cmd_directory),
                'fallback_directory': normalize_path(project.directory_path),
                'python_env': normalize_path(project.python_env),
                'cols': cols_i or 110,
                'rows': rows_i or 28,
            }
            if force_new:
                session, reused = terminal_manager.create_cmd(**cmd_kwargs), False
            else:
                session, reused = terminal_manager.get_or_create_cmd(**cmd_kwargs)
        else:
            run_args = []
            raw_port = (project.port or '').strip()
            if raw_port:
                run_args = raw_port.split()
            session, reused = terminal_manager.get_or_create_script(
                owner_id=request.user.id,
                project_id=project.id,
                project_title=project.title,
                script_path=normalize_path(project.script_path),
                run_args=run_args,
                python_env=normalize_path(project.python_env),
                cols=cols_i or 110,
                rows=rows_i or 28,
            )
    except TerminalError as e:
        return _error_response(e)

    payload = session.to_dict()
    payload['reused'] = reused
    return Response(payload, status=status.HTTP_200_OK if reused else status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def list_terminals(request):
    project_id = request.query_params.get('project') or None
    alive_only = (request.query_params.get('alive') or '').lower() in ('1', 'true', 'yes')
    # A missing project filter must not leak unrelated project consoles into a
    # project drawer. The drawer is only meaningful in a project context.
    if not project_id:
        return Response([])
    sessions = terminal_manager.list_for_user(
        owner_id=request.user.id, project_id=project_id, alive_only=alive_only
    )
    return Response(_serialize(sessions))


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def kill_terminal(request, session_id=None):
    removed = terminal_manager.remove_for_user(session_id, request.user.id)
    if removed is None:
        return Response({'error': 'Terminal session not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def terminal_input(request, session_id=None):
    session = terminal_manager.get_for_user(session_id, request.user.id)
    if session is None:
        return Response({'error': 'Terminal session not found.'}, status=status.HTTP_404_NOT_FOUND)
    data = request.data.get('data')
    if not isinstance(data, str) or data == '':
        return Response({'error': 'data must be a non-empty string.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        session.write(data)
    except TerminalError as e:
        return _error_response(e)
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def terminal_resize(request, session_id=None):
    session = terminal_manager.get_for_user(session_id, request.user.id)
    if session is None:
        return Response({'error': 'Terminal session not found.'}, status=status.HTTP_404_NOT_FOUND)
    try:
        cols = int(request.data.get('cols'))
        rows = int(request.data.get('rows'))
    except (TypeError, ValueError):
        return Response({'error': 'cols and rows must be integers.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        session.resize(cols, rows)
    except TerminalError as e:
        return _error_response(e)
    return Response({'ok': True, 'cols': min(max(cols, 2), 500), 'rows': min(max(rows, 2), 300)})


def _ndjson(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')


class NDJSONPassthroughRenderer(BaseRenderer):
    """Tells DRF content negotiation to accept `application/x-ndjson` for the
    streaming terminal endpoint. Successful requests return a raw
    StreamingHttpResponse; DRF still uses this renderer for regular responses
    such as missing-session errors."""

    media_type = 'application/x-ndjson'
    format = 'ndjson'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is None:
            return b''
        if isinstance(data, bytes):
            return data
        return _ndjson(data)


def _stream_events(session, start_offset):
    """NDJSON event generator: {'d': text, 't': cursor} / {'reset': true,'t'} /
    {'e': true, 'c': code} on exit / {'p': true} keep-alive."""
    cursor = max(0, int(start_offset))
    last_emitted = time.monotonic()
    started = time.monotonic()

    yield _ndjson({'hello': True, 't': cursor})

    while True:
        payload_sent = False

        if terminal_manager.drop_missing_from_registry(session):
            yield _ndjson({'e': True, 'c': None, 'killed': True})
            return

        truncated, text, total, _extra = session.read_since(cursor)
        if truncated:
            # The requested cursor fell outside the retained replay window.
            # Reset the client display and send the retained tail in the same
            # event so a long-running console never becomes blank.
            yield _ndjson({'reset': True, 'd': text, 't': total})
            cursor = total
            last_emitted = time.monotonic()
            continue
        if text:
            cursor = total
            last_emitted = time.monotonic()
            payload_sent = True
            yield _ndjson({'d': text, 't': cursor})

        alive = session.is_alive()
        if not alive:
            # Give the PTY a brief grace period to flush trailing output.
            session.finalize_if_dead()
            truncated, tail, total, _extra = session.read_since(cursor)
            if not truncated and tail:
                yield _ndjson({'d': tail, 't': total})
                cursor = total
                payload_sent = True
            deadline_flushed_at = time.monotonic()
            while time.monotonic() - deadline_flushed_at < 0.35:
                time.sleep(0.05)
                session.finalize_if_dead()
                truncated, tail, total, _extra = session.read_since(cursor)
                if truncated:
                    break
                if tail:
                    yield _ndjson({'d': tail, 't': total})
                    cursor = total
                    payload_sent = True
                    deadline_flushed_at = time.monotonic()
            yield _ndjson({'e': True, 'c': session.exit_code})
            return

        idle = time.monotonic() - last_emitted
        if idle > 15:
            yield _ndjson({'p': True})
            last_emitted = time.monotonic()

        if not payload_sent:
            time.sleep(0.1)

        if time.monotonic() - started > STREAM_MAX_SECONDS:
            yield _ndjson({'k': True, 't': cursor})
            return


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
@renderer_classes([NDJSONPassthroughRenderer])
def terminal_output(request, session_id=None):
    """Long-poll NDJSON stream of terminal output starting at ?after=N."""
    try:
        after = int(request.query_params.get('after', 0))
    except (TypeError, ValueError):
        after = 0

    session = terminal_manager.get_for_user(session_id, request.user.id)
    if session is None:
        return Response({'error': 'Terminal session not found.'}, status=status.HTTP_404_NOT_FOUND)

    resp = StreamingHttpResponse(
        _stream_events(session, after),
        content_type='application/x-ndjson',
    )
    resp['Cache-Control'] = 'no-cache'
    resp['X-Accel-Buffering'] = 'no'
    return resp
