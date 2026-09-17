"""Rule-based planner + risk classifier for the P1 orchestrator.

P1 is deliberately deterministic (no LLM call): it turns a high-level goal
plus existing project context into an approvable step plan. Later phases can
swap propose_plan() for an LLM-backed decomposer without changing the API.
"""
import re

DESTRUCTIVE_PATTERNS = [
    re.compile(r'\brm\s+-rf?\b', re.IGNORECASE),
    re.compile(r'\bdel\s+/[sq]\b', re.IGNORECASE),
    re.compile(r'\bformat\s+[a-z]:', re.IGNORECASE),
    re.compile(r'\bgit\s+reset\s+--hard\b', re.IGNORECASE),
    re.compile(r'\bgit\s+clean\s+-fd', re.IGNORECASE),
    re.compile(r'\bDROP\s+(TABLE|DATABASE)\b', re.IGNORECASE),
    re.compile(r'\bDELETE\s+FROM\b', re.IGNORECASE),
    re.compile(r'\bmigrate\b.*\b--fake\b', re.IGNORECASE),
    re.compile(r'\bshutdown\b', re.IGNORECASE),
    re.compile(r'\btaskkill\b.*\/F\b', re.IGNORECASE),
]

VERIFY_BY_CATEGORY = {
    'bug': 'pytest -q',
    'feature': 'npm test -- --watchAll=false',
    'chore': 'npm run build',
    'improvement': 'npm test -- --watchAll=false',
    'general': '',
}


def classify_risk(text):
    """Return (is_high_risk, reason). Anything destructive needs human approval."""
    hay = str(text or '')
    for rx in DESTRUCTIVE_PATTERNS:
        if rx.search(hay):
            return True, f'Matched destructive pattern: {rx.pattern}'
    lowered = hay.lower()
    if any(k in lowered for k in ('production', 'prod db', 'live db', 'rm -rf', 'delete database')):
        return True, 'References production data or destructive filesystem op'
    return False, ''


def propose_plan(*, goal, project, open_tasks, active_skills, mvp_features):
    """Build an ordered step list from goal + project context.

    Returns list of dicts: {title, task_id, category, skill_ids, verification_command}.
    """
    steps = []
    seen_titles = set()

    def push(title, task_id=None, category='feature'):
        title = (title or '').strip()
        if not title or title.lower() in seen_titles:
            return
        seen_titles.add(title.lower())
        skill_ids = [str(s['id']) for s in (active_skills or [])][:3]
        steps.append({
            'title': title[:400],
            'task_id': str(task_id) if task_id else None,
            'category': category,
            'skill_ids': skill_ids,
            'verification_command': VERIFY_BY_CATEGORY.get(category, ''),
        })

    # 1. Goal text becomes steps. Split on newlines plus common inline
    # separators (->, =>, ;, bullets, numbers) so one-line goals like
    # "audit -> research -> adjust -> implement" still plan as N steps.
    # Long remainders fall back to sentence boundaries.
    text = str(goal or '')
    chunks = re.split(r'[\r\n]+', text)
    parts = []
    for chunk in chunks:
        parts.extend(re.split(r'\s*(?:->|→|=>|;|\|\|)\s*', chunk))
    steps_src = []
    for part in parts:
        cleaned = re.sub(r'^\s*(?:[-*•]+\s*|\d+[.)\]:-]\s*)', '', part).strip()
        if len(cleaned) >= 120 and re.search(r'[.!?]\s+[A-Z0-9]', cleaned):
            for sent in re.split(r'(?<=[.!?])\s+(?=[A-Z0-9])', cleaned):
                sent = sent.strip()
                if len(sent) >= 4:
                    steps_src.append(sent)
        elif len(cleaned) >= 4:
            steps_src.append(cleaned)
    for line in steps_src:
        push(line)
    # 2. Incomplete project tasks that look related (title words overlap goal).
    # Fall back to the newest open tasks when nothing overlaps, so runs on
    # goals with novel wording still ground in real project work.
    goal_words = set(re.findall(r'[a-z0-9]{3,}', str(goal or '').lower()))
    matched_any = False
    for t in (open_tasks or [])[:20]:
        title = str(t.get('title') or '')
        words = set(re.findall(r'[a-z0-9]{3,}', title.lower()))
        if goal_words and words and len(goal_words & words) >= 1:
            push(title, task_id=t.get('id'), category=t.get('category') or 'feature')
            matched_any = True
    if not matched_any:
        for t in (open_tasks or [])[:3]:
            if len(steps) >= 8:
                break
            title = str(t.get('title') or '').strip()
            if title:
                push(title, task_id=t.get('id'), category=t.get('category') or 'feature')
    # 3. MVP features overlap as fallback steps (cap total at 8 for P1).
    for feat in (mvp_features or [])[:8]:
        if len(steps) >= 8:
            break
        feat_str = str(feat or '').strip()
        if feat_str and feat_str.lower() not in seen_titles:
            push(feat_str)
    # 4. Guarantee at least one step.
    if not steps:
        push(str(goal or 'Implement goal')[:400])
    return steps[:8]
