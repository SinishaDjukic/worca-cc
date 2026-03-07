# /// script
# requires-python = ">=3.8"
# ///
"""PreCompact hook: runs bd prime to preserve context."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.session import handle_pre_compact


def main():
    output = handle_pre_compact()
    if output:
        print(output)
    sys.exit(0)


if __name__ == "__main__":
    main()
