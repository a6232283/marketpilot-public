#!/usr/bin/env python3
"""Run only the public research API behind the dedicated Tailscale Funnel node.

No credential values are written to command arguments, launchd plists or logs.
The existing private website and its trading/account endpoints are not proxied.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

SCRIPT_DIR = Path(__file__).resolve().parent
BASE = SCRIPT_DIR.parent if SCRIPT_DIR.name == 'api' and (SCRIPT_DIR / 'main.ts').is_file() else SCRIPT_DIR
API = BASE / 'deno-api' if (BASE / 'deno-api/main.ts').is_file() else BASE / 'api'
PRIVATE = BASE / '.private'


class DeployError(Exception):
    pass


def private_directory():
    info = PRIVATE.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or \
            info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise DeployError('私密資料夾權限不安全。')


def safe_json(path, default=None):
    private_directory()
    try:
        info = path.lstat()
    except FileNotFoundError:
        return default
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or \
            info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 1_000_000:
        raise DeployError('私密設定檔權限或大小不安全。')
    return json.loads(path.read_text(encoding='utf-8'))


def atomic_private_write(path, value):
    private_directory()
    if path.is_symlink() or path.parent != PRIVATE:
        raise DeployError('私密設定路徑不安全。')
    descriptor, temporary = tempfile.mkstemp(prefix='.marketpilot-funnel-', dir=PRIVATE)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
            os.fchmod(file.fileno(), 0o600)
            json.dump(value, file, ensure_ascii=False, indent=2)
            file.flush(); os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def selected_gemini_key():
    settings = safe_json(PRIVATE / 'settings.json', {})
    keys = safe_json(PRIVATE / 'keys.json', [])
    active = settings.get('active_key') if isinstance(settings, dict) else None
    for item in keys if isinstance(keys, list) else []:
        if isinstance(item, dict) and item.get('id') == active:
            value = item.get('value')
            if isinstance(value, str) and 20 <= len(value) <= 1000 and not any(c.isspace() for c in value):
                return value
    raise DeployError('未設定有效的站方 Gemini 金鑰。')


def jin10_token():
    value = safe_json(PRIVATE / 'integrations.json', {})
    token = value.get('jin10_token') if isinstance(value, dict) else None
    if isinstance(token, str) and 10 <= len(token) <= 1000 and not any(c.isspace() for c in token):
        return token
    raise DeployError('未設定有效的金十憑證。')

RUNTIME = PRIVATE / 'funnel'
EMERGENCY_STOP = RUNTIME / 'public.sqlite3.emergency-stop'
STATE = PRIVATE / 'funnel_host.json'
SOCKET = PRIVATE / 'tailscale' / 'tailscaled.sock'
TAILSCALE = '/opt/homebrew/bin/tailscale'
DENO = '/opt/homebrew/bin/deno'
LABEL = 'com.marketpilot.public-api'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
PORT = 8768
HOST_PATTERN = re.compile(r'marketpilot(?:-\d+)?\.[a-z0-9-]+\.ts\.net')
ENV_NAMES = ['PUBLIC_ORIGIN', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'JIN10_MCP_TOKEN',
             'RATE_LIMIT_SALT', 'JIN10_CACHE_SECONDS', 'MAX_REQUESTS_PER_10_MINUTES',
             'MAX_PUBLIC_AI_CALLS_PER_DAY', 'MAX_PUBLIC_BYOK_CALLS_PER_DAY',
             'MARKETPILOT_KV_PATH', 'MARKETPILOT_BIND_HOST', 'PORT', 'FUNNEL_HOST']


def run(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                          cwd=BASE, env=system_env())


def system_env():
    return {'HOME': str(Path.home()), 'PATH': '/opt/homebrew/bin:/usr/bin:/bin',
            'LANG': 'en_US.UTF-8', 'DENO_NO_PROMPT': '1'}


def config():
    value = safe_json(STATE, {})
    if not HOST_PATTERN.fullmatch(value.get('host', '')):
        raise DeployError('請先執行 configure 確認 Tailscale 公開網域。')
    if not re.fullmatch(r'https://[a-z0-9-]+\.github\.io', value.get('origin', '')):
        raise DeployError('GitHub Pages 來源未正確設定。')
    if not re.fullmatch(r'[a-f0-9]{64}', value.get('salt', '')):
        raise DeployError('公開限速設定無效。')
    return value


def configure():
    private_directory()
    result = run([TAILSCALE, '--socket=' + str(SOCKET), 'status', '--json'])
    if result.returncode:
        raise DeployError('無法連接 Tailscale 背景服務。')
    status = json.loads(result.stdout)
    host = status.get('Self', {}).get('DNSName', '').rstrip('.')
    if status.get('BackendState') != 'Running' or not HOST_PATTERN.fullmatch(host):
        raise DeployError('請先登入 Tailscale，並將裝置命名為 marketpilot。')
    publishing = safe_json(PRIVATE / 'publishing.json', {})
    owner = publishing.get('owner', '').lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,38}', owner):
        raise DeployError('找不到 GitHub Pages 發布設定。')
    previous = safe_json(STATE, {})
    atomic_private_write(STATE, {**previous, 'host': host,
        'origin': 'https://' + owner + '.github.io',
        'salt': previous.get('salt') or secrets.token_hex(32),
        'model': previous.get('model', 'gemini-3.1-flash-lite'),
        'shared_daily': previous.get('shared_daily', 48),
        'byok_daily': previous.get('byok_daily', 96)})
    print('公開入口：https://' + host)


def environment():
    cfg = config()
    env = system_env()
    try:
        key = selected_gemini_key()
    except DeployError:
        key = ''  # BYOK, rules and backtests remain available.
    try:
        token = jin10_token()
    except DeployError:
        token = ''
    env.update({'PUBLIC_ORIGIN': cfg['origin'], 'FUNNEL_HOST': cfg['host'],
        'GEMINI_API_KEY': key, 'JIN10_MCP_TOKEN': token,
        'GEMINI_MODEL': str(cfg.get('model', 'gemini-3.1-flash-lite')),
        'RATE_LIMIT_SALT': cfg['salt'], 'JIN10_CACHE_SECONDS': '120',
        'MAX_REQUESTS_PER_10_MINUTES': '3',
        'MAX_PUBLIC_AI_CALLS_PER_DAY': str(cfg.get('shared_daily', 48)),
        'MAX_PUBLIC_BYOK_CALLS_PER_DAY': str(cfg.get('byok_daily', 96)),
        'MARKETPILOT_KV_PATH': str(RUNTIME / 'public.sqlite3'),
        'MARKETPILOT_BIND_HOST': '127.0.0.1', 'PORT': str(PORT)})
    return env


def checked_command():
    checked = run([DENO, 'check', '--config', str(API / 'deno.json'),
                   str(API / 'main.ts')], 60)
    if checked.returncode:
        raise DeployError('公開 API 語法檢查未通過，保留既有執行版本。')
    return [DENO, 'run', '--no-prompt', '--config', str(API / 'deno.json'),
        '--allow-env=' + ','.join(ENV_NAMES),
        '--allow-net=127.0.0.1:' + str(PORT) + ',data-api.binance.vision:443,'
        'query1.finance.yahoo.com:443,mcp.jin10.com:443,generativelanguage.googleapis.com:443',
        '--allow-read=' + str(RUNTIME), '--allow-write=' + str(RUNTIME),
        str(API / 'main.ts')]


def fingerprint():
    paths = [API / name for name in ('main.ts', 'core.ts', 'backtest.ts', 'deno.json', 'deno.lock')]
    paths += [STATE, PRIVATE / 'keys.json', PRIVATE / 'settings.json', PRIVATE / 'integrations.json']
    digest = hashlib.sha256()
    for path in paths:
        info = path.stat()
        digest.update(str((path.name, info.st_mtime_ns, info.st_size)).encode())
    return digest.digest()


def supervise():
    os.umask(0o077)
    private_directory()
    if RUNTIME.is_symlink():
        raise DeployError('公開 API 資料目錄不可為連結。')
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    RUNTIME.chmod(0o700)
    lock = (RUNTIME / 'supervisor.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise DeployError('公開 API 已在執行。') from None
    stop = False
    def stopped(*_):
        nonlocal stop
        stop = True
    signal.signal(signal.SIGTERM, stopped)
    signal.signal(signal.SIGINT, stopped)
    child = None
    last = None
    pending = None
    retry_at = 0.0
    emergency_closed = False
    def terminate():
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    try:
        while not stop:
            if EMERGENCY_STOP.exists() or EMERGENCY_STOP.is_symlink():
                terminate()
                child = None
                if not emergency_closed:
                    result = run([TAILSCALE, '--socket=' + str(SOCKET), 'funnel', '--https=443', 'off'], 15)
                    emergency_closed = result.returncode == 0
                    if emergency_closed:
                        print('偵測到異常流量，已自動關閉 Funnel；需手動重新啟用。', flush=True)
                time.sleep(5)
                continue
            if emergency_closed:
                emergency_closed = False
                last = None
                pending = None
                retry_at = 0.0
            current = fingerprint()
            # Two stable observations prevent restarts midway through a save.
            if (current != last or child is None or child.poll() is not None) and time.monotonic() >= retry_at:
                if pending == current:
                    try:
                        command, env = checked_command(), environment()
                        terminate()
                        child = subprocess.Popen(command, cwd=BASE, env=env,
                                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        last = current
                        print('公開 API 已啟動；設定／程式更新將自動重載。', flush=True)
                    except (OSError, DeployError, subprocess.SubprocessError):
                        print('公開 API 重載失敗，請檢查設定與語法。', flush=True)
                    retry_at = time.monotonic() + 30
                pending = current
            time.sleep(5)
    finally:
        terminate()
        lock.close()


def install():
    config()
    checked_command()
    private_directory()
    if RUNTIME.is_symlink():
        raise DeployError('公開 API 資料目錄不可為連結。')
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    RUNTIME.chmod(0o700)
    data = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(BASE / 'funnel_host.py'), 'serve'],
            'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 30, 'Umask': 63,
            'WorkingDirectory': str(BASE),
            'StandardOutPath': str(RUNTIME / 'service.log'),
            'StandardErrorPath': str(RUNTIME / 'service.log')}
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    desired = plistlib.dumps(data)
    running = run(['launchctl', 'print', f'gui/{os.getuid()}/{LABEL}']).returncode == 0
    existing = PLIST.read_bytes() if PLIST.exists() else None
    if running and existing == desired:
        print('公開 API 已在執行；登入 macOS 後自動啟動。')
        return
    PLIST.write_bytes(desired); PLIST.chmod(0o600)
    if running:
        run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'])
    for _ in range(5):
        result = run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(PLIST)])
        if result.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise DeployError('無法啟動公開 API 登入背景服務。')
    print('已啟用公開 API；登入 macOS 後自動啟動。')


def check_health(public=True):
    cfg = config()
    headers = {'Origin': cfg['origin']}
    url = 'https://' + cfg['host'] + '/v1/status'
    if not public:
        url = 'http://127.0.0.1:' + str(PORT) + '/v1/status'
        headers.update({'Host': cfg['host'], 'X-Forwarded-Host': cfg['host'],
            'X-Forwarded-Proto': 'https', 'Tailscale-Funnel-Request': '?1',
            'X-Forwarded-For': '127.0.0.1'})
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as response:
        result = json.load(response)
    if result.get('ready') is not True:
        raise DeployError('公開研究服務尚未就緒。')
    print(json.dumps({'ready': True, 'ai': result.get('ai'), 'jin10': result.get('jin10'),
                      'endpoint': 'https://' + cfg['host']}, ensure_ascii=False))


def stop():
    result = run([TAILSCALE, '--socket=' + str(SOCKET), 'funnel', '--https=443', 'off'])
    if result.returncode:
        raise DeployError('無法確認 Funnel 已關閉，請檢查 Tailscale。')
    run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'])
    if PLIST.exists(): PLIST.unlink()
    print('公開入口與 API 已停止；私人網站不受影響。')


def start():
    if EMERGENCY_STOP.exists() or EMERGENCY_STOP.is_symlink():
        info = EMERGENCY_STOP.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid():
            raise DeployError('緊急停用標記權限不安全。')
        EMERGENCY_STOP.unlink()
    install()
    # A tripped supervisor needs time to restart its child before Funnel
    # can safely point at the API again.
    for _ in range(30):
        try:
            cfg = config()
            request = urllib.request.Request('http://127.0.0.1:' + str(PORT) + '/v1/status', headers={
                'Origin': cfg['origin'], 'Host': cfg['host'], 'X-Forwarded-Host': cfg['host'],
                'X-Forwarded-Proto': 'https', 'Tailscale-Funnel-Request': '?1',
                'X-Forwarded-For': '127.0.0.1'})
            with urllib.request.urlopen(request, timeout=2) as answer:
                if json.load(answer).get('ready') is True:
                    break
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(1)
    else:
        raise DeployError('公開 API 尚未恢復，Funnel 維持關閉。')
    result = run([TAILSCALE, '--socket=' + str(SOCKET), 'funnel', '--bg', '--https=443',
                  'http://127.0.0.1:' + str(PORT)], timeout=40)
    if result.returncode:
        raise DeployError('Funnel 尚未啟用；請完成 Tailscale 官方頁面的啟用步驟。')
    print('公開入口：https://' + config()['host'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['configure', 'install', 'serve', 'status', 'local-status', 'start', 'stop'])
    args = parser.parse_args()
    try:
        {'configure': configure, 'install': install, 'serve': supervise,
         'status': check_health, 'local-status': lambda: check_health(False),
         'start': start, 'stop': stop}[args.action]()
        return 0
    except (DeployError, OSError, ValueError, subprocess.SubprocessError):
        print('操作未完成；請確認 Tailscale 登入、公開 API 狀態與私密設定權限。', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
