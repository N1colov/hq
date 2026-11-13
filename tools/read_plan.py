#!/usr/bin/env python3
"""Decrypt plan/plan.json and print it (for the midday re-plan).

Usage:  HQ_PLAN_KEY=<base64url key> python3 tools/read_plan.py [path]
"""
import base64
import json
import os
import sys

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover
    os.system(f"{sys.executable} -m pip install -q --break-system-packages cryptography")
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def main() -> int:
    key = os.environ.get("HQ_PLAN_KEY", "").strip()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "plan", "plan.json")
    if not os.path.exists(path):
        print("{}")
        return 0
    env = json.load(open(path))
    pt = AESGCM(unb64u(key)).decrypt(unb64u(env["iv"]), unb64u(env["ct"]), None)
    print(json.dumps(json.loads(pt), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
