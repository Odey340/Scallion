"""One-shot Vultr bootstrap for the API box.

    python api/deploy/vultr_bootstrap.py [--ip 104.238.145.198] [--apply]

Finds the instance by IP, builds cloud-init user-data (deploy key from ~/.ssh/scallion_vultr.pub
plus every SSH key on the Vultr account, Docker, ufw), stores it on the instance (PATCH user_data)
and calls POST /instances/{id}/reinstall. THAT REINSTALLS THE INSTANCE (wipes its disk); fine for
a box that has nothing on it yet. Without --apply it only prints what it would do. Afterwards it
forgets the old SSH host key, waits for SSH with the deploy key and runs deploy.sh.

Needs VULTR_API_KEY in the repo-root .env and this machine's public IP on the key's allow-list
(Vultr > Account > API > Access Control).
"""
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
API = "https://api.vultr.com/v2"
HOSTNAME = "api.scallion.us"


def env(key: str) -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return ""


def call(token: str, method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(f"{API}{path}", method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"Vultr {method} {path} -> {e.code}: {e.read().decode()[:300]}")
        raise SystemExit(1)


def main(argv: list[str]) -> int:
    ip = argv[argv.index("--ip") + 1] if "--ip" in argv else "104.238.145.198"
    apply = "--apply" in argv
    token = env("VULTR_API_KEY")
    if not token:
        print("VULTR_API_KEY missing in .env")
        return 2
    key_path = Path.home() / ".ssh" / "scallion_vultr"
    pub = (key_path.with_suffix(".pub")).read_text().strip()

    inst = next((i for i in call(token, "GET", "/instances").get("instances", []) if i["main_ip"] == ip), None)
    if not inst:
        print(f"no instance with main_ip {ip}")
        return 2
    print(f"instance {inst['id']} label={inst.get('label')} os={inst.get('os')} plan={inst.get('plan')} status={inst.get('status')}/{inst.get('server_status')}")

    keys = [pub] + [k["ssh_key"].strip() for k in call(token, "GET", "/ssh-keys").get("ssh_keys", [])]
    template = (HERE / "cloud-init.yaml").read_text(encoding="utf-8")
    user_data = template.replace("__SSH_AUTHORIZED_KEYS__", "\n".join(f"  - {k}" for k in keys))
    print(f"cloud-init: {len(keys)} ssh key(s), {len(user_data)} bytes")
    if not apply:
        print("dry run: add --apply to store this user-data and reinstall the instance")
        return 0

    call(token, "PATCH", f"/instances/{inst['id']}", {"user_data": base64.b64encode(user_data.encode()).decode(), "label": HOSTNAME})
    print("user_data stored; requesting reinstall")
    call(token, "POST", f"/instances/{inst['id']}/reinstall", {"hostname": HOSTNAME})
    print("reinstall requested; waiting for the instance to come back")
    time.sleep(20)
    for _ in range(60):
        cur = call(token, "GET", f"/instances/{inst['id']}")["instance"]
        print(f"  {cur['status']}/{cur['server_status']}/{cur['power_status']}")
        if cur["status"] == "active" and cur["server_status"] == "ok" and cur["power_status"] == "running":
            break
        time.sleep(10)

    subprocess.run(["ssh-keygen", "-R", ip], capture_output=True)  # the reinstall minted a new host key
    print("waiting for SSH with the deploy key (cloud-init installs Docker on first boot)")
    ssh = ["ssh", "-i", str(key_path), "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", f"root@{ip}"]
    for _ in range(60):
        time.sleep(10)
        r = subprocess.run(ssh + ["test -f /srv/scallion/.cloud-init-done && docker --version"], capture_output=True, text=True)
        if r.returncode == 0:
            print("  ", r.stdout.strip())
            break
        print("  not ready:", (r.stderr or r.stdout).strip().splitlines()[-1][:100] if (r.stderr or r.stdout).strip() else "no answer")
    else:
        print("gave up waiting for SSH; run deploy.sh by hand once the box answers")
        return 1
    script = HERE / "deploy.sh"
    posix = script.as_posix()
    if script.drive:  # Git Bash on Windows wants /c/Users/... not C:/Users/...
        posix = "/" + script.drive[0].lower() + posix[2:]
    return subprocess.call(["bash", posix, f"root@{ip}"])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
