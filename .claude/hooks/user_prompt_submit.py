# /// script
# requires-python = ">=3.8"
# ///
"""UserPromptSubmit hook: runs milestone approval gates."""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.hooks.prompt import load_pipeline_status, check_milestone


def main():
    status = load_pipeline_status()
    code, message = check_milestone(status)
    if message:
        print(message)
    sys.exit(code)


if __name__ == "__main__":
    main()
