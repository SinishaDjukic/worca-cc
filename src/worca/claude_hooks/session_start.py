# /// script
# requires-python = ">=3.8"
# ///
"""SessionStart hook: injects git context and runs bd prime."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.session import handle_session_start


def main():
    context = handle_session_start()
    if context:
        print(context)
    sys.exit(0)


if __name__ == "__main__":
    main()
