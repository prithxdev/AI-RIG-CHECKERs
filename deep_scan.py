#!/usr/bin/env python3
# =============================================================================
# deep_scan.py — Rig Check local helper
# -----------------------------------------------------------------------------
# Runs entirely on the user's own machine. Collects real hardware specs that
# no browser can read (CPU model/cache, RAM type & speed, GPU VRAM, storage),
# then serves them as JSON on http://127.0.0.1:8765/scan for the Rig Check
# webpage to fetch.
#
# REQUIREMENTS
# -----------------------------------------------------------------------------
# Python 3.7+, nothing to `pip install` — standard library only.
# =============================================================================

import ctypes
import json
import os
import platform
import re
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765

# Allowed origins for CORS protection
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

OS_NAME = platform.system()  # "Windows", "Linux", "Darwin"


def run(cmd, timeout=5):
    """Run a shell command, return stdout as text, or None on failure."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


# --------------------------------------------------------------------- CPU --
def get_cpu_info():
    info = {
        "logicalCores": os.cpu_count(),
        "model": None,
        "clockMhz": None,
        "note": None,
    }

    if OS_NAME == "Linux":
        try:
            with open("/proc/cpuinfo") as f:
                text = f.read()
            m = re.search(r"model name\s*:\s*(.+)", text)
            if m:
                info["model"] = m.group(1).strip()
            m = re.search(r"cpu MHz\s*:\s*([\d.]+)", text)
            if m:
                info["clockMhz"] = round(float(m.group(1)))
        except Exception:
            pass

    elif OS_NAME == "Windows":
        out = run(
            'powershell -NoProfile -Command '
            '"Get-CimInstance Win32_Processor | '
            'Select-Object -First 1 Name, MaxClockSpeed | ConvertTo-Json"'
        )
        if out:
            try:
                data = json.loads(out)
                info["model"] = data.get("Name", "").strip()
                info["clockMhz"] = data.get("MaxClockSpeed")
            except Exception:
                pass

    elif OS_NAME == "Darwin":
        out = run("sysctl -n machdep.cpu.brand_string")
        if out:
            info["model"] = out.strip()

    if not info["model"]:
        info["note"] = "Model name unavailable via standard tools on this system."

    return info


# --------------------------------------------------------------------- RAM --
def get_ram_total_gb():
    """Total physical RAM in GB, using standard library."""
    if OS_NAME == "Windows":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return round(stat.ullTotalPhys / (1024 ** 3), 2)

    elif OS_NAME == "Linux":
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal"):
                        kb = int(line.split()[1])
                        return round(kb / (1024 ** 2), 2)
        except Exception:
            return None

    elif OS_NAME == "Darwin":
        out = run("sysctl -n hw.memsize")
        if out:
            return round(int(out) / (1024 ** 3), 2)

    return None


def get_ram_modules():
    """Best-effort RAM type/speed per module. Works across Windows, macOS, and Linux."""
    modules = []

    if OS_NAME == "Linux":
        out = run("dmidecode --type 17 2>/dev/null")
        if out:
            for block in out.split("Memory Device")[1:]:
                size_m = re.search(r"Size:\s*(.+)", block)
                type_m = re.search(r"Type:\s*(\S+)", block)
                speed_m = re.search(r"Speed:\s*(.+)", block)
                if size_m and "No Module Installed" not in size_m.group(1):
                    modules.append({
                        "size": size_m.group(1).strip() if size_m else None,
                        "type": type_m.group(1).strip() if type_m else None,
                        "speed": speed_m.group(1).strip() if speed_m else None,
                    })
        if not modules:
            return {"modules": [], "note": "Run with sudo for Linux dmidecode memory timings."}

    elif OS_NAME == "Windows":
        out = run(
            'powershell -NoProfile -Command '
            '"Get-CimInstance Win32_PhysicalMemory | '
            'ForEach-Object { $t = switch ($_.SMBIOSMemoryType) { '
            '20 {\'DDR\'} 21 {\'DDR2\'} 24 {\'DDR3\'} 26 {\'DDR4\'} 34 {\'DDR5\'} '
            'default {\'Unknown\'} }; '
            '[PSCustomObject]@{ capacityGb = [math]::Round($_.Capacity/1GB,2); '
            'type = $t; speedMhz = $_.Speed } } | ConvertTo-Json"'
        )
        if out:
            try:
                parsed = json.loads(out)
                if isinstance(parsed, dict):
                    parsed = [parsed]
                for m in parsed:
                    modules.append({
                        "size": f"{m.get('capacityGb')} GB",
                        "type": m.get("type"),
                        "speed": f"{m.get('speedMhz')} MHz",
                    })
            except Exception:
                pass

    elif OS_NAME == "Darwin":
        out = run("system_profiler SPMemoryDataType 2>/dev/null")
        if out:
            size = type_ = speed = None
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("Size:") or line.startswith("Memory:"):
                    size = line.split(":", 1)[1].strip()
                elif line.startswith("Type:"):
                    type_ = line.split(":", 1)[1].strip()
                elif line.startswith("Speed:"):
                    speed = line.split(":", 1)[1].strip()
                    if size and size != "Empty":
                        modules.append({"size": size, "type": type_, "speed": speed})
                        size = type_ = speed = None
            # Handle Apple Silicon unified memory report
            if size and not modules:
                modules.append({
                    "size": size,
                    "type": type_ or "LPDDR5 (Unified)",
                    "speed": speed or "Unified Memory Bus"
                })

    return {"modules": modules, "note": None if modules else "Type/speed unavailable via standard tools."}


# --------------------------------------------------------------------- GPU --
def get_gpu_info():
    # 1) NVIDIA first — clean cross-platform API
    out = run(
        "nvidia-smi --query-gpu=name,memory.total,power.limit "
        "--format=csv,noheader,nounits"
    )
    if out:
        parts = [p.strip() for p in out.splitlines()[0].split(",")]
        if len(parts) >= 3:
            return {
                "name": parts[0],
                "vramGb": round(float(parts[1]) / 1024, 2),
                "tgpWatts": float(parts[2]),
                "source": "nvidia-smi",
            }

    # 2) macOS Darwin — Apple Silicon or AMD/Intel
    if OS_NAME == "Darwin":
        out = run("system_profiler SPDisplaysDataType 2>/dev/null")
        if out:
            name = None
            cores = None
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("Chipset Model:"):
                    name = line.split(":", 1)[1].strip()
                elif line.startswith("Total Number of Cores:"):
                    cores = line.split(":", 1)[1].strip()

            if name:
                full_name = f"{name} ({cores}-Core GPU)" if cores else name
                ram_total = get_ram_total_gb()
                # On Apple Silicon (M-series), GPU shares Unified Memory with CPU
                is_apple_silicon = bool(re.search(r"Apple M\d", name, re.IGNORECASE))
                return {
                    "name": full_name,
                    "vramGb": ram_total if is_apple_silicon else None,
                    "tgpWatts": None,
                    "isUnifiedMemory": is_apple_silicon,
                    "source": "Apple Metal Unified Memory" if is_apple_silicon else "system_profiler",
                }

    # 3) Windows WMI
    elif OS_NAME == "Windows":
        out = run(
            'powershell -NoProfile -Command '
            '"(Get-CimInstance Win32_VideoController | Select-Object -First 1 '
            'Name, AdapterRAM) | ConvertTo-Json"'
        )
        if out:
            try:
                data = json.loads(out)
                vram = data.get("AdapterRAM")
                return {
                    "name": data.get("Name"),
                    "vramGb": round(vram / (1024 ** 3), 2) if vram else None,
                    "tgpWatts": None,
                    "source": "wmi",
                }
            except Exception:
                pass

    # 4) Linux lspci
    elif OS_NAME == "Linux":
        out = run("lspci -mm 2>/dev/null | grep -Ei 'vga|3d controller|display'")
        if out:
            first = out.splitlines()[0]
            m = re.findall(r'"([^"]*)"', first)
            name = " ".join(m[-2:]) if len(m) >= 2 else first
            return {"name": name, "vramGb": None, "tgpWatts": None, "source": "lspci"}

    return {"name": None, "vramGb": None, "tgpWatts": None,
            "note": "No dedicated GPU tool produced a result on this system."}


# ----------------------------------------------------------------- Storage --
def get_storage_info():
    total, used, free = shutil.disk_usage(os.path.abspath(os.sep))
    return {
        "totalGb": round(total / (1024 ** 3), 2),
        "freeGb": round(free / (1024 ** 3), 2),
    }


# --------------------------------------------------------------------- API --
def collect_all():
    ram_total = get_ram_total_gb()
    return {
        "platform": f"{OS_NAME} {platform.release()}",
        "cpu": get_cpu_info(),
        "ram": {
            "totalGb": ram_total,
            **get_ram_modules(),
        },
        "gpu": get_gpu_info(),
        "storage": get_storage_info(),
    }


class ScanHandler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        origin = self.headers.get("Origin", "")
        if not origin or origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin if origin else "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/health"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors_headers()
            self.end_headers()
            msg = json.dumps({"status": "ready", "service": "Rig Check Deep Scan Helper"}).encode("utf-8")
            self.wfile.write(msg)
            return

        if self.path != "/scan":
            self.send_response(404)
            self.end_headers()
            return

        origin = self.headers.get("Origin", "")
        if origin and origin not in ALLOWED_ORIGINS:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Origin not allowed. Edit ALLOWED_ORIGINS in deep_scan.py.")
            return

        try:
            payload = json.dumps(collect_all()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode("utf-8"))

    def log_message(self, format, *args):
        pass  # Quiet logger


if __name__ == "__main__":
    print(f"\n======================================================")
    print(f"🔍 Rig Check Deep Scan helper running on http://127.0.0.1:{PORT}/scan")
    print(f"🌐 Allowed web origins: {', '.join(ALLOWED_ORIGINS[:3])}...")
    print(f"⚡ Keep this terminal open while testing the web app.")
    print(f"======================================================\n")
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), ScanHandler).serve_forever()
    except KeyboardInterrupt:
        print("\nDeep Scan helper stopped.")
