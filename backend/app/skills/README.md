# Skills

Skills are discrete, reusable automation units. Each skill operates on a single `Project` instance and implements `BaseSkill`.

## Available Skills

| Skill | Description |
|-------|-------------|
| `content_generation` | Generates social media copy + image prompts via Claude API |
| `publish_post` | Publishes approved content to Instagram and Facebook |

## Adding a New Skill

1. Create `app/skills/my_skill/` with `__init__.py` and `skill.py`
2. Extend `BaseSkill` and implement `execute()`, `name`, and `description`
3. Register in `app/skills/__init__.py`
