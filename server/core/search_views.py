"""Free web-search research endpoints (replaces Gemini).

Uses ``ddgs`` (DuckDuckGo, no API key) with a small deterministic
summarizer so results fit the existing frontend shapes
(MarketResearchResult / TechResearchResult).
Works in browser dev and in the frozen desktop backend.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlparse

from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle


class ResearchThrottle(SimpleRateThrottle):
    scope = "research"
    rate = "20/hour"

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return f"research_{request.user.pk}"
        return self.get_ident(request)


def _run_search(queries: list[str], max_results: int = 8) -> tuple[list[dict], list[str]]:
    """Run ddgs text search for each query. Never raises — returns ([], queries) on failure."""
    sources: list[dict] = []
    seen: set[str] = set()
    try:
        from ddgs import DDGS
    except Exception:
        return [], queries
    try:
        with DDGS() as ddgs:
            for q in queries:
                try:
                    for r in ddgs.text(q, max_results=max_results):
                        url = (r.get("href") or r.get("url") or "").strip()
                        if not url or url in seen:
                            continue
                        seen.add(url)
                        sources.append({
                            "title": (r.get("title") or url)[:200],
                            "url": url,
                            "snippet": (r.get("body") or "")[:500],
                        })
                        if len(sources) >= max_results * len(queries):
                            break
                except Exception:
                    continue
    except Exception:
        pass
    return sources, queries


def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return url


def summarize_market(title: str, tagline: str, problem: str, solution: str,
                     category: str, sources: list[dict], queries: list[str]) -> dict:
    competitors = []
    for s in sources[:6]:
        competitors.append({
            "name": _domain(s["url"]) or s["title"][:60],
            "description": s.get("snippet", "")[:300] or s["title"],
            "pricing": "",
            "differentiationOpportunity": "Position against this incumbent with a narrower solo-dev niche.",
        })
    now = datetime.now(timezone.utc).isoformat()
    summary_bits = [f"Found {len(sources)} web sources for “{title}”"]
    if category:
        summary_bits.append(f"in {category}")
    if problem:
        summary_bits.append(f"around: {problem[:160]}")
    market_summary = " ".join(summary_bits) + ". Review competitors below to pick a narrow entry wedge."
    top_titles = [s["title"] for s in sources[:3]]
    mvp = top_titles if top_titles else [f"Minimal {title} prototype", "Landing + waitlist", "Single paid tier"]
    return {
        "marketSummary": market_summary,
        "competitors": competitors,
        "targetAudience": f"Solo founders needing {solution[:120] if solution else title}",
        "suggestedMvpFeatures": mvp[:5],
        "monetizationIdeas": ["One-time license", "Monthly subscription", "Usage-based add-on"],
        "feasibilityRating": 3,
        "marketDemandRating": 3 if len(sources) >= 4 else 2,
        "keyRisks": ["Crowded incumbents — differentiate narrowly", "DDG results are a proxy, validate with users"],
        "actionableNextSteps": ["Interview 5 target users", "Ship landing page", "Build smallest paid slice"],
        "sources": [{"title": s["title"], "url": s["url"]} for s in sources],
        "searchQueries": queries,
        "researchedAt": now,
    }


def summarize_tech(title: str, category: str, description: str,
                   current_stack: list, sources: list[dict], queries: list[str]) -> dict:
    stack = []
    for s in sources[:5]:
        stack.append({
            "layer": "Reference",
            "tool": _domain(s["url"]) or s["title"][:60],
            "why": (s.get("snippet", "")[:220] or "Mentioned in web results for this stack."),
        })
    libs = [{"name": (_domain(s["url"]) or s["title"][:40]), "purpose": (s.get("snippet", "")[:140] or "Related tool")} for s in sources[:4]]
    now = datetime.now(timezone.utc).isoformat()
    summary = f"Found {len(sources)} web references for “{title}” ({category or 'Web App'}). Prefer boring, solo-maintainable picks; current stack: {', '.join(current_stack) if current_stack else 'none specified'}."
    return {
        "summary": summary,
        "recommendedStack": stack,
        "trendingLibraries": libs,
        "potentialPitfalls": ["Over-engineering — keep one DB, one host", "DDG results are a proxy, check docs before adopting"],
        "sources": [{"title": s["title"], "url": s["url"]} for s in sources],
        "searchQueries": queries,
        "researchedAt": now,
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResearchThrottle])
def market_research_view(request):
    data = request.data or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return Response({"detail": "Idea title is required."}, status=400)
    tagline = str(data.get("tagline") or "")
    problem = str(data.get("problem") or "")
    solution = str(data.get("solution") or "")
    category = str(data.get("category") or "")
    queries = [f"{title} {category} competitors".strip(), f"{title} pricing alternatives".strip(), f"{problem[:80]} existing tools".strip() if problem else f"{title} market".strip()]
    sources, queries = _run_search(queries, max_results=5)
    result = summarize_market(title, tagline, problem, solution, category, sources, queries)
    return Response({"data": result, "sources": result["sources"], "searchQueries": queries})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResearchThrottle])
def tech_research_view(request):
    data = request.data or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return Response({"detail": "Project or idea title is required."}, status=400)
    category = str(data.get("category") or "")
    description = str(data.get("description") or "")
    current_stack = data.get("currentTechStack") or []
    if not isinstance(current_stack, list):
        current_stack = [str(current_stack)]
    queries = [f"best tech stack {title} {category}".strip(), f"{title} boilerplate open source".strip()]
    sources, queries = _run_search(queries, max_results=5)
    result = summarize_tech(title, category, description, current_stack, sources, queries)
    return Response({"data": result, "sources": result["sources"], "searchQueries": queries})
