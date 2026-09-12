"""Built-in guidance for lifecycle stage workspaces."""

STAGE_WORKSPACE_CONFIG = {
    'ideation': {
        'guidance': 'Turn the idea into a testable problem and a clear validation decision.',
        'prompts': ['What problem are we solving?', 'Who experiences it and how do we know?', 'What evidence would make us proceed or stop?'],
        'checklist': [
            ('problem-defined', 'Problem statement is clear'),
            ('audience-defined', 'Target audience is identified'),
            ('assumptions-recorded', 'Key assumptions are recorded'),
            ('evidence-collected', 'Validation evidence is captured'),
            ('go-no-go', 'Go / no-go criteria are defined'),
        ],
        'shaping_guidance': 'Shape the build around evidence: make the riskiest assumption visible and decide what the evidence means for the project.',
        'shaping_prompts': ['Which assumption is riskiest, and what evidence would change our mind?', 'What is the current proceed, revise, or stop decision?'],
        'shaping_checklist': [('riskiest-assumption', 'Riskiest assumption is identified'), ('validation-decision', 'Proceed, revise, or stop decision is recorded')],
    },
    'planning': {
        'guidance': 'Turn the validated idea into an achievable scope and delivery plan.',
        'prompts': ['What belongs in the MVP and what is explicitly out of scope?', 'What dependencies, risks, and estimates shape the plan?', 'Which milestones prove progress?'],
        'checklist': [('mvp-scope', 'MVP scope, non-goals, and smallest useful delivery are agreed'), ('requirements', 'Requirements and acceptance criteria are captured'), ('estimates', 'Work is estimated'), ('dependencies-risks', 'Dependencies and risks are recorded'), ('milestones', 'Milestones are defined')],
        'shaping_guidance': 'Make product decisions explicit so the smallest useful delivery has a clear outcome and a reason behind its priorities.',
        'shaping_prompts': ['What measurable outcome will tell us this delivery is useful?', 'Which priority tradeoffs should a future collaborator understand?'],
        'shaping_checklist': [('success-outcome', 'Measurable success outcome is defined'), ('smallest-useful-delivery', 'Smallest useful delivery is chosen'), ('priority-tradeoffs', 'Priority tradeoffs are explained')],
    },
    'architecture': {
        'guidance': 'Make the important product and technical decisions before implementation gets expensive.',
        'prompts': ['What are the key user flows and system boundaries?', 'Which data model and interfaces will remain stable?', 'What security and performance constraints matter?'],
        'checklist': [('ux-flows', 'Core user flows are mapped'), ('data-model', 'Data model is defined'), ('interfaces', 'Interfaces and APIs are documented'), ('constraints', 'Security and performance constraints are listed')],
        'shaping_guidance': 'Connect technical choices to the user outcome. A short rationale makes decisions easier to revisit, communicate, and own.',
        'shaping_prompts': ['How does the proposed approach support a core user journey?', 'Why is this approach a good fit for the outcome and constraints?'],
        'shaping_checklist': [('user-journey-review', 'Approach is reviewed against a core user journey'), ('approach-rationale', 'Chosen approach and rationale are recorded')],
    },
    'development': {
        'guidance': 'Keep implementation focused, observable, and easy to hand off.',
        'prompts': ['Is the local environment reproducible?', 'What implementation slice is next?', 'Which blockers or tradeoffs need recording?'],
        'checklist': [('setup', 'Development setup is verified'), ('slices', 'Implementation is split into deliverable slices'), ('quality', 'Code quality checks are running'), ('documentation', 'Technical documentation is kept current')],
        'shaping_guidance': 'Use a repeatable build → inspect → learn → adjust loop. Each pass should leave a clearer next step, blocker owner, or progress note.',
        'shaping_prompts': ['What did we build, what did we learn by inspecting it, and what will we adjust next?', 'What is the concrete next action for each blocker?', 'What brief progress update would make the current state clear to someone else?'],
        'shaping_checklist': [('build-inspect-learn-adjust', 'Build → inspect → learn → adjust cycle is applied'), ('blocker-next-action', 'Each blocker has a concrete next action'), ('progress-update', 'Brief progress update is recorded')],
    },
    'testing': {
        'guidance': 'Build confidence in the critical paths and make release readiness explicit.',
        'prompts': ['Which user journeys must never regress?', 'What bugs, edge cases, and environments remain?', 'What evidence is required for release?'],
        'checklist': [('critical-paths', 'Critical journeys and edge cases have coverage'), ('regression', 'Regression checks are complete'), ('accessibility', 'Responsive and accessibility checks are complete'), ('security-performance', 'Relevant security and performance checks are complete where applicable'), ('bugs', 'Bugs are triaged'), ('release-criteria', 'Release criteria are assessed')],
        'shaping_guidance': 'Compare the product with the intended outcome, then make a clear release or rework decision with the remaining tradeoffs visible.',
        'shaping_prompts': ['Where does the working product match or miss the intended outcome?', 'Which remaining tradeoffs affect the release or rework decision?'],
        'shaping_checklist': [('outcome-comparison', 'Working product is compared with the intended outcome'), ('release-rework-decision', 'Release or rework decision and accepted tradeoffs are recorded')],
    },
    'deployment': {
        'guidance': 'Ship predictably with a verified environment, observability, and recovery path.',
        'prompts': ['Are configuration and secrets ready for the target environment?', 'How will we detect and recover from a bad release?', 'What should users and operators know about this release?'],
        'checklist': [('environment', 'Deployment environment and configuration are verified'), ('backup-migration', 'Backups and migrations are ready'), ('cicd', 'Release procedure is verified'), ('monitoring-rollback', 'Monitoring and rollback are ready'), ('smoke-test', 'Deployed critical journeys pass a smoke test')],
        'shaping_guidance': 'Own the release communication and follow-through. Make the user-facing change clear and assign a concrete check after shipping.',
        'shaping_prompts': ['What concise update and support instructions should users receive?', 'Who will check the release, what will they check, and when?'],
        'shaping_checklist': [('user-update-support', 'User-facing update and support instructions are prepared'), ('release-check-owner', 'Post-release check and owner are identified')],
    },
    'live': {
        'guidance': 'Learn from real usage, keep the product healthy, and turn feedback into the next iteration.',
        'prompts': ['Which health and usage signals are we watching?', 'What are users telling us?', 'What maintenance and improvements should come next?'],
        'checklist': [('health', 'Health and usage metrics are reviewed'), ('feedback', 'User feedback is captured'), ('incidents', 'Incidents are recorded and reviewed'), ('maintenance', 'Maintenance work is planned')],
        'shaping_guidance': 'Keep ownership beyond launch: connect feedback to the outcome, choose the next improvement, and carry learning into the next build cycle.',
        'shaping_prompts': ['What does feedback say about the success outcome?', 'What is the next improvement and why now?', 'What lesson should shape the next build cycle?'],
        'shaping_checklist': [('feedback-outcome-review', 'Feedback is reviewed against the success outcome'), ('next-improvement', 'Next improvement is chosen'), ('build-cycle-lesson', 'Lesson for the next build cycle is captured')],
    },
}


def checklist_ids(stage):
    config = STAGE_WORKSPACE_CONFIG.get(stage, {})
    return {
        item_id
        for item_id, _label in (
            config.get('checklist', []) + config.get('shaping_checklist', [])
        )
    }


def builtin_checklists(stage):
    """Return independent API-ready copies of the built-in stage lists."""
    config = STAGE_WORKSPACE_CONFIG.get(stage, {})
    return {
        'checklist': [{'id': item_id, 'label': label} for item_id, label in config.get('checklist', [])],
        'shaping_checklist': [{'id': item_id, 'label': label} for item_id, label in config.get('shaping_checklist', [])],
    }


def stage_guidance(stage):
    config = STAGE_WORKSPACE_CONFIG.get(stage, {})
    return {
        'guidance': config.get('guidance', ''),
        'prompts': list(config.get('prompts', [])),
        'shaping_guidance': config.get('shaping_guidance', ''),
        'shaping_prompts': list(config.get('shaping_prompts', [])),
    }


def effective_checklists(owner, stage):
    """Resolve a user's customized defaults or the current built-ins."""
    builtins = builtin_checklists(stage)
    if owner is None or not getattr(owner, 'is_authenticated', False):
        return builtins
    from .models import StageChecklistDefault
    custom = StageChecklistDefault.objects.filter(owner=owner, stage=stage).first()
    if not custom:
        return builtins
    return {
        'checklist': [dict(item) for item in (custom.checklist or [])],
        'shaping_checklist': [dict(item) for item in (custom.shaping_checklist or [])],
    }


def initialize_project_workspaces(project):
    """Create independent definitions for every stage on a new project."""
    from .models import StageWorkspace, ProjectStage
    for stage, _label in ProjectStage.choices:
        definitions = effective_checklists(project.owner, stage)
        StageWorkspace.objects.get_or_create(
            project=project,
            stage=stage,
            defaults={**definitions, 'completed_items': []},
        )
