#!/usr/bin/env python3
"""Validate a daily plan and write it encrypted to plan/plan.json.

Usage:  HQ_PLAN_KEY=<base64url key> python3 tools/publish_plan.py /tmp/plan.json

The plan is AES-256-GCM encrypted so the public repo never exposes the
schedule. HQ decrypts it on the phone with the same key.
"""
import base64
import json
import os
import re
import sys
from datetime import datetime

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover
    os.system(f"{sys.executable} -m pip install -q --break-system-packages cryptography")
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KINDS = {"task", "growth", "deadline", "exam"}
TIME = re.compile(r"^\d{2}:\d{2}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def validate(plan: dict) -> list[str]:
    errs = []
    if plan.get("v") != 1:
        errs.append("v must be 1")
    if not isinstance(plan.get("generatedAt"), str):
        errs.append("generatedAt must be an ISO timestamp string")
    days = plan.get("days")
    if not isinstance(days, dict) or not days:
        return errs + ["days must be a non-empty object"]
    for d, day in days.items():
        if not DATE.match(d):
            errs.append(f"bad date key {d!r}")
        if not isinstance(day.get("quests"), list):
            errs.append(f"{d}: quests must be a list")
            continue
        if len(day.get("brief", "")) > 160:
            errs.append(f"{d}: brief over 160 chars")
        for i, q in enumerate(day["quests"]):
            where = f"{d} quest {i}"
            for k in ("title", "step", "time", "minutes"):
                if k not in q:
                    errs.append(f"{where}: missing {k}")
            if not TIME.match(str(q.get("time", ""))):
                errs.append(f"{where}: time must be HH:MM (24h)")
            if len(q.get("title", "")) > 40:
                errs.append(f"{where}: title over 40 chars")
            if q.get("kind", "task") not in KINDS:
                errs.append(f"{where}: kind must be one of {sorted(KINDS)}")
            if not (5 <= int(q.get("minutes", 0)) <= 240):
                errs.append(f"{where}: minutes must be 5..240")
    return errs


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    key = os.environ.get("HQ_PLAN_KEY", "").strip()
    if not key or len(unb64u(key)) != 32:
        print("HQ_PLAN_KEY must be a 32-byte base64url key")
        return 2
    plan = json.load(open(sys.argv[1]))
    errs = validate(plan)
    if errs:
        print("Plan is invalid:\n  " + "\n  ".join(errs))
        return 1
    iv = os.urandom(12)
    ct = AESGCM(unb64u(key)).encrypt(iv, json.dumps(plan, separators=(",", ":")).encode(), None)
    out = {"v": 1, "alg": "A256GCM", "iv": b64u(iv), "ct": b64u(ct)}
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(os.path.join(root, "plan"), exist_ok=True)
    with open(os.path.join(root, "plan", "plan.json"), "w") as f:
        json.dump(out, f)
        f.write("\n")
    n = sum(len(d["quests"]) for d in plan["days"].values())
    print(f"Wrote plan/plan.json ({len(plan['days'])} days, {n} quests) at {datetime.now().isoformat(timespec='seconds')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
