# /// script
# requires-python = ">=3.8"
# ///
"""Stop hook: cleanup on forced stop."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.session import handle_session_end


def main():
    handle_session_end()
    sys.exit(0)


if __name__ == "__main__":
    main()
