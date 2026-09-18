"""MiroxAI — Vercel-compatible Flask app."""

import os, re, json, time, uuid, random, base64, urllib.parse, zipfile, io
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from collections import Counter, deque
import threading, queue as _q

import requests
from flask import Flask, request, jsonify, session, Response, send_from_directory

# ---------- Vercel-safe paths ----------
TMP = "/tmp/miroxai"
try: os.makedirs(TMP, exist_ok=True)
except Exception: TMP = "/tmp"
IMAGES_DIR = os.path.join(TMP, "generated_images")
try: os.makedirs(IMAGES_DIR, exist_ok=True)
except Exception: pass

# ---------- App ----------
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "miroxai-vercel-static-secret-change-me")
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
)

START_TIME = time.time()
IO_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="mirox-io")

# ---------- Config ----------
CHAT_TIMEOUT          = int(os.environ.get("CHAT_TIMEOUT", "25"))
HF_MAX_TOKENS         = 8192
MAX_HISTORY_MESSAGES  = 10
FIRST_TOKEN_DEADLINE  = int(os.environ.get("FIRST_TOKEN_DEADLINE", "12"))
MAX_ATTACHMENT_CHARS  = 12000
MAX_VISION_BYTES      = 8 * 1024 * 1024

# Video: fewer frames to fit in serverless time limits
VIDEO_FRAME_COUNT = int(os.environ.get("VIDEO_FRAME_COUNT", "8"))
VIDEO_FPS         = int(os.environ.get("VIDEO_FPS", "4"))
VIDEO_SIZE        = int(os.environ.get("VIDEO_SIZE", "384"))
VIDEO_CONCURRENCY = int(os.environ.get("VIDEO_CONCURRENCY", "8"))
VIDEO_RETRY_MAX   = int(os.environ.get("VIDEO_RETRY_MAX", "3"))

# ---------- Env-based keys ----------
AIROUTE_ENV_KEY = os.environ.get("AIROUTE_KEY", "")
HF_ENV_KEY      = os.environ.get("HF_TOKEN", "")
POLL_ENV_KEY    = os.environ.get("POLLINATIONS_KEY", "")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    ADMIN_PASSWORD = f"{random.randint(0,9999):04d}"
    print("="*60); print(f"ADMIN PASSWORD: {ADMIN_PASSWORD}"); print("="*60)

# ---------- In-memory state (per cold start) ----------
DATA_LOCK = threading.Lock()
DATA_STORE = {"users": {}, "reports": [], "admin_config": {}}

BANNED_IPS = {}; BAN_LOCK = threading.Lock()
LAST_SEEN = {}; LAST_SEEN_LOCK = threading.Lock()
RESPONSE_TIMES = deque(maxlen=300); RT_LOCK = threading.Lock()
ROUTE_HITS = Counter(); ROUTE_LOCK = threading.Lock()
_req_times = {}; _rate_lock = threading.Lock()
ADMIN_SESSIONS = {}; ADMIN_SESS_LOCK = threading.Lock()

MAINTENANCE = {"enabled": False, "message": "MiroxAI is under maintenance."}
BROADCAST = {"id": 0, "message": "", "type": "info", "targets": "all", "ts": 0}
BROADCAST_COUNTER = {"n": 0}
BROADCAST_HISTORY = deque(maxlen=20)
STATE_VERSION = {"v": 0}
CONFIG_LOCK = threading.Lock()

# ---------- Tiers ----------
SUBSCRIPTION_TIERS = {
    "free": {"label":"Free","tagline":"Get started","keys_per_period":2,"refill_days":30,
        "daily_limit":50,"images_allowed":True,"images_per_5h":5,
        "vision_per_day":10,"vision_unlimited":False,"api_key_images":False,
        "video_allowed":False,"video_per_day":0,
        "models_allowed":["mirox-gen1"],"subscription_days":30,
        "price_robux":0,"price_afg":0,"gamepass_id":None,
        "perks":["50 responses / day","2 API keys / month","5 images every 5 hours",
                 "10 image visions / day","Lite mode after daily limit","No API image gen","No video generation"]},
    "pro": {"label":"Pro","tagline":"For builders","keys_per_period":5,"refill_days":5,
        "daily_limit":500,"images_allowed":True,"images_per_5h":-1,
        "vision_per_day":-1,"vision_unlimited":True,"api_key_images":True,
        "video_allowed":True,"video_per_day":5,
        "models_allowed":["mirox-gen1","mirox-ultra-v1"],"subscription_days":30,
        "price_robux":250,"price_afg":120,"gamepass_id":"1982144889",
        "perks":["500 responses / day","5 API keys every 5 days","Both AI models",
                 "Unlimited images","Unlimited image vision","API image generation","5 silent videos / day (5s each)"]},
    "ultimate": {"label":"Ultimate","tagline":"Maximum power","keys_per_period":10,"refill_days":1,
        "daily_limit":3000,"images_allowed":True,"images_per_5h":-1,
        "vision_per_day":-1,"vision_unlimited":True,"api_key_images":True,
        "video_allowed":True,"video_per_day":-1,
        "models_allowed":["mirox-gen1","mirox-ultra-v1"],"subscription_days":365,
        "price_robux":1200,"price_afg":450,"gamepass_id":"1983380864",
        "perks":["3,000 responses / day","10 API keys daily","Both models + math",
                 "Unlimited images","Unlimited image vision","API image generation",
                 "Unlimited silent videos (5s each)","Full 1-year subscription"]},
}
DEFAULT_TIER = "free"

def _norm_url(u):
    u = (u or "").strip()
    if not u: return u
    u = re.sub(r"^(https?)(?!://)/+", r"\1://", u, flags=re.I)
    if not re.match(r"^https?://", u, flags=re.I): u = "https://" + u
    return u.rstrip("/")

AIROUTE_BASE_URL = _norm_url(os.environ.get("AIROUTE_BASE_URL", "https://route-ai-playground.lovable.app"))
AIROUTE_IMAGE_MODEL = os.environ.get("AIROUTE_IMAGE_MODEL", "google/gemini-3.7-flash")
HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions"
HF_POOL_GEN1 = ["Qwen/Qwen2.5-Coder-32B-Instruct:fastest","deepseek-ai/DeepSeek-V3-0324:fastest",
    "meta-llama/Llama-3.1-8B-Instruct:fastest","openai/gpt-oss-20b:fastest"]
HF_POOL_ULTRA = ["Qwen/Qwen3-235B-A22B-Instruct-2507:fastest","deepseek-ai/DeepSeek-R1-0528:fastest",
    "deepseek-ai/DeepSeek-V3-0324:fastest"]
ENSEMBLE_SIZES = {"mirox-gen1":3,"mirox-ultra-v1":4}

POLLINATIONS_URL = "https://gen.pollinations.ai/v1/chat/completions"
POLLINATIONS_MODEL = os.environ.get("POLLINATIONS_MODEL", "openai")
POLLINATIONS_LITE_MODEL = os.environ.get("POLLINATIONS_LITE_MODEL", "openai")
POLLINATIONS_VISION_URL = POLLINATIONS_URL
POLLINATIONS_VISION_MODEL = os.environ.get("POLLINATIONS_VISION_MODEL", "openai")
HF_VISION_MODELS = ["Qwen/Qwen2-VL-7B-Instruct","Qwen/Qwen2.5-VL-7B-Instruct"]

_CODE_RULES = (
    "## Code — CRITICAL RULES\n"
    "- Output the COMPLETE file. NEVER truncate.\n"
    "- No placeholders like `// rest of code`, `...`.\n\n"
    "## Project files — REQUIRED FORMAT\n"
    "```file:path/to/file.ext\n"
    "<full content>\n"
    "```\n"
)

MODEL_PRESETS = {
    "mirox-gen1": {"label":"MiroxGen1","tagline":"Fast + code",
        "airoute_model":"google/gemini-3.1-flash-lite",
        "system_prompt":("You are MiroxGen1, MiroxAI's fast assistant.\n\n" + _CODE_RULES +
            "\nIf asked what powers you, say MiroxGen1 by MiroxAI.")},
    "mirox-ultra-v1": {"label":"MiroxUltraV1","tagline":"Deep reasoning + math",
        "airoute_model":"google/gemini-3.1-pro-preview",
        "system_prompt":("You are MiroxUltraV1, MiroxAI's most capable reasoning model.\n\n" + _CODE_RULES +
            "\n## Math\nShow your work.\n\nIf asked what powers you, say MiroxUltraV1 by MiroxAI.")},
}
DEFAULT_MODEL_PRESET = "mirox-gen1"

STYLE_SUFFIXES = {"photo":"photorealistic","illustration":"digital illustration","anime":"anime style","3d":"3D render"}
RATIO_HINTS = {"1:1":"square","3:4":"portrait","4:3":"landscape","16:9":"widescreen"}
RATIO_SIZES = {"1:1":(1024,1024),"3:4":(896,1152),"4:3":(1152,896),"16:9":(1280,720)}

MAX_PERSONA_CHARS = 1500
MAX_MEMORY_FACTS = 40
MAX_MEMORY_FACT_CHARS = 300

# ---------- Helpers ----------
def _client_ip():
    f = request.headers.get("X-Forwarded-For")
    if f: return f.split(",")[0].strip()
    return request.remote_addr or "unknown"

def _get_admin_config():
    return DATA_STORE.setdefault("admin_config", {})

def get_airoute_key(): return _get_admin_config().get("airoute_key") or AIROUTE_ENV_KEY
def get_hf_key(): return _get_admin_config().get("hf_key") or HF_ENV_KEY
def get_pollinations_key(): return _get_admin_config().get("pollinations_key") or POLL_ENV_KEY
def hf_available(): return bool(get_hf_key())

def _save_image(uri):
    try:
        if not uri or not uri.startswith("data:"): return ""
        header, _, data = uri.partition(",")
        if not data: return ""
        m = re.match(r"data:([^;]+);base64", header)
        mime = (m.group(1) if m else "image/png").lower()
        ext = {"image/png":".png","image/jpeg":".jpg","image/jpg":".jpg","image/gif":".gif","image/webp":".webp"}.get(mime,".png")
        fn = f"{int(time.time())}_{uuid.uuid4().hex[:8]}{ext}"
        with open(os.path.join(IMAGES_DIR, fn), "wb") as f: f.write(base64.b64decode(data))
        return fn
    except Exception: return ""

def get_user_record(uid):
    with DATA_LOCK:
        rec = DATA_STORE["users"].setdefault(uid, {})
        defaults = {"name":None,"email":None,"persona":"","memory":[],"history":[],
            "tier":DEFAULT_TIER,"tier_started":time.time(),"tier_expires":time.time()+30*86400,
            "api_keys":[],"key_period_start":time.time(),"keys_generated_in_period":0,
            "daily_date":"","daily_count":0,
            "img_gen_5h_start":time.time(),"img_gen_5h_count":0,
            "vision_day":"","vision_count":0,
            "video_day":"","video_count":0,
            "warnings":[],"banned":False,"ban_reason":"","created":time.time(),"last_seen":time.time()}
        for k,v in defaults.items(): rec.setdefault(k, v)
        rec["last_seen"] = time.time()
        return rec

def get_tier_config(tier):
    return SUBSCRIPTION_TIERS.get(tier or DEFAULT_TIER, SUBSCRIPTION_TIERS[DEFAULT_TIER])

def refresh_tier_expiry(rec):
    now = time.time()
    if rec.get("tier") and rec["tier"] != "free" and now > rec.get("tier_expires",0):
        rec["tier"] = "free"; rec["tier_started"] = now; rec["tier_expires"] = now + 30*86400
        return True
    return False

def _reset_period(rec):
    cfg = get_tier_config(rec.get("tier"))
    if time.time() - rec.get("key_period_start",0) >= cfg["refill_days"]*86400:
        rec["key_period_start"] = time.time(); rec["keys_generated_in_period"] = 0

def _reset_daily(rec):
    today = time.strftime("%Y-%m-%d")
    if rec.get("daily_date") != today: rec["daily_date"] = today; rec["daily_count"] = 0

def _reset_img5h(rec):
    if time.time() - rec.get("img_gen_5h_start",0) >= 5*3600:
        rec["img_gen_5h_start"] = time.time(); rec["img_gen_5h_count"] = 0

def _reset_vision_day(rec):
    today = time.strftime("%Y-%m-%d")
    if rec.get("vision_day") != today: rec["vision_day"] = today; rec["vision_count"] = 0

def _reset_video_day(rec):
    today = time.strftime("%Y-%m-%d")
    if rec.get("video_day") != today: rec["video_day"] = today; rec["video_count"] = 0

def _key_remaining(rec): return max(0, get_tier_config(rec.get("tier"))["keys_per_period"] - rec.get("keys_generated_in_period",0))
def _key_refill(rec): return max(0, int(get_tier_config(rec.get("tier"))["refill_days"]*86400 - (time.time() - rec.get("key_period_start",0))))
def _daily_remaining(rec): return max(0, get_tier_config(rec.get("tier"))["daily_limit"] - rec.get("daily_count",0))
def _img_5h_remaining(rec):
    cfg = get_tier_config(rec.get("tier"))
    if cfg.get("images_per_5h",-1) < 0: return -1
    return max(0, cfg["images_per_5h"] - rec.get("img_gen_5h_count",0))
def _img_5h_refill(rec): return max(0, int(5*3600 - (time.time() - rec.get("img_gen_5h_start",0))))
def _vision_remaining(rec):
    cfg = get_tier_config(rec.get("tier"))
    if cfg.get("vision_unlimited"): return -1
    return max(0, cfg.get("vision_per_day",10) - rec.get("vision_count",0))
def _video_remaining(rec):
    cfg = get_tier_config(rec.get("tier"))
    if not cfg.get("video_allowed"): return 0
    if cfg.get("video_per_day",0) < 0: return -1
    return max(0, cfg["video_per_day"] - rec.get("video_count",0))
def _is_lite(rec): return rec.get("tier") == "free" and _daily_remaining(rec) <= 0
def _daily_reset_seconds(rec):
    now = time.time(); gm = time.gmtime(now)
    return int(86400 - (gm.tm_hour*3600 + gm.tm_min*60 + gm.tm_sec))

def _new_api_key(tier):
    prefix = {"free":"mirox_free","pro":"mirox_pro","ultimate":"mirox_ult"}.get(tier,"mirox_free")
    return f"{prefix}_{uuid.uuid4().hex}"

def _extract_bearer():
    a = request.headers.get("Authorization", "")
    if a.lower().startswith("bearer "): return a[7:].strip()
    return (request.headers.get("X-API-Key") or "").strip()

def _find_user_by_key(key):
    if not key: return None
    with DATA_LOCK:
        for uid, rec in DATA_STORE.get("users", {}).items():
            for k in rec.get("api_keys", []):
                if k.get("key") == key and not k.get("revoked"):
                    return uid, rec, k
    return None

def is_admin():
    tok = session.get("admin_token")
    if tok:
        with ADMIN_SESS_LOCK:
            if tok in ADMIN_SESSIONS:
                ADMIN_SESSIONS[tok]["last_seen"] = time.time()
                session["is_admin"] = True; return True
            ADMIN_SESSIONS[tok] = {"token":tok,"ip":_client_ip(),"login_ts":time.time(),"last_seen":time.time()}
        session["is_admin"] = True; return True
    return False

def get_user_id():
    if session.get("user_id"): return session["user_id"]
    if "anon_id" not in session: session["anon_id"] = "anon-" + uuid.uuid4().hex[:8]
    return session["anon_id"]

def _rate_exceeded(ip):
    if not ip or ip == "unknown": return False
    now = time.time()
    with _rate_lock:
        dq = _req_times.setdefault(ip, deque(maxlen=1020))
        while dq and now - dq[0] > 5.0: dq.popleft()
        dq.append(now)
        if sum(1 for t in dq if now - t <= 3.0) >= 100: return True
        if len(dq) >= 1000: return True
    return False

def is_ip_banned(ip):
    with BAN_LOCK: return ip in BANNED_IPS
def get_ban_reason(ip):
    with BAN_LOCK: return (BANNED_IPS.get(ip) or {}).get("reason", "")
def ban_ip(ip, reason=""):
    ip = (ip or "").strip()
    if not ip: return
    with BAN_LOCK: BANNED_IPS[ip] = {"reason": reason, "ts": time.time()}
def unban_ip(ip):
    with BAN_LOCK: BANNED_IPS.pop((ip or "").strip(), None)

# ---------- AI providers ----------
_SESSION_TOKENS = {}; _SESSION_LOCK = threading.Lock(); SESSION_TTL = 600

def _get_session_token(api_key, force=False):
    if not api_key: raise RuntimeError("No API key.")
    now = time.time()
    with _SESSION_LOCK:
        e = _SESSION_TOKENS.get(api_key)
        if e and not force and (now - e["ts"]) < SESSION_TTL: return e["token"]
    try:
        r = requests.post(f"{AIROUTE_BASE_URL}/api/public/v1/handshake",
            json={"step":"connect","api_key":api_key}, timeout=8)
    except Exception as e: raise RuntimeError(f"Handshake: {e}")
    if r.status_code == 401: raise RuntimeError("API key rejected.")
    r.raise_for_status()
    d = r.json()
    tok = d.get("session_token") or d.get("token")
    if not tok: raise RuntimeError("No session_token.")
    with _SESSION_LOCK: _SESSION_TOKENS[api_key] = {"token":tok, "ts":now}
    return tok

def _clear_session_token(k):
    with _SESSION_LOCK: _SESSION_TOKENS.pop(k, None)

def _raise_airoute(r):
    if r.status_code == 401: raise RuntimeError("API key invalid.")
    if r.status_code == 402: raise RuntimeError("Out of credits.")
    if r.status_code == 429: raise RuntimeError("Rate-limited.")
    r.raise_for_status()

def call_airoute_chat(model, api_key, prompt):
    tok = _get_session_token(api_key)
    def _do(t):
        try:
            return requests.post(f"{AIROUTE_BASE_URL}/api/public/v1/chat",
                headers={"Authorization": f"Bearer {t}"},
                json={"model": model, "prompt": prompt}, timeout=CHAT_TIMEOUT)
        except Exception as e: raise RuntimeError(f"AIRoute: {e}")
    r = _do(tok)
    if r.status_code == 401:
        _clear_session_token(api_key); tok = _get_session_token(api_key, True); r = _do(tok)
    _raise_airoute(r); return r.json()

def call_airoute_image(model, api_key, prompt):
    tok = _get_session_token(api_key)
    try:
        r = requests.post(f"{AIROUTE_BASE_URL}/api/public/v1/images",
            headers={"Authorization": f"Bearer {tok}"},
            json={"model": model, "prompt": prompt}, timeout=60)
        _raise_airoute(r); return r.json()
    except Exception: raise

def _choice0(o):
    if not isinstance(o, dict): return {}
    ch = o.get("choices")
    if not isinstance(ch, list) or not ch: return {}
    return ch[0] if isinstance(ch[0], dict) else {}

def get_hf_models(model_id):
    return list(HF_POOL_ULTRA) if model_id == "mirox-ultra-v1" else list(HF_POOL_GEN1)

def call_hf_chat(hf_model, messages, timeout=None):
    key = get_hf_key()
    if not key: raise RuntimeError("No HF token.")
    try:
        r = requests.post(HF_ROUTER_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": hf_model, "messages": messages, "stream": False,
                  "max_tokens": HF_MAX_TOKENS, "temperature": 0.7},
            timeout=timeout or CHAT_TIMEOUT)
    except Exception as e: raise RuntimeError(f"HF: {e}")
    if r.status_code == 200:
        ch = _choice0(r.json())
        text = (ch.get("message") or {}).get("content") or ""
        if text: return text
        raise RuntimeError("HF empty.")
    if r.status_code == 401: raise RuntimeError("HF token rejected.")
    if r.status_code == 429: raise RuntimeError("HF rate-limited.")
    raise RuntimeError(f"HF HTTP {r.status_code}")

def call_vision(messages):
    headers = {"Content-Type": "application/json"}
    tok = get_pollinations_key()
    if tok: headers["Authorization"] = f"Bearer {tok}"
    try:
        r = requests.post(POLLINATIONS_VISION_URL, headers=headers,
            json={"model": POLLINATIONS_VISION_MODEL, "messages": messages, "max_tokens": 2048},
            timeout=CHAT_TIMEOUT)
        if r.status_code == 200:
            try:
                text = (_choice0(r.json()).get("message") or {}).get("content") or ""
                if text: return text
            except Exception: pass
    except Exception: pass
    key = get_hf_key()
    if key:
        for m in HF_VISION_MODELS:
            try:
                r = requests.post(HF_ROUTER_URL,
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={"model": m, "messages": messages, "stream": False,
                          "max_tokens": 1024, "temperature": 0.6},
                    timeout=CHAT_TIMEOUT)
                if r.status_code == 200:
                    text = (_choice0(r.json()).get("message") or {}).get("content") or ""
                    if text: return text
            except Exception: pass
    raise RuntimeError("Vision providers unavailable.")

def call_pollinations_image(prompt, w, h):
    url = f"https://image.pollinations.ai/prompt/{urllib.parse.quote(prompt)}"
    try:
        r = requests.get(url, params={"width": w, "height": h, "nologo": "true"},
            headers={"User-Agent": "Mozilla/5.0"}, timeout=45)
    except Exception as e: raise RuntimeError(f"Pollinations: {e}")
    r.raise_for_status()
    ct = r.headers.get("content-type", "image/jpeg")
    if "image" not in ct: raise RuntimeError("No image.")
    return f"data:{ct};base64,{base64.b64encode(r.content).decode()}"

# ---------- Message building ----------
def _parse_few_shot(raw):
    if not raw: return []
    out = []
    for block in re.split(r"\n\s*---+\s*\n", raw):
        b = block.strip()
        if not b: continue
        m = re.search(r"USER\s*:\s*(.+?)(?=\nASSISTANT\s*:|\Z)", b, re.I|re.S)
        a = re.search(r"ASSISTANT\s*:\s*(.+)", b, re.I|re.S)
        if m and a: out.append({"user": m.group(1).strip(), "assistant": a.group(1).strip()})
    return out[:6]

def build_messages(user_message, preset, persona, memory_facts, file_name, file_content,
                   search_snippets, history, training, image_data_url=None):
    parts = [preset["system_prompt"]]
    if persona: parts.append(f"User persona: {persona}")
    if memory_facts: parts.append("Known facts:\n" + "\n".join(f"- {f['text']}" for f in memory_facts))
    if search_snippets: parts.append("Web results:\n" + "\n".join(f"- {s}" for s in search_snippets))
    if file_content: parts.append(f"Attached '{file_name}':\n\n{file_content}")
    parts.append("If you learn a durable fact, include `remember:<fact>`.")
    msgs = [{"role": "system", "content": "\n\n".join(parts)}]
    for ex in _parse_few_shot(training.get("few_shot", "")):
        msgs.append({"role": "user", "content": ex["user"]})
        msgs.append({"role": "assistant", "content": ex["assistant"]})
    for turn in history[-MAX_HISTORY_MESSAGES:]:
        msgs.append({"role": "user" if turn.get("role") == "user" else "assistant",
                     "content": turn.get("text", "")})
    if image_data_url:
        msgs.append({"role": "user", "content": [
            {"type": "text", "text": user_message or "Describe this image."},
            {"type": "image_url", "image_url": {"url": image_data_url}}
        ]})
    else:
        msgs.append({"role": "user", "content": user_message})
    return msgs

def get_training():
    cfg = _get_admin_config()
    return {"_by_id": {"mirox-gen1": cfg.get("train_gen1",""), "mirox-ultra-v1": cfg.get("train_ultra","")},
            "shared": cfg.get("train_shared",""), "style": cfg.get("train_style",""),
            "code": cfg.get("train_code",""), "few_shot": cfg.get("train_few_shot",""),
            "reasoning": cfg.get("train_reasoning","auto")}

def flatten_messages(messages):
    out = []
    for m in messages:
        c = m["content"]
        if isinstance(c, list):
            c = " ".join(x.get("text","[image]") if isinstance(x, dict) else str(x) for x in c)
        if m["role"] == "system": out.append(c)
        elif m["role"] == "user": out.append(f"User: {c}")
        else: out.append(f"Assistant: {c}")
    out.append("Assistant:")
    return "\n\n".join(out)

MEMORY_PATTERN = re.compile(r"remember\s*:\s*(.+?)(?=\n|$)", re.I)
FILE_BLOCK_RE = re.compile(r"```file:([^\n`]+)\n([\s\S]*?)\n```", re.MULTILINE)

def extract_memory_writes(t):
    return [m.strip()[:MAX_MEMORY_FACT_CHARS] for m in MEMORY_PATTERN.findall(t) if m.strip()]

def parse_project_files(text):
    out = []
    if not text: return out
    for m in FILE_BLOCK_RE.finditer(text):
        path = m.group(1).strip(); content = m.group(2)
        ext = path.split(".")[-1].lower() if "." in path.split("/")[-1] else "plaintext"
        out.append({"path": path, "content": content, "lang": ext})
    return out

def web_search_snippets(q, max_results=5):
    try:
        r = requests.get("https://api.duckduckgo.com/",
            params={"q": q, "format": "json", "no_html": 1, "skip_disambig": 1}, timeout=5)
        d = r.json()
    except Exception: return []
    sn = []
    if d.get("AbstractText"): sn.append(d["AbstractText"])
    for t in d.get("RelatedTopics", []):
        if len(sn) >= max_results: break
        if isinstance(t, dict) and t.get("Text"): sn.append(t["Text"])
    return sn[:max_results]

# ---------- Streams ----------
def _stream_from_airoute(model, api_key, prompt):
    tok = _get_session_token(api_key)
    try:
        r = requests.post(f"{AIROUTE_BASE_URL}/api/public/v1/chat",
            headers={"Authorization": f"Bearer {tok}"},
            json={"model": model, "prompt": prompt, "stream": True},
            timeout=CHAT_TIMEOUT, stream=True)
    except Exception as e: raise RuntimeError(f"Airoute: {e}")
    if r.status_code == 401:
        _clear_session_token(api_key); tok = _get_session_token(api_key, True)
        r = requests.post(f"{AIROUTE_BASE_URL}/api/public/v1/chat",
            headers={"Authorization": f"Bearer {tok}"},
            json={"model": model, "prompt": prompt, "stream": True},
            timeout=CHAT_TIMEOUT, stream=True)
    _raise_airoute(r)
    ct = (r.headers.get("content-type") or "").lower()
    if "stream" in ct:
        for raw in r.iter_lines(decode_unicode=True):
            if not raw: continue
            line = raw.strip()
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload == "[DONE]": return
                try: obj = json.loads(payload)
                except Exception: continue
                delta = obj.get("delta") or obj.get("text")
                if not delta:
                    ch = _choice0(obj)
                    delta = (ch.get("delta") or {}).get("content") or ch.get("text") or ""
                if delta: yield delta
    else:
        try: obj = r.json()
        except Exception: return
        ch = _choice0(obj)
        text = obj.get("text") or obj.get("reply") or (ch.get("message") or {}).get("content") or ""
        if text: yield text

def _stream_from_pollinations(messages, lite=False):
    headers = {"Content-Type": "application/json"}
    tok = get_pollinations_key()
    if tok: headers["Authorization"] = f"Bearer {tok}"
    model = POLLINATIONS_LITE_MODEL if lite else POLLINATIONS_MODEL
    try:
        r = requests.post(POLLINATIONS_URL, headers=headers,
            json={"model": model, "messages": messages, "stream": True},
            timeout=CHAT_TIMEOUT, stream=True)
    except Exception as e: raise RuntimeError(f"Pollinations: {e}")
    if r.status_code == 401: raise RuntimeError("Pollinations key rejected.")
    if r.status_code == 429: raise RuntimeError("Pollinations rate-limited.")
    r.raise_for_status()
    for raw in r.iter_lines(decode_unicode=True):
        if not raw: continue
        line = raw.strip()
        if not line.startswith("data:"): continue
        payload = line[5:].strip()
        if payload == "[DONE]": return
        try: obj = json.loads(payload)
        except Exception: continue
        delta = (_choice0(obj).get("delta") or {}).get("content") or ""
        if delta: yield delta

def _race_stream(messages, preset, lite, state):
    q = _q.Queue(); stop = threading.Event(); state["provider"] = None

    def worker(tag, factory):
        try:
            for d in factory():
                if stop.is_set(): return
                q.put((tag, "d", d))
            q.put((tag, "e", None))
        except Exception as ex: q.put((tag, "x", str(ex)[:200]))

    if not lite and get_airoute_key():
        threading.Thread(target=worker, args=("airoute",
            lambda: _stream_from_airoute(preset["airoute_model"], get_airoute_key(),
                                         flatten_messages(messages))), daemon=True).start()
    threading.Thread(target=worker, args=("pollinations",
        lambda: _stream_from_pollinations(messages, lite=lite)), daemon=True).start()

    winner = None
    deadline = time.time() + FIRST_TOKEN_DEADLINE
    while time.time() < deadline:
        try: tag, kind, payload = q.get(timeout=0.3)
        except _q.Empty: continue
        if kind == "d" and payload:
            winner = tag; state["provider"] = tag
            yield payload; break
    if winner:
        while True:
            try: tag, kind, payload = q.get(timeout=60)
            except _q.Empty: break
            if tag != winner: continue
            if kind == "d": yield payload
            elif kind in ("e","x"): break
        stop.set(); return
    stop.set()

# ============================================================== ROUTES
@app.route("/api/models")
def api_models():
    return jsonify({"models": [{"id": k, "label": v["label"], "tagline": v["tagline"]}
                               for k, v in MODEL_PRESETS.items()],
                    "default": DEFAULT_MODEL_PRESET})

@app.route("/api/ping")
def api_ping(): return jsonify({"pong": True, "t": time.time()})

@app.route("/api/health")
def api_health(): return jsonify({"status": "ok", "app": "MiroxAI", "runtime": "vercel"})

@app.route("/api/me")
def api_me():
    uid = session.get("user_id")
    if not uid: return jsonify({"user": None})
    rec = get_user_record(uid); refresh_tier_expiry(rec)
    cfg = get_tier_config(rec["tier"])
    return jsonify({"user": {"id": uid, "name": session.get("user_name"),
                             "email": session.get("user_email"),
                             "tier": rec["tier"], "tier_label": cfg["label"]}})

@app.route("/api/client-status")
def api_client_status():
    ip = _client_ip(); admin = is_admin()
    with CONFIG_LOCK:
        maint = bool(MAINTENANCE["enabled"]) and not admin
        bc = dict(BROADCAST); ver = STATE_VERSION["v"]
    b_out = {"id": 0, "message": "", "type": "info", "ts": 0}
    if bc.get("message"): b_out = dict(bc)
    r = jsonify({"banned": is_ip_banned(ip), "reason": get_ban_reason(ip) if is_ip_banned(ip) else "",
        "maintenance": maint, "updating": False, "updating_message": "",
        "broadcast": b_out, "event": {"id": 0, "name": ""}, "version": ver})
    r.headers["Cache-Control"] = "no-store, max-age=0"
    return r

@app.route("/api/auth/simple-login", methods=["POST"])
def api_simple_login():
    d = request.get_json(silent=True) or {}
    name = (d.get("name") or "").strip()
    email = (d.get("email") or "").strip().lower()
    if not name or "@" not in email:
        return jsonify({"ok": False, "error": "Name and email are required."}), 400
    uid = "email:" + email
    session["user_id"] = uid; session["user_name"] = name; session["user_email"] = email
    rec = get_user_record(uid)
    if rec.get("banned"):
        return jsonify({"ok": False, "error": f"Your account is banned. Reason: {rec.get('ban_reason','')}"}), 403
    rec["name"] = name; rec["email"] = email
    refresh_tier_expiry(rec)
    cfg = get_tier_config(rec["tier"])
    return jsonify({"ok": True, "user": {"id": uid, "name": name, "email": email,
        "tier": rec["tier"], "tier_label": cfg["label"]}})

@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear(); return jsonify({"ok": True})

@app.route("/api/subscription/plans")
def api_plans():
    cfg = _get_admin_config()
    plans = []
    for tid, t in SUBSCRIPTION_TIERS.items():
        plans.append({"id": tid, "label": t["label"], "tagline": t["tagline"],
            "price_robux": t["price_robux"], "price_afg": t["price_afg"],
            "gamepass_id": t["gamepass_id"], "perks": t["perks"],
            "keys_per_period": t["keys_per_period"], "refill_days": t["refill_days"],
            "daily_limit": t["daily_limit"], "images_allowed": t["images_allowed"],
            "video_allowed": t["video_allowed"], "video_per_day": t["video_per_day"],
            "models_allowed": t["models_allowed"], "subscription_days": t["subscription_days"]})
    return jsonify({"plans": plans,
                    "admin_email": cfg.get("contact_email", ""),
                    "admin_phone": cfg.get("contact_phone", "")})

@app.route("/api/subscription/me")
def api_sub_me():
    uid = session.get("user_id")
    if not uid: return jsonify({"ok": False, "error": "Not signed in."}), 401
    rec = get_user_record(uid)
    refresh_tier_expiry(rec); _reset_period(rec); _reset_daily(rec); _reset_img5h(rec)
    _reset_vision_day(rec); _reset_video_day(rec)
    cfg = get_tier_config(rec["tier"])
    lite = _is_lite(rec)
    img = _img_5h_remaining(rec); vis = _vision_remaining(rec); vid = _video_remaining(rec)
    return jsonify({"ok": True, "tier": rec["tier"], "tier_label": cfg["label"],
        "tier_started": rec.get("tier_started"), "tier_expires": rec.get("tier_expires"),
        "subscription_days": cfg["subscription_days"],
        "daily_limit": cfg["daily_limit"], "daily_used": rec.get("daily_count", 0),
        "daily_remaining": _daily_remaining(rec), "lite_mode": lite,
        "daily_reset_seconds": _daily_reset_seconds(rec) if lite else 0,
        "keys_per_period": cfg["keys_per_period"], "keys_generated": rec.get("keys_generated_in_period", 0),
        "keys_remaining": _key_remaining(rec), "key_refill_seconds": _key_refill(rec),
        "refill_days": cfg["refill_days"], "images_allowed": cfg["images_allowed"],
        "img_5h_remaining": img,
        "img_5h_refill_seconds": _img_5h_refill(rec) if img >= 0 else 0,
        "vision_remaining": vis, "vision_unlimited": cfg.get("vision_unlimited", False),
        "video_allowed": cfg.get("video_allowed", False), "video_remaining": vid,
        "models_allowed": cfg["models_allowed"]})

@app.route("/api/keys", methods=["GET"])
def api_keys():
    uid = session.get("user_id")
    if not uid: return jsonify({"ok": False, "error": "Not signed in."}), 401
    rec = get_user_record(uid)
    safe = []
    for k in rec.get("api_keys", []):
        safe.append({"id": k["id"], "name": k.get("name"),
            "key": k.get("key", "") if not k.get("revoked") else "",
            "key_preview": (k.get("key","")[:16] + "…" + k.get("key","")[-4:]) if k.get("key") else "(revoked)",
            "tier": k.get("tier"), "created": k.get("created"), "revoked": k.get("revoked", False)})
    return jsonify({"ok": True, "keys": safe})

@app.route("/api/keys/generate", methods=["POST"])
def api_key_gen():
    uid = session.get("user_id")
    if not uid: return jsonify({"ok": False, "error": "Sign in first."}), 401
    d = request.get_json(silent=True) or {}
    name = (d.get("name") or "My key").strip()[:60]
    rec = get_user_record(uid); refresh_tier_expiry(rec); _reset_period(rec)
    if _key_remaining(rec) <= 0:
        w = _key_refill(rec); days = w // 86400; hours = (w % 86400) // 3600
        return jsonify({"ok": False, "error": f"No keys left. Refill in {days}d {hours}h."}), 429
    new_key = _new_api_key(rec["tier"])
    entry = {"id": str(uuid.uuid4()), "name": name, "key": new_key,
             "tier": rec["tier"], "created": time.time(), "revoked": False}
    rec.setdefault("api_keys", []).append(entry)
    rec["keys_generated_in_period"] = rec.get("keys_generated_in_period", 0) + 1
    return jsonify({"ok": True, "key": new_key, "id": entry["id"], "remaining": _key_remaining(rec)})

@app.route("/api/keys/<kid>", methods=["DELETE"])
def api_key_revoke(kid):
    uid = session.get("user_id")
    if not uid: return jsonify({"ok": False}), 401
    rec = get_user_record(uid)
    for k in rec.get("api_keys", []):
        if k["id"] == kid: k["revoked"] = True; k["key"] = ""; break
    return jsonify({"ok": True})

@app.route("/api/history")
def api_history():
    uid = session.get("user_id")
    if not uid: return jsonify({"conversations": []})
    rec = get_user_record(uid)
    convos = sorted(({"id": c["id"], "title": c["title"], "updated": c["updated"]}
                     for c in rec["history"]), key=lambda c: c["updated"], reverse=True)
    return jsonify({"conversations": convos})

@app.route("/api/history/search")
def api_history_search():
    uid = session.get("user_id")
    if not uid: return jsonify({"conversations": []})
    q = (request.args.get("q") or "").strip().lower()
    rec = get_user_record(uid)
    out = []
    for c in rec["history"]:
        if not q or q in (c.get("title") or "").lower():
            out.append({"id": c["id"], "title": c["title"], "updated": c["updated"]})
        else:
            for m in c.get("messages", []):
                if q in (m.get("text") or "").lower():
                    out.append({"id": c["id"], "title": c["title"], "updated": c["updated"],
                                "match": (m.get("text") or "")[:120]})
                    break
    out.sort(key=lambda x: x["updated"], reverse=True)
    return jsonify({"conversations": out[:50]})

@app.route("/api/history/<cid>")
def api_history_get(cid):
    uid = session.get("user_id")
    if not uid: return jsonify({"error": "Not found."}), 404
    rec = get_user_record(uid)
    c = next((c for c in rec["history"] if c["id"] == cid), None)
    if not c: return jsonify({"error": "Not found."}), 404
    return jsonify(c)

@app.route("/api/history/<cid>", methods=["DELETE"])
def api_history_del(cid):
    uid = session.get("user_id")
    if not uid: return jsonify({"error": "Not found."}), 404
    rec = get_user_record(uid)
    rec["history"] = [c for c in rec["history"] if c["id"] != cid]
    return jsonify({"ok": True})

@app.route("/api/history/<cid>/rename", methods=["POST"])
def api_history_rename(cid):
    uid = session.get("user_id")
    if not uid: return jsonify({"error": "Not found."}), 404
    rec = get_user_record(uid)
    c = next((c for c in rec["history"] if c["id"] == cid), None)
    if not c: return jsonify({"error": "Not found."}), 404
    d = request.get_json(silent=True) or {}
    title = (d.get("title") or "").strip()[:80]
    if not title: return jsonify({"ok": False, "error": "Empty."}), 400
    c["title"] = title
    return jsonify({"ok": True})

@app.route("/api/feedback", methods=["POST"])
def api_feedback(): return jsonify({"ok": True})

# ---- Reports ----
def _migrate_report(rep):
    if "messages" in rep: return rep
    rep["messages"] = [{"from": "user", "text": rep.get("message", ""), "ts": rep.get("ts", time.time())}]
    if rep.get("admin_reply"):
        rep["messages"].append({"from": "admin", "text": rep["admin_reply"],
                                "ts": rep.get("replied_ts") or time.time()})
    rep["status"] = "replied" if rep.get("admin_reply") else "open"
    rep["unread_user"] = 1 if rep.get("admin_reply") and not rep.get("user_seen") else 0
    rep["unread_admin"] = 0 if rep.get("admin_reply") else 1
    rep["last_ts"] = rep.get("replied_ts") or rep.get("ts") or time.time()
    return rep

@app.route("/api/report", methods=["POST"])
def api_report():
    uid = session.get("user_id") or get_user_id()
    rec = get_user_record(uid)
    d = request.get_json(silent=True) or {}
    subject = (d.get("subject") or "").strip()[:120]
    message = (d.get("message") or "").strip()[:4000]
    category = (d.get("category") or "general").strip()[:40]
    if not message: return jsonify({"ok": False, "error": "Please describe your issue."}), 400
    now = time.time()
    rep = {"id": str(uuid.uuid4()), "ts": now, "last_ts": now,
        "ip": _client_ip(), "uid": uid, "name": rec.get("name"), "email": rec.get("email"),
        "subject": subject or "(no subject)", "category": category, "status": "open",
        "messages": [{"from": "user", "text": message, "ts": now}],
        "unread_user": 0, "unread_admin": 1}
    with DATA_LOCK:
        DATA_STORE.setdefault("reports", []).append(rep)
        DATA_STORE["reports"] = DATA_STORE["reports"][-500:]
    return jsonify({"ok": True, "ticket_id": rep["id"][:8].upper(),
        "eta_min": 15, "eta_max": 30,
        "message": "A customer service agent will reply in 15 to 30 minutes."})

@app.route("/api/report/mine")
def api_report_mine():
    uid = session.get("user_id") or get_user_id()
    with DATA_LOCK:
        mine = [r for r in DATA_STORE.get("reports", []) if r.get("uid") == uid]
    mine.sort(key=lambda r: -(r.get("last_ts") or r.get("ts") or 0))
    for r in mine:
        if r.get("unread_user"): r["unread_user"] = 0
    return jsonify({"ok": True, "reports": mine[:30]})

@app.route("/api/report/<rid>/reply", methods=["POST"])
def api_report_reply(rid):
    uid = session.get("user_id") or get_user_id()
    d = request.get_json(silent=True) or {}
    text = (d.get("text") or "").strip()[:4000]
    if not text: return jsonify({"ok": False, "error": "Empty."}), 400
    with DATA_LOCK:
        rep = next((r for r in DATA_STORE.get("reports", []) if r.get("id") == rid), None)
        if not rep: return jsonify({"ok": False, "error": "Ticket not found."}), 404
        if rep.get("uid") != uid: return jsonify({"ok": False, "error": "Not your ticket."}), 403
        now = time.time()
        rep.setdefault("messages", []).append({"from": "user", "text": text, "ts": now})
        rep["last_ts"] = now; rep["status"] = "open"
        rep["unread_admin"] = (rep.get("unread_admin", 0) or 0) + 1
    return jsonify({"ok": True})

# ---- Settings ----
@app.route("/api/settings/airoute", methods=["GET", "POST"])
def s_airoute():
    if request.method == "GET": return jsonify({"configured": bool(get_airoute_key()), "is_admin": is_admin()})
    if not is_admin(): return jsonify({"ok": False, "error": "Admin only."}), 403
    d = request.get_json(silent=True) or {}
    tok = (d.get("token") or "").strip()
    if not tok: return jsonify({"ok": False, "error": "Key required."}), 400
    _get_admin_config()["airoute_key"] = tok; _SESSION_TOKENS.clear()
    return jsonify({"ok": True})

@app.route("/api/settings/huggingface", methods=["GET", "POST"])
def s_hf():
    if request.method == "GET": return jsonify({"configured": bool(get_hf_key()), "is_admin": is_admin()})
    if not is_admin(): return jsonify({"ok": False, "error": "Admin only."}), 403
    d = request.get_json(silent=True) or {}
    _get_admin_config()["hf_key"] = (d.get("token") or "").strip() or None
    return jsonify({"ok": True})

@app.route("/api/settings/huggingface/test", methods=["POST"])
def s_hf_test():
    if not is_admin(): return jsonify({"ok": False, "error": "Admin only."}), 403
    if not get_hf_key(): return jsonify({"ok": False, "error": "No HF token."})
    try:
        m = HF_POOL_GEN1[0]
        txt = call_hf_chat(m, [{"role": "user", "content": "Reply with exactly: ok"}], timeout=12)
        return jsonify({"ok": True, "message": f"gen1: OK · {m}", "reply": (txt or "")[:30]})
    except Exception as e: return jsonify({"ok": False, "error": str(e)[:400]})

@app.route("/api/settings/pollinations", methods=["GET", "POST"])
def s_poll():
    if request.method == "GET": return jsonify({"configured": bool(get_pollinations_key()), "is_admin": is_admin()})
    if not is_admin(): return jsonify({"ok": False, "error": "Admin only."}), 403
    d = request.get_json(silent=True) or {}
    _get_admin_config()["pollinations_key"] = (d.get("token") or "").strip() or None
    return jsonify({"ok": True})

@app.route("/api/settings/persona", methods=["GET", "POST"])
def s_persona():
    uid = session.get("user_id")
    if not uid: return jsonify({"persona": ""})
    rec = get_user_record(uid)
    if request.method == "GET": return jsonify({"persona": rec.get("persona", "")})
    d = request.get_json(silent=True) or {}
    rec["persona"] = (d.get("persona") or "").strip()[:MAX_PERSONA_CHARS]
    return jsonify({"ok": True})

@app.route("/api/settings/training", methods=["GET", "POST"])
def s_training():
    if request.method == "GET":
        t = get_training()
        return jsonify({**t["_by_id"], "shared": t["shared"], "style": t["style"],
                        "code": t["code"], "few_shot": t["few_shot"], "reasoning": t["reasoning"]})
    if not is_admin(): return jsonify({"ok": False, "error": "Admin only."}), 403
    d = request.get_json(silent=True) or {}
    cfg = _get_admin_config()
    for key, val in [("train_gen1","gen1"),("train_ultra","ultra"),("train_shared","shared"),
                     ("train_style","style"),("train_code","code"),("train_few_shot","few_shot")]:
        cfg[key] = (d.get(val) or "").strip()[:8000]
    cfg["train_reasoning"] = (d.get("reasoning") or "auto").strip()[:20]
    return jsonify({"ok": True})

@app.route("/api/memory", methods=["GET"])
def m_list():
    uid = session.get("user_id")
    if not uid: return jsonify({"facts": []})
    return jsonify({"facts": get_user_record(uid).get("memory", [])})

@app.route("/api/memory", methods=["POST"])
def m_add():
    uid = session.get("user_id")
    if not uid: return jsonify({"ok": False}), 401
    rec = get_user_record(uid)
    d = request.get_json(silent=True) or {}
    fact = (d.get("fact") or "").strip()[:MAX_MEMORY_FACT_CHARS]
    if not fact: return jsonify({"ok": False, "error": "Empty."}), 400
    e = {"id": str(uuid.uuid4()), "text": fact, "added": time.time()}
    rec.setdefault("memory", []).append(e); rec["memory"] = rec["memory"][-MAX_MEMORY_FACTS:]
    return jsonify({"ok": True, "fact": e})

@app.route("/api/memory/<fid>", methods=["DELETE"])
def m_del(fid):
    uid = session.get("user_id")
    if not uid: return jsonify({"ok": False}), 401
    rec = get_user_record(uid)
    rec["memory"] = [f for f in rec.get("memory", []) if f["id"] != fid]
    return jsonify({"ok": True})

# ---- Images ----
@app.route("/api/image/generate", methods=["POST"])
def api_image():
    uid = session.get("user_id")
    if not uid: return jsonify({"error": "Sign in required."}), 401
    rec = get_user_record(uid); refresh_tier_expiry(rec); _reset_img5h(rec)
    cfg = get_tier_config(rec["tier"])
    if not cfg["images_allowed"]:
        return jsonify({"error": f"Image generation is not on {cfg['label']}."}), 403
    if cfg.get("images_per_5h", -1) >= 0 and _img_5h_remaining(rec) <= 0:
        rem = _img_5h_refill(rec); h = rem // 3600; m = (rem % 3600) // 60
        return jsonify({"error": f"Free plan: 5 images per 5h. Refill in {h}h {m}m."}), 429
    d = request.get_json(silent=True) or {}
    prompt = (d.get("prompt") or "").strip()
    style = (d.get("style") or "").strip()
    ratio = (d.get("ratio") or "1:1").strip()
    if not prompt: return jsonify({"error": "Describe what you want first."}), 400
    full = prompt
    if style in STYLE_SUFFIXES: full += f", {STYLE_SUFFIXES[style]}"
    if ratio in RATIO_HINTS: full += f", {RATIO_HINTS[ratio]}"
    key = get_airoute_key()
    if key:
        try:
            r = call_airoute_image(AIROUTE_IMAGE_MODEL, key, full)
            img = r.get("image")
            if img:
                rec["img_gen_5h_count"] = rec.get("img_gen_5h_count", 0) + 1
                return jsonify({"image": img, "prompt": full, "remaining": _img_5h_remaining(rec)})
        except Exception: pass
    try:
        w, h = RATIO_SIZES.get(ratio, RATIO_SIZES["1:1"])
        img = call_pollinations_image(full, w, h)
        rec["img_gen_5h_count"] = rec.get("img_gen_5h_count", 0) + 1
        return jsonify({"image": img, "prompt": full, "remaining": _img_5h_remaining(rec)})
    except Exception as e:
        return jsonify({"error": f"Image generation failed: {e}"}), 400

@app.route("/api/admin/images/<filename>")
def api_admin_img(filename):
    if not is_admin(): return jsonify({"ok": False, "error": "Admin only."}), 403
    if not re.match(r"^[A-Za-z0-9_.-]+$", filename or "") or ".." in filename:
        return jsonify({"ok": False, "error": "Invalid filename."}), 400
    full = os.path.join(IMAGES_DIR, filename)
    if not os.path.isfile(full):
        return Response(b"", mimetype="image/png")
    return send_from_directory(IMAGES_DIR, filename)

# ---- Video ----
_VIDEO_SUFFIXES = ["", ", high quality", ", detailed, sharp focus", ", cinematic lighting"]

def _gen_frame_once(prompt, w, h, attempt=0):
    p = prompt + _VIDEO_SUFFIXES[attempt % len(_VIDEO_SUFFIXES)]
    try:
        uri = call_pollinations_image(p, w, h)
        if uri and uri.startswith("data:image"): return uri
    except Exception: pass
    return None

def _gen_frame(prompt, w, h, retries=VIDEO_RETRY_MAX):
    for i in range(retries):
        uri = _gen_frame_once(prompt, w, h, i)
        if uri: return uri
        time.sleep(0.3 + i * 0.4)
    return None

@app.route("/api/video/generate", methods=["POST"])
def api_video():
    uid = session.get("user_id")
    if not uid: return jsonify({"error": "Sign in required."}), 401
    rec = get_user_record(uid); refresh_tier_expiry(rec); _reset_video_day(rec)
    cfg = get_tier_config(rec["tier"])
    if not cfg.get("video_allowed"):
        return jsonify({"error": f"Video requires Pro or Ultimate. Your plan: {cfg['label']}."}), 403
    if _video_remaining(rec) == 0:
        return jsonify({"error": "Daily video limit reached."}), 429
    d = request.get_json(silent=True) or {}
    prompt = (d.get("prompt") or "").strip()
    style = (d.get("style") or "").strip()
    if not prompt: return jsonify({"error": "Describe the video first."}), 400
    base = prompt
    if style in STYLE_SUFFIXES: base += f", {STYLE_SUFFIXES[style]}"
    n = VIDEO_FRAME_COUNT; sz = VIDEO_SIZE
    motion = ["wide establishing shot","slight zoom in","camera pans left",
        "camera pans right","medium shot","close-up detail","camera pulls back",
        "slight upward tilt","slight downward tilt","subject turns left",
        "subject turns right","camera orbits left","camera orbits right",
        "medium-wide shot","soft focus medium shot","closer medium shot",
        "close-up","wide shot again","zooms out","final wide shot"]
    prompts = [f"{base}, {motion[i % len(motion)]}, frame {i+1} of {n}, cinematic, consistent subject"
               for i in range(n)]
    frames = [None] * n
    try:
        with ThreadPoolExecutor(max_workers=VIDEO_CONCURRENCY) as vp:
            futures = {vp.submit(_gen_frame, p, sz, sz, VIDEO_RETRY_MAX): i for i, p in enumerate(prompts)}
            for fut in concurrent.futures.as_completed(futures, timeout=35):
                i = futures[fut]
                try: frames[i] = fut.result()
                except Exception: frames[i] = None
    except Exception: pass
    for i, f in enumerate(frames):
        if not f: frames[i] = _gen_frame(prompts[i], sz, sz, VIDEO_RETRY_MAX)
    ordered = [f for f in frames if isinstance(f, str) and f.startswith("data:image")]
    if len(ordered) < 2:
        return jsonify({"error": "Video generation failed — try again."}), 500
    filled = []; last = None
    for f in frames:
        if isinstance(f, str) and f.startswith("data:image"):
            filled.append(f); last = f
        elif last: filled.append(last)
    rec["video_count"] = rec.get("video_count", 0) + 1
    return jsonify({"ok": True, "frames": filled, "fps": VIDEO_FPS, "duration": 5,
                    "count": len(filled), "size": sz,
                    "sound_note": "Sound will come soon", "remaining": _video_remaining(rec)})

# ---- Project ZIP ----
@app.route("/api/project/download", methods=["POST"])
def api_zip():
    d = request.get_json(silent=True) or {}
    files = d.get("files") or []
    if not isinstance(files, list) or not files:
        return jsonify({"error": "No files."}), 400
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            path = (f.get("path") or "file.txt").strip()
            path = re.sub(r'[<>:"|?*\x00-\x1f]', "_", path).replace("..","_").lstrip("/\\")
            if not path: path = "file.txt"
            try: z.writestr(path, f.get("content") or "")
            except Exception: pass
    buf.seek(0)
    return Response(buf.read(), mimetype="application/zip",
        headers={"Content-Disposition": 'attachment; filename="miroxai-project.zip"'})

# ---- Chat ----
@app.route("/api/chat/stream", methods=["POST"])
def api_chat_stream():
    uid = session.get("user_id")
    if not uid: return jsonify({"error": "Sign in first."}), 401
    rec = get_user_record(uid)
    if rec.get("banned"): return jsonify({"error": "Your account is banned."}), 403
    refresh_tier_expiry(rec); _reset_daily(rec); _reset_period(rec); _reset_vision_day(rec)
    lite = _is_lite(rec); cfg = get_tier_config(rec["tier"])
    d = request.get_json(silent=True) or {}
    user_message = (d.get("message") or "").strip()
    conv_id = d.get("conversation_id")
    model_id = d.get("model") or DEFAULT_MODEL_PRESET
    if model_id not in MODEL_PRESETS: model_id = DEFAULT_MODEL_PRESET
    if not lite and model_id not in cfg["models_allowed"]: model_id = cfg["models_allowed"][0]
    if lite: model_id = "mirox-gen1"
    file_name = (d.get("file_name") or "").strip() or None
    file_content = (d.get("file_content") or "")[:MAX_ATTACHMENT_CHARS] or None
    image_data_url = (d.get("image_data_url") or "").strip() or None
    web = bool(d.get("web_search"))
    using_vision = bool(image_data_url)
    if using_vision:
        if len(image_data_url) > MAX_VISION_BYTES * 2:
            return jsonify({"error": "Image too large."}), 400
        if _vision_remaining(rec) == 0:
            return jsonify({"error": "Daily vision limit reached."}), 429
    if not user_message and not using_vision: return jsonify({"error": "No message."}), 400
    if using_vision and not user_message: user_message = "Describe this image in detail."
    convo = next((c for c in rec["history"] if c["id"] == conv_id), None)
    prior = convo["messages"] if convo else []
    preset = dict(MODEL_PRESETS[model_id]); preset["_id"] = model_id
    snippets = web_search_snippets(user_message) if web else []
    training = get_training()
    messages = build_messages(user_message, preset, rec.get("persona",""), rec.get("memory",[]),
        file_name, file_content, snippets, prior, training, image_data_url=image_data_url)
    started = time.time()

    def generate():
        full_text = ""; first_ms = None; provider = None
        def emit(o): return f"data: {json.dumps(o, ensure_ascii=False)}\n\n"
        if using_vision:
            try:
                text = call_vision(messages)
                full_text = text or ""; first_ms = int((time.time()-started)*1000)
                provider = "vision"
                for i in range(0, len(full_text), 64):
                    yield emit({"delta": full_text[i:i+64]})
            except Exception as e:
                yield emit({"error": f"Vision failed: {e}"})
        else:
            state = {"provider": None}; got = False
            try:
                for delta in _race_stream(messages, preset, lite, state):
                    if first_ms is None: first_ms = int((time.time()-started)*1000)
                    full_text += delta; got = True
                    provider = state.get("provider") or provider
                    yield emit({"delta": delta})
            except Exception as e:
                if not got: yield emit({"error": f"{preset['label']}: {e}"})
        mw = extract_memory_writes(full_text)
        display = MEMORY_PATTERN.sub("", full_text).strip() or full_text
        for fact in mw:
            rec.setdefault("memory", []).append({"id": str(uuid.uuid4()), "text": fact, "added": time.time()})
        if mw: rec["memory"] = rec["memory"][-MAX_MEMORY_FACTS:]
        target = convo
        if target is None:
            cid = str(uuid.uuid4())
            title = user_message[:48] + ("…" if len(user_message) > 48 else "")
            target = {"id": cid, "title": title, "updated": time.time(), "messages": []}
            rec["history"].append(target)
        su = f"[image] {user_message}" if using_vision else user_message
        target["messages"].append({"role": "user", "text": su})
        target["messages"].append({"role": "ai", "text": display})
        target["updated"] = time.time()
        if not lite: rec["daily_count"] = rec.get("daily_count", 0) + 1
        if using_vision and not cfg.get("vision_unlimited"):
            rec["vision_count"] = rec.get("vision_count", 0) + 1
        total_ms = int((time.time()-started)*1000)
        yield emit({"meta": {"conversation_id": target["id"], "model": preset["label"],
            "ms": total_ms, "first_token_ms": first_ms, "provider": provider,
            "searched": bool(snippets), "sources": snippets, "memory_writes": mw,
            "daily_remaining": _daily_remaining(rec), "lite_mode": lite,
            "daily_reset_seconds": _daily_reset_seconds(rec) if lite else 0,
            "vision": using_vision, "vision_remaining": _vision_remaining(rec)}})

    return Response(generate(), mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})

@app.route("/api/chat", methods=["POST"])
def api_chat():
    uid = session.get("user_id")
    if not uid: return jsonify({"error": "Sign in first."}), 401
    rec = get_user_record(uid)
    if rec.get("banned"): return jsonify({"error": "Banned."}), 403
    refresh_tier_expiry(rec); _reset_daily(rec); _reset_period(rec); _reset_vision_day(rec)
    lite = _is_lite(rec); cfg = get_tier_config(rec["tier"])
    d = request.get_json(silent=True) or {}
    user_message = (d.get("message") or "").strip()
    conv_id = d.get("conversation_id")
    model_id = d.get("model") or DEFAULT_MODEL_PRESET
    if model_id not in MODEL_PRESETS: model_id = DEFAULT_MODEL_PRESET
    if not lite and model_id not in cfg["models_allowed"]: model_id = cfg["models_allowed"][0]
    if lite: model_id = "mirox-gen1"
    file_name = (d.get("file_name") or "").strip() or None
    file_content = (d.get("file_content") or "")[:MAX_ATTACHMENT_CHARS] or None
    image_data_url = (d.get("image_data_url") or "").strip() or None
    web = bool(d.get("web_search"))
    using_vision = bool(image_data_url)
    if not user_message and not using_vision: return jsonify({"error": "No message."}), 400
    if using_vision and not user_message: user_message = "Describe this image."
    convo = next((c for c in rec["history"] if c["id"] == conv_id), None)
    prior = convo["messages"] if convo else []
    preset = dict(MODEL_PRESETS[model_id]); preset["_id"] = model_id
    snippets = web_search_snippets(user_message) if web else []
    training = get_training()
    messages = build_messages(user_message, preset, rec.get("persona",""), rec.get("memory",[]),
        file_name, file_content, snippets, prior, training, image_data_url=image_data_url)
    started = time.time()
    text = ""; provider = None
    try:
        if using_vision:
            text = call_vision(messages); provider = "vision"
        else:
            if not lite and get_airoute_key():
                try:
                    r = call_airoute_chat(preset["airoute_model"], get_airoute_key(),
                                          flatten_messages(messages))
                    text = r.get("text") or str(r); provider = "airoute"
                except Exception: pass
            if not text:
                headers = {"Content-Type": "application/json"}
                tok = get_pollinations_key()
                if tok: headers["Authorization"] = f"Bearer {tok}"
                try:
                    r = requests.post(POLLINATIONS_URL, headers=headers,
                        json={"model": POLLINATIONS_MODEL, "messages": messages,
                              "max_tokens": HF_MAX_TOKENS}, timeout=CHAT_TIMEOUT)
                    r.raise_for_status()
                    text = (_choice0(r.json()).get("message") or {}).get("content") or ""
                    provider = "pollinations"
                except Exception: pass
            if not text and hf_available() and not lite:
                try:
                    m = get_hf_models(model_id)[0]
                    text = call_hf_chat(m, messages); provider = "hf"
                except Exception: pass
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    if not text: return jsonify({"error": "All providers failed."}), 500
    mw = extract_memory_writes(text)
    display = MEMORY_PATTERN.sub("", text).strip() or text
    for fact in mw:
        rec.setdefault("memory", []).append({"id": str(uuid.uuid4()), "text": fact, "added": time.time()})
    if mw: rec["memory"] = rec["memory"][-MAX_MEMORY_FACTS:]
    if convo is None:
        conv_id = str(uuid.uuid4())
        title = user_message[:48] + ("…" if len(user_message) > 48 else "")
        convo = {"id": conv_id, "title": title, "updated": time.time(), "messages": []}
        rec["history"].append(convo)
    convo["messages"].append({"role": "user", "text": ("[image] " if using_vision else "") + user_message})
    convo["messages"].append({"role": "ai", "text": display})
    convo["updated"] = time.time()
    if not lite: rec["daily_count"] = rec.get("daily_count", 0) + 1
    if using_vision and not cfg.get("vision_unlimited"):
        rec["vision_count"] = rec.get("vision_count", 0) + 1
    return jsonify({"reply": display, "model": preset["label"],
        "ms": int((time.time()-started)*1000), "conversation_id": conv_id,
        "memory_writes": mw, "searched": bool(snippets), "provider": provider,
        "project_files": parse_project_files(text),
        "daily_remaining": _daily_remaining(rec), "lite_mode": lite,
        "vision": using_vision, "vision_remaining": _vision_remaining(rec)})

# ---- Playground ----
@app.route("/api/playground/me", methods=["GET"])
def api_pg_me():
    found = _find_user_by_key(_extract_bearer())
    if not found: return jsonify({"error": "Invalid or missing API key."}), 401
    uid, rec, kr = found; refresh_tier_expiry(rec)
    cfg = get_tier_config(rec["tier"])
    return jsonify({"ok": True, "user": {"id": uid, "name": rec.get("name"), "email": rec.get("email")},
        "tier": rec["tier"], "tier_label": cfg["label"], "key_name": kr.get("name"),
        "daily_remaining": _daily_remaining(rec), "daily_limit": cfg["daily_limit"],
        "models_allowed": cfg["models_allowed"], "images_allowed": cfg["images_allowed"],
        "video_allowed": cfg.get("video_allowed", False)})

@app.route("/api/playground/chat", methods=["POST"])
def api_pg_chat():
    found = _find_user_by_key(_extract_bearer())
    if not found: return jsonify({"error": "Invalid or missing API key."}), 401
    uid, rec, kr = found; refresh_tier_expiry(rec); _reset_daily(rec); _reset_period(rec)
    lite = _is_lite(rec); cfg = get_tier_config(rec["tier"])
    d = request.get_json(silent=True) or {}
    user_message = (d.get("message") or "").strip()
    model_id = d.get("model") or DEFAULT_MODEL_PRESET
    if model_id not in MODEL_PRESETS: model_id = DEFAULT_MODEL_PRESET
    if not lite and model_id not in cfg["models_allowed"]: model_id = cfg["models_allowed"][0]
    if lite: model_id = "mirox-gen1"
    if not user_message: return jsonify({"error": "No message."}), 400
    preset = dict(MODEL_PRESETS[model_id]); preset["_id"] = model_id
    messages = build_messages(user_message, preset, rec.get("persona",""), rec.get("memory",[]),
        None, None, None, [], get_training())
    started = time.time(); text = ""; provider = None
    if not lite and get_airoute_key():
        try:
            r = call_airoute_chat(preset["airoute_model"], get_airoute_key(), flatten_messages(messages))
            text = r.get("text") or str(r); provider = "airoute"
        except Exception: pass
    if not text:
        headers = {"Content-Type": "application/json"}
        tok = get_pollinations_key()
        if tok: headers["Authorization"] = f"Bearer {tok}"
        try:
            r = requests.post(POLLINATIONS_URL, headers=headers,
                json={"model": POLLINATIONS_MODEL, "messages": messages, "max_tokens": HF_MAX_TOKENS},
                timeout=CHAT_TIMEOUT)
            r.raise_for_status()
            text = (_choice0(r.json()).get("message") or {}).get("content") or ""
            provider = "pollinations"
        except Exception: pass
    if not text: return jsonify({"error": "All providers failed."}), 500
    rec["daily_count"] = rec.get("daily_count", 0) + 1
    return jsonify({"reply": text, "model": preset["label"],
        "ms": int((time.time()-started)*1000), "provider": provider,
        "daily_remaining": _daily_remaining(rec)})

# ---- Admin ----
@app.route("/api/admin/login", methods=["POST"])
def api_admin_login():
    d = request.get_json(silent=True) or {}
    if (d.get("password") or "").strip() != ADMIN_PASSWORD:
        return jsonify({"ok": False, "error": "Wrong password."}), 401
    session["is_admin"] = True
    tok = uuid.uuid4().hex; session["admin_token"] = tok
    with ADMIN_SESS_LOCK:
        ADMIN_SESSIONS[tok] = {"token": tok, "ip": _client_ip(),
                                "login_ts": time.time(), "last_seen": time.time()}
    return jsonify({"ok": True})

@app.route("/api/admin/status")
def api_admin_status():
    return jsonify({"ok": True, "is_admin": is_admin(), "banned": is_ip_banned(_client_ip())})

@app.route("/api/admin/quick")
def api_admin_quick():
    if not is_admin(): return jsonify({"ok": False}), 403
    return jsonify({"ok": True, "current_ip": _client_ip()})

@app.route("/api/admin/logout", methods=["POST"])
def api_admin_logout():
    tok = session.get("admin_token")
    if tok:
        with ADMIN_SESS_LOCK: ADMIN_SESSIONS.pop(tok, None)
    session.pop("admin_token", None); session.pop("is_admin", None)
    return jsonify({"ok": True})

@app.route("/api/admin/contact", methods=["GET", "POST"])
def api_admin_contact():
    cfg = _get_admin_config()
    if request.method == "GET":
        return jsonify({"ok": True, "email": cfg.get("contact_email", ""), "phone": cfg.get("contact_phone", "")})
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    cfg["contact_email"] = (d.get("email") or "").strip()[:120]
    cfg["contact_phone"] = (d.get("phone") or "").strip()[:60]
    return jsonify({"ok": True, "email": cfg["contact_email"], "phone": cfg["contact_phone"]})

@app.route("/api/admin/set-tier", methods=["POST"])
def api_admin_set_tier():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    tier = (d.get("tier") or "free").strip().lower()
    if tier not in SUBSCRIPTION_TIERS: return jsonify({"ok": False, "error": "Unknown tier."}), 400
    if "@" not in email: return jsonify({"ok": False, "error": "Email required."}), 400
    uid = "email:" + email
    rec = get_user_record(uid); cfg = get_tier_config(tier)
    rec["tier"] = tier; rec["tier_started"] = time.time()
    rec["tier_expires"] = time.time() + cfg["subscription_days"]*86400
    rec["key_period_start"] = time.time(); rec["keys_generated_in_period"] = 0
    rec["daily_count"] = 0; rec["daily_date"] = ""
    rec["img_gen_5h_count"] = 0; rec["img_gen_5h_start"] = time.time()
    rec["vision_count"] = 0; rec["vision_day"] = ""
    rec["video_count"] = 0; rec["video_day"] = ""
    return jsonify({"ok": True, "email": email, "tier": tier,
                    "tier_label": cfg["label"], "expires": rec["tier_expires"]})

@app.route("/api/admin/stats")
def api_admin_stats():
    if not is_admin(): return jsonify({"ok": False}), 403
    with BAN_LOCK: bc = len(BANNED_IPS)
    online = []
    with LAST_SEEN_LOCK:
        now = time.time()
        online = [{"ip": k, **v} for k, v in LAST_SEEN.items() if v["ts"] >= now - 60]
    with DATA_LOCK:
        users = DATA_STORE.get("users", {})
        total_users = len(users)
        named_users = sum(1 for u in users.values() if u.get("name"))
        total_convs = sum(len(u.get("history", [])) for u in users.values())
        total_msgs = sum(sum(len(c.get("messages", [])) for c in u.get("history", []))
                         for u in users.values())
        tier_counts = dict(Counter((u.get("tier") or "free") for u in users.values()))
        banned_users = sum(1 for u in users.values() if u.get("banned"))
        reports = list(DATA_STORE.get("reports", []))
    open_reports = sum(1 for r in reports if r.get("status") == "open")
    unread_reports = sum(1 for r in reports if r.get("unread_admin", 0) > 0)
    with CONFIG_LOCK:
        maint = bool(MAINTENANCE["enabled"]); ver = STATE_VERSION["v"]
    return jsonify({"ok": True, "total_requests": sum(ROUTE_HITS.values()),
        "unique_ips": len(LAST_SEEN), "banned_count": bc,
        "chats_count": 0, "images_count": 0,
        "online_count": len(online), "online_ips": online[:30],
        "uptime_seconds": int(time.time()-START_TIME), "response_stats": {},
        "maintenance": maint, "updating": False,
        "users_total": total_users, "users_named": named_users,
        "conversations_total": total_convs, "messages_total": total_msgs,
        "tier_counts": tier_counts, "banned_users": banned_users,
        "open_reports": open_reports, "unread_reports": unread_reports,
        "total_reports": len(reports),
        "system": {"python": "vercel", "platform": "vercel", "threads": threading.active_count()}})

@app.route("/api/admin/users")
def api_admin_users():
    if not is_admin(): return jsonify({"ok": False}), 403
    with DATA_LOCK:
        users = []
        for uid, rec in DATA_STORE.get("users", {}).items():
            users.append({"id": uid, "name": rec.get("name"), "email": rec.get("email"),
                "tier": rec.get("tier", "free"), "tier_expires": rec.get("tier_expires"),
                "convs": len(rec.get("history", [])), "keys": len(rec.get("api_keys", [])),
                "warnings": len(rec.get("warnings", [])), "banned": bool(rec.get("banned")),
                "ban_reason": rec.get("ban_reason", ""), "last_seen": rec.get("last_seen")})
    users.sort(key=lambda x: -(x.get("last_seen") or 0))
    return jsonify({"ok": True, "users": users[:200]})

@app.route("/api/admin/warn-user", methods=["POST"])
def api_admin_warn():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    uid = (d.get("uid") or "").strip(); reason = (d.get("reason") or "").strip()[:300]
    if not uid: return jsonify({"ok": False, "error": "User ID required."}), 400
    rec = DATA_STORE["users"].get(uid)
    if not rec: return jsonify({"ok": False, "error": "Not found."}), 404
    rec.setdefault("warnings", []).append({"ts": time.time(), "reason": reason or "(no reason)"})
    rec["warnings"] = rec["warnings"][-20:]
    return jsonify({"ok": True, "warnings": len(rec["warnings"])})

@app.route("/api/admin/ban-user", methods=["POST"])
def api_admin_ban_user():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    uid = (d.get("uid") or "").strip(); reason = (d.get("reason") or "").strip()[:300]
    if not uid: return jsonify({"ok": False}), 400
    rec = DATA_STORE["users"].get(uid)
    if not rec: return jsonify({"ok": False, "error": "Not found."}), 404
    rec["banned"] = True; rec["ban_reason"] = reason or "(no reason)"
    for k in rec.get("api_keys", []): k["revoked"] = True; k["key"] = ""
    return jsonify({"ok": True})

@app.route("/api/admin/unban-user", methods=["POST"])
def api_admin_unban_user():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    uid = (d.get("uid") or "").strip()
    if not uid: return jsonify({"ok": False}), 400
    rec = DATA_STORE["users"].get(uid)
    if not rec: return jsonify({"ok": False, "error": "Not found."}), 404
    rec["banned"] = False; rec["ban_reason"] = ""
    return jsonify({"ok": True})

@app.route("/api/admin/clear-warnings", methods=["POST"])
def api_admin_clear_warn():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    uid = (d.get("uid") or "").strip()
    if not uid: return jsonify({"ok": False}), 400
    rec = DATA_STORE["users"].get(uid)
    if not rec: return jsonify({"ok": False, "error": "Not found."}), 404
    rec["warnings"] = []
    return jsonify({"ok": True})

@app.route("/api/admin/reports")
def api_admin_reports():
    if not is_admin(): return jsonify({"ok": False}), 403
    with DATA_LOCK:
        items = [dict(r) for r in DATA_STORE.get("reports", [])]
        for r in items: _migrate_report(r)
        for r in DATA_STORE.get("reports", []):
            if r.get("unread_admin"): r["unread_admin"] = 0
    items.sort(key=lambda r: -(r.get("last_ts") or r.get("ts") or 0))
    return jsonify({"ok": True, "reports": items[:200]})

@app.route("/api/admin/report-reply", methods=["POST"])
def api_admin_report_reply():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    rid = (d.get("id") or "").strip(); reply = (d.get("reply") or "").strip()[:4000]
    if not rid or not reply: return jsonify({"ok": False, "error": "id and reply required."}), 400
    with DATA_LOCK:
        rep = next((r for r in DATA_STORE.get("reports", []) if r.get("id") == rid), None)
        if not rep: return jsonify({"ok": False, "error": "Not found."}), 404
        _migrate_report(rep)
        now = time.time()
        rep["messages"].append({"from": "admin", "text": reply, "ts": now})
        rep["last_ts"] = now; rep["status"] = "replied"
        rep["unread_user"] = (rep.get("unread_user", 0) or 0) + 1
    return jsonify({"ok": True})

@app.route("/api/admin/bans")
def api_admin_bans():
    if not is_admin(): return jsonify({"ok": False}), 403
    with BAN_LOCK:
        bans = [{"ip": ip, "reason": info.get("reason") or "", "ts": info.get("ts") or 0.0}
                for ip, info in sorted(BANNED_IPS.items())]
    return jsonify({"ok": True, "bans": bans})

@app.route("/api/admin/ban", methods=["POST"])
def api_admin_ban():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    ip = (d.get("ip") or "").strip(); reason = (d.get("reason") or "").strip()
    if not ip: return jsonify({"ok": False, "error": "IP required."}), 400
    ban_ip(ip, reason); return jsonify({"ok": True, "ip": ip})

@app.route("/api/admin/unban", methods=["POST"])
def api_admin_unban():
    if not is_admin(): return jsonify({"ok": False}), 403
    d = request.get_json(silent=True) or {}
    ip = (d.get("ip") or "").strip()
    if not ip: return jsonify({"ok": False, "error": "IP required."}), 400
    unban_ip(ip); return jsonify({"ok": True, "ip": ip})

@app.route("/api/admin/unban-all", methods=["POST"])
def api_admin_unban_all():
    if not is_admin(): return jsonify({"ok": False}), 403
    with BAN_LOCK:
        n = len(BANNED_IPS); BANNED_IPS.clear()
    return jsonify({"ok": True, "unbanned": n})

@app.route("/api/admin/logs/<t>")
def api_admin_logs(t):
    if not is_admin(): return jsonify({"ok": False}), 403
    return jsonify({"ok": True, "kind": "jsonl", "entries": [], "count": 0})

@app.route("/api/admin/logs/<t>/clear", methods=["POST"])
def api_admin_logs_clear(t):
    if not is_admin(): return jsonify({"ok": False}), 403
    return jsonify({"ok": True})

@app.route("/api/admin/maintenance", methods=["GET", "POST"])
def api_admin_maint():
    if not is_admin(): return jsonify({"ok": False}), 403
    if request.method == "GET":
        with CONFIG_LOCK: return jsonify({"ok": True, "enabled": MAINTENANCE["enabled"], "message": MAINTENANCE["message"]})
    d = request.get_json(silent=True) or {}
    with CONFIG_LOCK:
        if "enabled" in d: MAINTENANCE["enabled"] = bool(d["enabled"])
        if "message" in d: MAINTENANCE["message"] = (d.get("message") or "").strip()[:500] or "MiroxAI is under maintenance."
        STATE_VERSION["v"] += 1
    return jsonify({"ok": True, "enabled": MAINTENANCE["enabled"], "message": MAINTENANCE["message"]})

@app.route("/api/admin/broadcast", methods=["GET", "POST"])
def api_admin_bc():
    if not is_admin(): return jsonify({"ok": False}), 403
    if request.method == "GET":
        with CONFIG_LOCK:
            return jsonify({"ok": True, **BROADCAST, "history": list(BROADCAST_HISTORY)})
    d = request.get_json(silent=True) or {}
    msg = (d.get("message") or "").strip()[:500]
    btype = (d.get("type") or "info").strip()
    if btype not in ("info", "warn", "danger", "success"): btype = "info"
    with CONFIG_LOCK:
        BROADCAST_COUNTER["n"] += 1
        BROADCAST.update({"id": BROADCAST_COUNTER["n"], "message": msg, "type": btype,
                          "targets": "all", "ts": time.time()})
        if msg: BROADCAST_HISTORY.appendleft(dict(BROADCAST))
        STATE_VERSION["v"] += 1
    return jsonify({"ok": True, **BROADCAST})

# ---- Admin console & Developer help (Flask-rendered HTML) ----
_ADMIN_HTML = open(os.path.join(os.path.dirname(__file__), "_admin.html")).read() if os.path.exists(
    os.path.join(os.path.dirname(__file__), "_admin.html")) else "<h1>Admin</h1>"

@app.route("/admin/console")
def admin_console():
    return Response(_ADMIN_HTML, mimetype="text/html")

_DEV_HTML = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MiroxAI Developer</title>
<link href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css" rel="stylesheet">
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:32px 24px;line-height:1.7;color:#0a0a0c;background:#fafafb}
h1{font-size:28px;margin-bottom:16px}h2{font-size:19px;margin-top:32px}
code,pre{background:#f1f1f5;padding:2px 8px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:13px}
pre{padding:14px 16px;overflow-x:auto;border:1px solid #e8e8ef}
a{color:#c4694b}.ep{background:#fff;border:1px solid #e8e8ef;border-radius:10px;padding:12px 16px;margin:10px 0}
.ep code{background:transparent}</style></head><body>
<h1>MiroxAI Developer Help</h1>
<p>Build with MiroxAI via API key authentication. Get your key from <b>Plans → Your API keys</b>.</p>
<div class="ep"><b>POST</b> <code>/api/chat/stream</code> — SSE streaming chat</div>
<div class="ep"><b>POST</b> <code>/api/chat</code> — Non-streaming chat</div>
<div class="ep"><b>POST</b> <code>/api/image/generate</code> — Image generation (Pro/Ultimate)</div>
<div class="ep"><b>POST</b> <code>/api/video/generate</code> — Silent video (Pro/Ultimate)</div>
<h2>Authentication</h2>
<pre><code>Authorization: Bearer mirox_pro_...</code></pre>
<h2>Example</h2>
<pre><code>const res = await fetch('/api/chat', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({message:'Hello', model:'mirox-gen1'})
});
const data = await res.json();
console.log(data.reply);</code></pre>
<p style="margin-top:40px;color:#9494a0;text-align:center;font-size:12.5px">Made by <b>OpenSurr</b></p>
</body></html>"""

@app.route("/developer")
def developer_help():
    return Response(_DEV_HTML, mimetype="text/html")

# ---- Guard ----
@app.before_request
def _guard():
    ip = _client_ip()
    if _rate_exceeded(ip):
        if request.path in ("/api/admin/status", "/admin/console", "/api/client-status", "/developer"):
            return None
        ban_ip(ip, "Rate limit exceeded")
        return Response("Access Restricted", status=403, mimetype="text/plain")
    with ROUTE_LOCK: ROUTE_HITS[request.path] += 1
    with LAST_SEEN_LOCK:
        LAST_SEEN[ip] = {"ts": time.time(), "path": request.path}
    return None

@app.after_request
def _time(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return resp

# Vercel expects `app`
handler = app
