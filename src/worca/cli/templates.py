"""CLI subcommands for managing pipeline templates.

Subcommands:
  worca templates list              — tabular output of all templates
  worca templates show <id>         — pretty-print template.json for a given ID
  worca templates save <id>         — snapshot current settings as template
  worca templates delete <id>       — remove a project or user template
"""

import json
import sys
from pathlib import Path

from worca.orchestrator.templates import TemplateResolver


def _resolve_dirs():
    """Return (builtin_dir, project_dir, user_dir) for TemplateResolver.

    builtin_dir: .claude/worca/templates/ (runtime copy) when inside a project,
                 or src/worca/templates/ from the installed package outside a project
    project_dir: .claude/templates/ relative to git root (or None if not in a repo)
    user_dir:    ~/.worca/templates/
    """
    # Walk up to find git root
    git_root = None
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".git").exists():
            git_root = parent
            break

    if git_root is not None:
        builtin_dir = git_root / ".claude" / "worca" / "templates"
        project_dir = git_root / ".claude" / "templates"
    else:
        builtin_dir = Path(__file__).parent.parent / "templates"
        project_dir = None

    user_dir = Path.home() / ".worca" / "templates"
    return builtin_dir, project_dir, user_dir


def _make_resolver():
    builtin_dir, project_dir, user_dir = _resolve_dirs()
    return TemplateResolver(builtin_dir, project_dir, user_dir)


def cmd_templates_list(_args):
    """worca templates list — tabular output."""
    resolver = _make_resolver()
    templates = resolver.list()

    col_id = max((len(t.id) for t in templates), default=2)
    col_id = max(col_id, len("ID"))
    col_name = max((len(t.name) for t in templates), default=4)
    col_name = max(col_name, len("NAME"))
    col_tier = max((len(t.tier) for t in templates), default=4)
    col_tier = max(col_tier, len("TIER"))

    header = (
        f"{'ID':<{col_id}}  {'NAME':<{col_name}}  {'TIER':<{col_tier}}  TAGS"
    )
    print(header)
    print("-" * (col_id + col_name + col_tier + 10))

    for t in templates:
        tags_str = ", ".join(t.tags) if t.tags else "-"
        print(f"{t.id:<{col_id}}  {t.name:<{col_name}}  {t.tier:<{col_tier}}  {tags_str}")


def cmd_templates_show(args):
    """worca templates show <id> — pretty-print template.json."""
    resolver = _make_resolver()
    template = resolver.get(args.template_id)
    if template is None:
        print(
            f"error: template '{args.template_id}' not found",
            file=sys.stderr,
        )
        raise SystemExit(1)

    data = json.loads(Path(template.source_dir, "template.json").read_text())
    data["tier"] = template.tier
    print(json.dumps(data, indent=2))


def register_subcommand(sub):
    """Register `worca templates` with its sub-subcommands into the given subparser group."""
    templates_parser = sub.add_parser("templates", help="Manage pipeline templates")
    templates_sub = templates_parser.add_subparsers(dest="templates_command")

    # list
    templates_sub.add_parser("list", help="List all available templates")

    # show
    show_parser = templates_sub.add_parser("show", help="Show details of a template")
    show_parser.add_argument("template_id", help="Template ID to show")

    # save
    save_parser = templates_sub.add_parser(
        "save", help="Snapshot current settings as a template"
    )
    save_parser.add_argument("template_id", help="Template ID to create")
    save_parser.add_argument("--description", default="", help="Short description of the template")
    save_parser.add_argument(
        "--global",
        dest="global_",
        action="store_true",
        default=False,
        help="Save to user-global scope (~/.worca/templates/)",
    )

    # delete
    delete_parser = templates_sub.add_parser("delete", help="Delete a project or user template")
    delete_parser.add_argument("template_id", help="Template ID to delete")
    delete_parser.add_argument(
        "--global",
        dest="global_",
        action="store_true",
        default=False,
        help="Delete from user-global scope (~/.worca/templates/)",
    )

    return templates_parser


def _load_current_worca_config() -> dict:
    """Read worca config from .claude/settings.json if it exists, else return empty dict."""
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".git").exists():
            settings_path = parent / ".claude" / "settings.json"
            if settings_path.exists():
                try:
                    data = json.loads(settings_path.read_text())
                    return data.get("worca", {})
                except (json.JSONDecodeError, OSError):
                    pass
            break
    return {}


def cmd_templates_save(args):
    """worca templates save <id> — snapshot current settings as template."""
    resolver = _make_resolver()
    scope = "user" if args.global_ else "project"
    template_id = args.template_id
    description = args.description or ""
    name = template_id.replace("-", " ").title()
    config = _load_current_worca_config()

    template_data = {
        "id": template_id,
        "name": name,
        "description": description,
        "tags": [],
        "config": config,
    }

    from worca.orchestrator.templates import TemplateError
    try:
        template = resolver.save(template_data, scope=scope)
    except TemplateError as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(1)

    tier_label = "user (~/.worca/templates/)" if scope == "user" else "project (.claude/templates/)"
    print(f"saved template '{template.id}' to {tier_label}")


def cmd_templates_delete(args):
    """worca templates delete <id> — remove a project or user template."""
    resolver = _make_resolver()
    scope = "user" if args.global_ else "project"
    template_id = args.template_id

    from worca.orchestrator.templates import TemplateError
    try:
        resolver.delete(template_id, scope=scope)
    except TemplateError as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(1)

    tier_label = "user" if scope == "user" else "project"
    print(f"deleted {tier_label} template '{template_id}'")


def cmd_templates(args):
    """Dispatch worca templates subcommand."""
    if not args.templates_command:
        print("error: specify a templates subcommand: list, show, save, delete", file=sys.stderr)
        raise SystemExit(1)
    if args.templates_command == "list":
        cmd_templates_list(args)
    elif args.templates_command == "show":
        cmd_templates_show(args)
    elif args.templates_command == "save":
        cmd_templates_save(args)
    elif args.templates_command == "delete":
        cmd_templates_delete(args)
    else:
        print(f"error: unknown templates subcommand {args.templates_command!r}", file=sys.stderr)
        raise SystemExit(1)
