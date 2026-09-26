#!/usr/bin/env python3
"""Validate the exact static release; never print matching file contents."""
import argparse
from pathlib import Path
import re
import stat
import sys

SITE_FILES = frozenset({'index.html', 'app.js', 'style.css', 'favicon.svg'})
DENO_FILES = frozenset({'main.ts', 'core.ts', 'deno.json', 'deno.lock'})
HISTORY_REQUIRED_FILES = frozenset({'site/' + p for p in SITE_FILES} | {
    '.github/workflows/pages.yml', 'check_public.py', 'README.md', '.gitignore'})
REPO_FILES = frozenset(HISTORY_REQUIRED_FILES | {'api/' + p for p in DENO_FILES})
MAX_FILE = 1_000_000
MAX_TOTAL = 4_000_000
RULES = [
    ('GitHub credential', r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'),
    ('provider credential', r'AI[z]a[A-Za-z0-9_-]{25,}|AQ[.][A-Za-z0-9_-]{25,}|sk-[A-Za-z0-9_-]{20,}'),
    ('authorization value', r'[Bb]earer\s+[A-Za-z0-9._~+-]{12,}'),
    ('private key', r'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    ('embedded credential', r'''(?i)["']?\b(?:api[_-]?key|access[_-]?token|jin10[_-]?token|client[_-]?secret|token|secret|authorization)["']?\s*[=:]\s*["'][A-Za-z0-9._~+/-]{12,}'''),
    ('private data path', r'[.]private(?:[/\\\s"\']|$)|[/\\]Users[/\\]|[/\\]home[/\\][A-Za-z]'),
    ('local service', r'(?i)local[h]ost|127[.]0[.]0[.]1|0[.]0[.]0[.]0|\[::1\]|:[8]765\b|:[1]1434\b'),
    ('backend API route', r'[/]api[/]'),
]


class UnsafeRelease(ValueError):
    pass


def check_bytes(name, data):
    if len(data) > MAX_FILE:
        raise UnsafeRelease('A release file exceeds the size limit.')
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        raise UnsafeRelease('Release files must be UTF-8 text.') from None
    if '\x00' in text:
        raise UnsafeRelease('Binary content is not allowed.')
    for label, pattern in RULES:
        # The reviewed Deno service makes fixed outbound provider calls. Only
        # the static browser bundle is prohibited from containing API routes.
        if label == 'backend API route' and (name.startswith('api/') or name == '.gitignore'):
            continue
        if re.search(pattern, text):
            raise UnsafeRelease('Release blocked: ' + label + ' detected. Content withheld.')


def read_tree(root, allowed, required=True, allow_git=False):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise UnsafeRelease('Release root must be a real directory.')
    expected_dirs = {str(p) for name in allowed for p in Path(name).parents if str(p) != '.'}
    found = {}
    for path in root.rglob('*'):
        relative = path.relative_to(root).as_posix()
        if relative == '.git' or relative.startswith('.git/'):
            if allow_git:
                if relative == '.git' and (path.is_symlink() or not path.is_dir()):
                    raise UnsafeRelease('Linked Git directories are not supported.')
                continue
        if path.is_symlink():
            raise UnsafeRelease('Symbolic links are not allowed in a release.')
        mode = path.stat().st_mode
        if stat.S_ISDIR(mode):
            if relative not in expected_dirs:
                raise UnsafeRelease('Unknown directory in release; publishing stopped.')
            continue
        if not stat.S_ISREG(mode) or relative not in allowed:
            raise UnsafeRelease('Unknown or non-regular file in release; publishing stopped.')
        if path.stat().st_size > MAX_FILE:
            raise UnsafeRelease('A release file exceeds the size limit.')
        data = path.read_bytes()
        check_bytes(relative, data)
        found[relative] = data
    if required and set(found) != set(allowed):
        raise UnsafeRelease('A required public release file is missing.')
    if sum(map(len, found.values())) > MAX_TOTAL:
        raise UnsafeRelease('The release exceeds the total size limit.')
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', default='.')
    args = parser.parse_args()
    try:
        files = read_tree(args.root, REPO_FILES, allow_git=True)
    except (UnsafeRelease, OSError):
        print('Public release validation failed. Remove unknown files or sensitive content.', file=sys.stderr)
        return 1
    print('Public release validated: ' + str(len(files)) + ' allowlisted files.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
