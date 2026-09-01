"""Printable, owner-scoped exports for SoloDev projects and ideas."""

from __future__ import annotations

import base64
import html
import re
from datetime import date, datetime
from io import BytesIO
from typing import Any, Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 1.6 * cm
ACCENT = colors.HexColor('#4f46e5')
INK = colors.HexColor('#111827')
MUTED = colors.HexColor('#64748b')
LINE = colors.HexColor('#dbe3ef')
PAPER = colors.white


def _text(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def _paragraph_text(value: Any) -> str:
    return html.escape(_text(value)).replace('\n', '<br/>')


def _date(value: Any) -> str:
    if not value:
        return 'Not set'
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime('%d %b %Y')
    return _text(value)


def _label(value: Any) -> str:
    return _text(value).replace('_', ' ').replace('-', ' ').title()


def _filename_part(value: str) -> str:
    value = re.sub(r'[^A-Za-z0-9]+', '-', _text(value)).strip('-').lower()
    return value[:80] or 'export'


def _styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='SoloTitle', parent=styles['Title'], fontName='Helvetica-Bold',
        fontSize=22, leading=27, textColor=INK, spaceAfter=5,
    ))
    styles.add(ParagraphStyle(
        name='SoloSubtitle', parent=styles['Normal'], fontName='Helvetica',
        fontSize=10, leading=14, textColor=MUTED, spaceAfter=14,
    ))
    styles.add(ParagraphStyle(
        name='SoloSection', parent=styles['Heading2'], fontName='Helvetica-Bold',
        fontSize=12, leading=16, textColor=ACCENT, spaceBefore=14, spaceAfter=7,
    ))
    styles.add(ParagraphStyle(
        name='SoloBody', parent=styles['Normal'], fontName='Helvetica',
        fontSize=9.5, leading=14, textColor=INK, spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name='SoloSmall', parent=styles['Normal'], fontName='Helvetica',
        fontSize=8, leading=11, textColor=MUTED,
    ))
    styles.add(ParagraphStyle(
        name='SoloTableHeader', parent=styles['Normal'], fontName='Helvetica-Bold',
        fontSize=8, leading=10, textColor=colors.white,
    ))
    styles.add(ParagraphStyle(
        name='SoloTableCell', parent=styles['Normal'], fontName='Helvetica',
        fontSize=8, leading=11, textColor=INK,
    ))
    styles.add(ParagraphStyle(
        name='SoloFooter', parent=styles['Normal'], fontName='Helvetica',
        fontSize=7.5, leading=9, textColor=MUTED, alignment=TA_RIGHT,
    ))
    return styles


def _heading(story: list, styles, title: str) -> None:
    story.append(Paragraph(_paragraph_text(title), styles['SoloSection']))


def _body(story: list, styles, value: Any) -> None:
    text = _text(value)
    if text:
        story.append(Paragraph(_paragraph_text(text), styles['SoloBody']))


def _bullet_list(story: list, styles, values: Iterable[Any]) -> None:
    for value in values or []:
        text = _text(value)
        if text:
            story.append(Paragraph(f'&#8226; {_paragraph_text(text)}', styles['SoloBody']))


def _key_value_table(styles, rows: Iterable[tuple[str, Any]]) -> Table | None:
    cells = []
    for label, value in rows:
        text = _text(value)
        if text:
            cells.append([
                Paragraph(_paragraph_text(label), styles['SoloSmall']),
                Paragraph(_paragraph_text(text), styles['SoloBody']),
            ])
    if not cells:
        return None
    table = Table(cells, colWidths=[3.4 * cm, PAGE_WIDTH - (2 * MARGIN) - (3.4 * cm)])
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -1), 0.35, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return table


def _table(styles, headers: list[str], rows: list[list[Any]], widths: list[float]) -> Table:
    data = [[Paragraph(_paragraph_text(header), styles['SoloTableHeader']) for header in headers]]
    for row in rows:
        data.append([Paragraph(_paragraph_text(value), styles['SoloTableCell']) for value in row])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), ACCENT),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.35, LINE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [PAPER, colors.HexColor('#f8fafc')]),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return table


def _footer(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN, 1.25 * cm, PAGE_WIDTH - MARGIN, 1.25 * cm)
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 0.82 * cm, 'SoloDev Studio')
    canvas.drawRightString(PAGE_WIDTH - MARGIN, 0.82 * cm, f'Page {document.page}')
    canvas.restoreState()


def _build(story: list) -> bytes:
    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=MARGIN,
        leftMargin=MARGIN,
        topMargin=1.7 * cm,
        bottomMargin=1.7 * cm,
        title='SoloDev Studio Export',
        author='SoloDev Studio',
    )
    document.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output.getvalue()


def _data_url_image(value: str) -> Image | None:
    if not value or not value.startswith('data:image/') or ',' not in value:
        return None
    try:
        encoded = value.split(',', 1)[1]
        raw = base64.b64decode(encoded, validate=True)
        image = Image(BytesIO(raw))
        max_width = PAGE_WIDTH - (2 * MARGIN)
        max_height = 12 * cm
        scale = min(max_width / image.imageWidth, max_height / image.imageHeight, 1)
        image.drawWidth = image.imageWidth * scale
        image.drawHeight = image.imageHeight * scale
        return image
    except Exception:
        return None


def project_pdf(project, tasks, time_entries) -> tuple[str, bytes]:
    """Return a printable project brief, excluding agent prompt and skills."""
    styles = _styles()
    story: list = [
        Paragraph('SoloDev Studio', styles['SoloSmall']),
        Paragraph(_paragraph_text(project.title), styles['SoloTitle']),
    ]
    if project.tagline:
        story.append(Paragraph(_paragraph_text(project.tagline), styles['SoloSubtitle']))
    else:
        story.append(Spacer(1, 8))

    _heading(story, styles, 'Project overview')
    overview = _key_value_table(styles, [
        ('Category', _label(project.category)),
        ('Current stage', _label(project.current_stage)),
        ('Start date', _date(project.start_date)),
        ('Target launch', _date(project.target_deadline)),
        ('Actual launch', _date(project.actual_launch_date) if project.actual_launch_date else ''),
        ('Repository', project.repo_url),
        ('Live URL', project.live_url),
        ('Figma', project.figma_url),
        ('Tech stack', ', '.join(project.tech_stack or [])),
        ('Tags', ', '.join(project.tags or [])),
    ])
    if overview:
        story.append(overview)
    _body(story, styles, project.description)

    for title, value in [
        ('The problem', project.problem),
        ('The solution', project.solution),
        ('Target audience', project.target_audience),
        ('Monetization', project.monetization),
    ]:
        if _text(value):
            _heading(story, styles, title)
            _body(story, styles, value)

    if project.mvp_features:
        _heading(story, styles, 'MVP scope')
        _bullet_list(story, styles, project.mvp_features)

    if project.notes:
        _heading(story, styles, 'Notes')
        _body(story, styles, project.notes)

    _heading(story, styles, 'Milestones')
    milestone_rows = [
        [milestone.title, _label(milestone.stage), _date(milestone.target_date), 'Complete' if milestone.completed else 'Open', milestone.description]
        for milestone in project.milestones.all()
    ]
    if milestone_rows:
        story.append(_table(styles, ['Milestone', 'Stage', 'Target', 'Status', 'Description'], milestone_rows,
                            [4.4 * cm, 2.3 * cm, 2.1 * cm, 1.8 * cm, 5.4 * cm]))
    else:
        _body(story, styles, 'No milestones yet.')

    _heading(story, styles, 'Tasks and checklist')
    if tasks:
        task_rows = []
        for task in tasks:
            checklist = '\n'.join(f"{'[x]' if subtask.completed else '[ ]'} {subtask.title}" for subtask in task.subtasks.all())
            details = task.description or ''
            if checklist:
                details = f'{details}\n{checklist}'.strip()
            task_rows.append([
                task.title,
                _label(task.stage),
                _label(task.category),
                'Complete' if task.completed else 'Open',
                details,
            ])
        story.append(_table(styles, ['Task', 'Stage', 'Type', 'Status', 'Description and checklist'], task_rows,
                            [4.2 * cm, 2.2 * cm, 1.8 * cm, 1.7 * cm, 6.1 * cm]))
    else:
        _body(story, styles, 'No tasks yet.')

    logged_seconds = sum(entry.duration_seconds or 0 for entry in time_entries)
    total_minutes = round(logged_seconds / 60)
    completed_tasks = sum(1 for task in tasks if task.completed)
    _heading(story, styles, 'Time summary')
    summary = _key_value_table(styles, [
        ('Completed tasks', f'{completed_tasks} of {len(tasks)}'),
        ('Logged time', f'{total_minutes // 60}h {total_minutes % 60}m'),
        ('Logged sessions', str(len(time_entries))),
    ])
    if summary:
        story.append(summary)

    return f'{_filename_part(project.title)}-project-brief.pdf', _build(story)


def idea_pdf(idea) -> tuple[str, bytes]:
    """Return a complete concept brief including optional sketch and research."""
    styles = _styles()
    story: list = [
        Paragraph('SoloDev Studio', styles['SoloSmall']),
        Paragraph(_paragraph_text(idea.title), styles['SoloTitle']),
    ]
    if idea.tagline:
        story.append(Paragraph(_paragraph_text(idea.tagline), styles['SoloSubtitle']))
    else:
        story.append(Spacer(1, 8))

    _heading(story, styles, 'Concept overview')
    overview = _key_value_table(styles, [
        ('Category', _label(idea.category)),
        ('Status', _label(idea.status)),
        ('Tags', ', '.join(idea.tags or [])),
        ('Created', _date(idea.created_at)),
        ('Last updated', _date(idea.updated_at)),
    ])
    if overview:
        story.append(overview)

    for title, value in [
        ('The problem', idea.problem),
        ('The solution', idea.solution),
        ('Target audience', idea.target_audience),
        ('Monetization', idea.monetization),
    ]:
        if _text(value):
            _heading(story, styles, title)
            _body(story, styles, value)

    if idea.mvp_features:
        _heading(story, styles, 'MVP scope')
        _bullet_list(story, styles, idea.mvp_features)

    if idea.notes:
        _heading(story, styles, 'Notes')
        _body(story, styles, idea.notes)

    image = _data_url_image(idea.sketch_data_url or '')
    if image:
        _heading(story, styles, 'Concept sketch')
        story.append(KeepTogether([image, Spacer(1, 4)]))

    research: dict[str, Any] = idea.market_research if isinstance(idea.market_research, dict) else {}
    if research:
        story.append(PageBreak())
        _heading(story, styles, 'Saved market research')
        _body(story, styles, research.get('marketSummary'))
        for title, key in [
            ('Target audience', 'targetAudience'),
            ('Feasibility rating', 'feasibilityRating'),
            ('Market demand rating', 'marketDemandRating'),
        ]:
            value = research.get(key)
            if value not in (None, '', []):
                _heading(story, styles, title)
                _body(story, styles, value)
        for title, key in [
            ('Suggested MVP features', 'suggestedMvpFeatures'),
            ('Monetization ideas', 'monetizationIdeas'),
            ('Key risks', 'keyRisks'),
            ('Actionable next steps', 'actionableNextSteps'),
        ]:
            if research.get(key):
                _heading(story, styles, title)
                _bullet_list(story, styles, research.get(key))
        competitors = research.get('competitors') or []
        if competitors:
            _heading(story, styles, 'Competitors')
            rows = [[
                item.get('name', ''), item.get('description', ''), item.get('pricing', ''), item.get('differentiationOpportunity', ''),
            ] for item in competitors if isinstance(item, dict)]
            if rows:
                story.append(_table(styles, ['Competitor', 'Description', 'Pricing', 'Opportunity'], rows,
                                    [3.2 * cm, 5.1 * cm, 2.7 * cm, 5 * cm]))
        sources = research.get('sources') or []
        if sources:
            _heading(story, styles, 'Sources')
            _bullet_list(story, styles, [
                f"{item.get('title', 'Source')}: {item.get('url', '')}" for item in sources if isinstance(item, dict)
            ])

    return f'{_filename_part(idea.title)}-idea-brief.pdf', _build(story)
