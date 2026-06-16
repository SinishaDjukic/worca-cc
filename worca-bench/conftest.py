"""Make the ``worca_bench`` package importable when running tests in-tree
without an editable install."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
