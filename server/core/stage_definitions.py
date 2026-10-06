"""Owner-scoped lifecycle stage definitions (CRUD over the 7 built-ins)."""
import re

from django.db import transaction
from django.utils.text import slugify

from .models import (
    DEFAULT_STAGE_DEFINITIONS,
    Milestone,
    Project,
    StageDefinition,
    Task,
    TimeEntry,
)

SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


def ensure_stage_definitions(owner):
    """Seed the 7 built-ins on first use; returns ordered queryset list."""
    existing = list(StageDefinition.objects.filter(owner=owner).order_by('order', 'label'))
    if existing:
        return existing
    with transaction.atomic():
        # Re-check inside the transaction to avoid duplicate seeds.
        existing = list(StageDefinition.objects.select_for_update().filter(owner=owner))
        if existing:
            return sorted(existing, key=lambda s: (s.order, s.label))
        created = [
            StageDefinition(
                owner=owner,
                key=item['key'],
                label=item['label'],
                description=item.get('description', ''),
                color=item.get('color', '#6366f1'),
                order=item.get('order', idx + 1),
                is_active=True,
                is_builtin=True,
                builtin_key=item['key'],
            )
            for idx, item in enumerate(DEFAULT_STAGE_DEFINITIONS)
        ]
        StageDefinition.objects.bulk_create(created)
    return list(StageDefinition.objects.filter(owner=owner).order_by('order', 'label'))


def ordered_definitions(owner):
    return ensure_stage_definitions(owner)


def valid_stage_keys(owner):
    """All known keys for the owner (active + hidden + legacy built-ins)."""
    keys = {item['key'] for item in DEFAULT_STAGE_DEFINITIONS}
    for key in StageDefinition.objects.filter(owner=owner).values_list('key', flat=True):
        keys.add(key)
    return keys


def active_stage_keys(owner):
    definitions = ensure_stage_definitions(owner)
    return [d.key for d in definitions if d.is_active]


def stage_usage_counts(owner, key):
    """How many records still reference a stage key (for safe delete/hide)."""
    return {
        'projects': Project.objects.filter(owner=owner, current_stage=key).count(),
        'tasks': Task.objects.filter(project__owner=owner, stage=key).count(),
        'milestones': Milestone.objects.filter(project__owner=owner, stage=key).count(),
        'timeEntries': TimeEntry.objects.filter(owner=owner, stage=key).count(),
    }


def unique_key_for_label(owner, label, ignore_pk=None):
    base = (slugify(label or '') or 'stage')[:40].strip('-') or 'stage'
    candidate = base
    suffix = 2
    while True:
        query = StageDefinition.objects.filter(owner=owner, key=candidate)
        if ignore_pk:
            query = query.exclude(pk=ignore_pk)
        if not query.exists():
            return candidate
        suffix_str = f'-{suffix}'
        candidate = (base[: 40 - len(suffix_str)] + suffix_str).strip('-')
        suffix += 1


def serialize_definition(definition, usage=None):
    return {
        'id': str(definition.id),
        'key': definition.key,
        'label': definition.label,
        'description': definition.description or '',
        'color': definition.color or '#6366f1',
        'order': definition.order,
        'is_active': bool(definition.is_active),
        'is_builtin': bool(definition.is_builtin),
        'builtin_key': definition.builtin_key or '',
        'usage': usage,
        'created_at': definition.created_at,
        'updated_at': definition.updated_at,
    }


def default_label_for_key(key):
    for item in DEFAULT_STAGE_DEFINITIONS:
        if item['key'] == key:
            return item['label']
    return key


def stage_label(owner, key):
    """Resolve a human label for a stage key (custom → default → key)."""
    if not key:
        return ''
    try:
        row = StageDefinition.objects.filter(owner=owner, key=key).values_list('label', flat=True).first()
        if row:
            return row
    except Exception:
        pass
    return default_label_for_key(key)


def stage_label_map(owner):
    mapping = {item['key']: item['label'] for item in DEFAULT_STAGE_DEFINITIONS}
    try:
        for key, label in StageDefinition.objects.filter(owner=owner).values_list('key', 'label'):
            mapping[key] = label
    except Exception:
        pass
    return mapping


def reset_to_defaults(owner):
    StageDefinition.objects.filter(owner=owner).delete()
    return ensure_stage_definitions(owner)


def migrate_stage_references(owner, from_key, to_key):
    """Bulk-move every reference from one stage key to another."""
    with transaction.atomic():
        Project.objects.filter(owner=owner, current_stage=from_key).update(current_stage=to_key)
        Task.objects.filter(project__owner=owner, stage=from_key).update(stage=to_key)
        Milestone.objects.filter(project__owner=owner, stage=from_key).update(stage=to_key)
        TimeEntry.objects.filter(owner=owner, stage=from_key).update(stage=to_key)
        from .models import StageWorkspace, StageChecklistDefault, StageReview
        for model in (StageWorkspace, StageChecklistDefault, StageReview):
            if model is StageWorkspace:
                # Merge workspaces when the target already exists.
                for workspace in model.objects.filter(project__owner=owner, stage=from_key):
                    if model.objects.filter(project=workspace.project, stage=to_key).exists():
                        workspace.delete()
                    else:
                        workspace.stage = to_key
                        workspace.save(update_fields=['stage'])
            else:
                for row in model.objects.filter(stage=from_key):
                    if model is StageChecklistDefault and getattr(row, 'owner_id', None) != owner.id:
                        continue
                    if model is StageReview and getattr(row.project, 'owner_id', None) != owner.id:
                        continue
                    row.stage = to_key
                    row.save(update_fields=['stage'])
