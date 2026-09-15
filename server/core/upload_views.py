"""Persist pasted/dropped images so consoles can consume them as file inputs.

Terminals only accept text, so when the user pastes a bitmap into a CMD
drawer the frontend uploads it here first and then types the quoted file
path into the shell. Files live next to the SQLite database
(`<db-dir>/uploads/`), which is writable both in web dev and in the frozen
desktop backend (the exe receives `--db-path` under the user's app data).
"""
import uuid
from pathlib import Path

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

MAX_UPLOAD_BYTES = 10 * 1024 * 1024

ALLOWED_TYPES = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
}


def upload_root() -> Path:
    db_path = Path(settings.DATABASES['default']['NAME'])
    root = db_path.parent / 'uploads'
    root.mkdir(parents=True, exist_ok=True)
    return root


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def upload_image(request):
    upload = request.FILES.get('image')
    if upload is None:
        return Response({'error': 'No image file provided (field "image").'}, status=status.HTTP_400_BAD_REQUEST)
    content_type = (upload.content_type or '').split(';')[0].strip().lower()
    ext = ALLOWED_TYPES.get(content_type)
    if ext is None:
        return Response({'error': f'Unsupported image type: {content_type or "unknown"}.'}, status=status.HTTP_400_BAD_REQUEST)
    if upload.size and upload.size > MAX_UPLOAD_BYTES:
        return Response({'error': 'Image is too large (limit 10 MB).'}, status=status.HTTP_400_BAD_REQUEST)
    dest = upload_root() / f'{uuid.uuid4().hex}{ext}'
    with dest.open('wb') as handle:
        for chunk in upload.chunks():
            handle.write(chunk)
    if dest.stat().st_size > MAX_UPLOAD_BYTES:
        dest.unlink(missing_ok=True)
        return Response({'error': 'Image is too large (limit 10 MB).'}, status=status.HTTP_400_BAD_REQUEST)
    return Response({'path': str(dest), 'name': dest.name}, status=status.HTTP_201_CREATED)
