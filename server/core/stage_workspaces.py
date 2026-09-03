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
    },
    'planning': {
        'guidance': 'Turn the validated idea into an achievable scope and delivery plan.',
        'prompts': ['What belongs in the MVP and what is explicitly out of scope?', 'What dependencies, risks, and estimates shape the plan?', 'Which milestones prove progress?'],
        'checklist': [('mvp-scope', 'MVP scope and non-goals are agreed'), ('requirements', 'Core requirements are captured'), ('estimates', 'Work is estimated'), ('dependencies-risks', 'Dependencies and risks are recorded'), ('milestones', 'Milestones are defined')],
    },
    'architecture': {
        'guidance': 'Make the important product and technical decisions before implementation gets expensive.',
        'prompts': ['What are the key user flows and system boundaries?', 'Which data model and interfaces will remain stable?', 'What security and performance constraints matter?'],
        'checklist': [('ux-flows', 'UX flows are mapped'), ('data-model', 'Data model is defined'), ('interfaces', 'Interfaces and APIs are documented'), ('decisions', 'Architecture decisions are recorded'), ('constraints', 'Security and performance constraints are listed')],
    },
    'development': {
        'guidance': 'Keep implementation focused, observable, and easy to hand off.',
        'prompts': ['Is the local environment reproducible?', 'What implementation slice is next?', 'Which blockers or tradeoffs need recording?'],
        'checklist': [('setup', 'Development setup is verified'), ('slices', 'Implementation is split into deliverable slices'), ('blockers', 'Blockers and tradeoffs are tracked'), ('quality', 'Code quality checks are running'), ('documentation', 'Technical documentation is kept current')],
    },
    'testing': {
        'guidance': 'Build confidence in the critical paths and make release readiness explicit.',
        'prompts': ['Which user journeys must never regress?', 'What bugs, edge cases, and environments remain?', 'What evidence is required for release?'],
        'checklist': [('critical-paths', 'Critical paths have coverage'), ('regression', 'Regression checks are complete'), ('accessibility', 'Responsive and accessibility checks are complete'), ('bugs', 'Bugs are triaged'), ('release-criteria', 'Release criteria are met')],
    },
    'deployment': {
        'guidance': 'Ship predictably with a verified environment, observability, and recovery path.',
        'prompts': ['Are configuration and secrets ready for the target environment?', 'How will we detect and recover from a bad release?', 'What should users and operators know about this release?'],
        'checklist': [('environment', 'Deployment environment is configured'), ('secrets', 'Secrets and configuration are verified'), ('backup-migration', 'Backups and migrations are ready'), ('cicd', 'CI/CD path is verified'), ('monitoring-rollback', 'Monitoring and rollback are ready'), ('release-notes', 'Release notes are prepared')],
    },
    'live': {
        'guidance': 'Learn from real usage, keep the product healthy, and turn feedback into the next iteration.',
        'prompts': ['Which health and usage signals are we watching?', 'What are users telling us?', 'What maintenance and improvements should come next?'],
        'checklist': [('health', 'Health and usage metrics are reviewed'), ('feedback', 'User feedback is captured'), ('incidents', 'Incidents are recorded and reviewed'), ('maintenance', 'Maintenance work is planned'), ('improvements', 'Improvement backlog is prioritized'), ('retrospective', 'A release retrospective is captured')],
    },
}


def checklist_ids(stage):
    return {item_id for item_id, _label in STAGE_WORKSPACE_CONFIG.get(stage, {}).get('checklist', [])}
