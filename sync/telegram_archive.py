"""
ארכיון טלגרם → אחסון ענן → episodes.json
==========================================
רץ אוטומטית ב-GitHub Actions (בלי שרת). בכל הרצה:
  1. מתחבר לטלגרם עם הבוט (דרך MTProto – בלי מגבלת ה-20MB של Bot API).
  2. עובר על ההודעות בכל ערוץ לפי מספר, מהמקום שבו עצר בפעם הקודמת.
  3. כל הודעה עם קובץ שמע: מוריד, מעלה ל-Cloudflare R2, ומוסיף ל-data/episodes.json.
  4. שומר את המיקום ב-data/sync-state.json – ההרצה הבאה ממשיכה משם.

ההרצה הראשונה (ההיסטוריה המלאה) נמשכת כמה הרצות ברצף; כל אחת עד ~5.5 שעות.
אחר כך כל הרצה שעתית לוקחת דקה-שתיים ומוסיפה רק פרקים חדשים.

משתני סביבה (מוגדרים כ-Secrets ב-GitHub):
  TG_API_ID, TG_API_HASH, TG_BOT_TOKEN
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  MEDIA_BASE_URL     – הכתובת הציבורית של ה-bucket (https://pub-xxxx.r2.dev)
  CHANNELS           – אופציונלי. ברירת מחדל: שני הערוצים של יואלי
  TIME_BUDGET_MIN    – אופציונלי. כמה דקות לעבוד בהרצה אחת (ברירת מחדל 320)
  AUDIO_BITRATE      – אופציונלי. למשל 96k כדי לדחוס ולחסוך אחסון. ריק = הקובץ המקורי
  MAX_PER_CHANNEL    – אופציונלי. כמה פרקים לכל היותר מכל ערוץ (ברירת מחדל 30 – לשמור על נפח האחסון).
                       0 = בלי הגבלה. מגדילים רק אם יש מקום ב-R2.
  NOTIFY_CHAT_ID     – אופציונלי. צ'אטים/ערוצים שאליהם הבוט ישלח הודעה כשנוספים פרקים,
                       מופרדים בפסיק (-1001234567890,-1009876543210). הבוט חייב להיות מנהל שם.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EPISODES = ROOT / "data" / "episodes.json"
STATE = ROOT / "data" / "sync-state.json"
DEFAULT_CHANNELS = "Masster_Play=מאסטר פליי;laila_menatzeach=לילה מנצח"
BATCH = 100          # כמה מספרי הודעות לבקש בכל קריאה
END_GAP = 3000       # כמה מספרים ריקים ברצף = סוף הערוץ (בינתיים)
IL_TZ = timezone(timedelta(hours=2))  # לתאריך בלבד; שעון קיץ לא משנה את היום ברוב המקרים

AUDIO_EXT = ("mp3", "m4a", "aac", "ogg", "oga", "opus", "wav")


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- עזרים
def parse_channels(spec):
    out = []
    for part in (spec or DEFAULT_CHANNELS).split(";"):
        if "=" in part:
            user, cat = part.split("=", 1)
        else:
            user, cat = part, part
        user = user.strip().lstrip("@")
        if user:
            out.append({"username": user, "slug": user.lower(), "category": cat.strip() or user})
    return out


def load_json(path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", "utf-8")
    tmp.replace(path)


DATE_RE = re.compile(r"(\d{1,2})[./](\d{1,2})[./](\d{2,4})")
HEB_RE = re.compile(r"[֐-׿]")
TAG_RE = re.compile(r"#[\w]+", re.UNICODE)


def date_from_text(t):
    m = DATE_RE.search(t or "")
    if not m:
        return None
    d, mo, y = (int(x) for x in m.groups())
    if y < 100:
        y += 2000
    if not (1 <= mo <= 12 and 1 <= d <= 31 and 2000 <= y <= 2100):
        return None
    return f"{y:04d}-{mo:02d}-{d:02d}"


def build_meta(caption, file_title, performer, file_name, posted, category):
    """כותרת ותאריך לפרק. posted = datetime של הפוסט."""
    cap = TAG_RE.sub("", caption or "").strip()
    first = cap.splitlines()[0].strip() if cap else ""
    tags = " – ".join(x for x in (performer, file_title) if x)
    stem = re.sub(r"\.[^.]+$", "", file_name or "").replace("_", " ").strip()
    date = (date_from_text(first) or date_from_text(file_title) or date_from_text(file_name)
            or posted.astimezone(IL_TZ).strftime("%Y-%m-%d"))
    y, mo, d = date.split("-")
    fallback = f"{category} – {d}.{mo}.{y[2:]}"
    title = first or tags or (stem if HEB_RE.search(stem) else "") or fallback
    return title[:200], date


def ext_for(file_name, mime):
    m = re.search(r"\.([a-z0-9]+)$", (file_name or "").lower())
    if m and m.group(1) in AUDIO_EXT:
        return m.group(1)
    mime = mime or ""
    if "mpeg" in mime:
        return "mp3"
    if "mp4" in mime or "aac" in mime:
        return "m4a"
    if "ogg" in mime or "opus" in mime:
        return "ogg"
    return "mp3"


MIME = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac", "ogg": "audio/ogg",
        "oga": "audio/ogg", "opus": "audio/ogg", "wav": "audio/wav"}


def is_audio(msg):
    if getattr(msg, "audio", None) or getattr(msg, "voice", None):
        return True
    f = getattr(msg, "file", None)
    return bool(f and (f.mime_type or "").startswith("audio/"))


def transcode(src, bitrate):
    """דחיסה אופציונלית ל-MP3 (ffmpeg מותקן בשרתי GitHub)."""
    dst = src + ".enc.mp3"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src,
                    "-vn", "-c:a", "libmp3lame", "-b:a", bitrate, dst], check=True)
    os.remove(src)
    return dst


# ---------------------------------------------------------------- עבודה
class Archive:
    def __init__(self, media_base):
        self.media_base = media_base.rstrip("/")
        self.data = load_json(EPISODES, {"items": []})
        if self.data.get("source") != "telegram":   # מחליפים את נתוני ההדגמה
            self.data = {"items": []}
        self.ids = {it["id"] for it in self.data["items"]}
        self.new = []   # פרקים שנוספו בהרצה הזו (להודעה בטלגרם)
        self.state = load_json(STATE, {})

    def save(self):
        self.data["items"].sort(key=lambda x: (x["date"], x["id"]), reverse=True)
        self.data["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.data["source"] = "telegram"
        self.data["count"] = len(self.data["items"])
        save_json(EPISODES, self.data)
        save_json(STATE, self.state)


async def sync_channel(client, uploader, arc, ch, deadline, bitrate=None, max_items=0):
    have = sum(1 for it in arc.data["items"] if it["id"].startswith(ch["slug"] + "-"))
    if max_items and have >= max_items:
        log(f"■ @{ch['username']}: כבר יש {have} פרקים (המגבלה {max_items}) – מדלג")
        return 0, True
    entity = await client.get_entity(ch["username"])
    st = arc.state.setdefault(ch["slug"], {"last_id": 0})
    pos, gap, added = st["last_id"] + 1, 0, 0
    log(f"▶ @{ch['username']} → {ch['category']} (ממשיך מהודעה {pos}, יש {have}"
        + (f" מתוך {max_items})" if max_items else ")"))

    while time.time() < deadline:
        msgs = await client.get_messages(entity, ids=list(range(pos, pos + BATCH)))
        found = False
        for msg in msgs:
            if msg is None:
                continue
            found = True
            if time.time() >= deadline:
                return added, False
            ep_id = f"{ch['slug']}-{msg.id}"
            if is_audio(msg) and ep_id not in arc.ids:
                f = msg.file
                title, date = build_meta(msg.message, getattr(f, "title", None), getattr(f, "performer", None),
                                         f.name, msg.date, ch["category"])
                ext = ext_for(f.name, f.mime_type)
                with tempfile.TemporaryDirectory() as tmpd:
                    path = os.path.join(tmpd, f"{ep_id}.{ext}")
                    size_mb = (f.size or 0) / 1048576
                    log(f"  ↓ {msg.id}: {title} ({size_mb:.0f}MB)")
                    await client.download_media(msg, file=path)
                    if bitrate:
                        path, ext = transcode(path, bitrate), "mp3"
                    key = f"{ch['slug']}/{msg.id}.{ext}"
                    uploader(path, key, MIME.get(ext, "audio/mpeg"))
                item = {
                    "id": ep_id, "title": title, "category": ch["category"], "date": date,
                    "duration": int(getattr(f, "duration", 0) or 0),
                    "url": f"{arc.media_base}/{key}",
                    "telegram": f"{ch['username']}/{msg.id}",
                }
                arc.data["items"].append(item)
                arc.new.append(item)
                arc.ids.add(ep_id)
                added += 1
                st["last_id"] = max(st["last_id"], msg.id)
                if max_items and have + added >= max_items:
                    arc.save()
                    log(f"■ @{ch['username']}: הגענו ל-{max_items} פרקים – עוצרים כדי לשמור על נפח האחסון")
                    return added, True
            st["last_id"] = max(st["last_id"], msg.id)
            if added and added % 5 == 0:
                arc.save()
        arc.save()
        gap = 0 if found else gap + BATCH
        if gap >= END_GAP:
            return added, True          # הגענו לסוף הערוץ
        pos += BATCH
    return added, False


def make_uploader():
    import boto3
    from botocore.config import Config
    try:
        cfg = Config(request_checksum_calculation="when_required", response_checksum_validation="when_required",
                     retries={"max_attempts": 8, "mode": "standard"})
    except TypeError:  # botocore ישן
        cfg = Config(retries={"max_attempts": 8, "mode": "standard"})
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=cfg,
    )
    bucket = os.environ["R2_BUCKET"]

    def upload(path, key, content_type):
        s3.upload_file(path, bucket, key, ExtraArgs={
            "ContentType": content_type,
            "CacheControl": "public, max-age=31536000, immutable",
        })
    return upload


def notify_text(new_items, total):
    lines = [f"🎙 נוספו {len(new_items)} פרקים חדשים לארכיון של יואלי דיקמן:"]
    for it in new_items[:8]:
        lines.append(f"• {it['category']}: {it['title']}")
    if len(new_items) > 8:
        lines.append(f"…ועוד {len(new_items) - 8}")
    lines.append(f"סה״כ בארכיון: {total:,}")
    return "\n".join(lines)


async def notify(client, chat, text):
    """הודעה בטלגרם – כשל כאן לא מכשיל את ההרצה."""
    try:
        target = int(chat) if chat.lstrip("-").isdigit() else chat
        await client.send_message(target, text)
        log("✉ נשלחה הודעה לטלגרם")
    except Exception as e:  # noqa: BLE001
        log(f"⚠ לא הצלחתי לשלוח הודעה לטלגרם ({chat}): {e}")


async def main():
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    # ניקוי ערכים שהודבקו עם רווחים או שורות ריקות (טעות נפוצה בהדבקה ל-GitHub)
    for k in list(os.environ):
        if k.startswith(("TG_", "R2_")) or k in ("MEDIA_BASE_URL", "NOTIFY_CHAT_ID", "CHANNELS", "AUDIO_BITRATE", "MAX_PER_CHANNEL"):
            os.environ[k] = os.environ[k].strip()
    # R2_ACCOUNT_ID: מספיק להדביק את המזהה (32 תווים) – גם אם הודבקה כתובת מלאה
    acc = re.search(r"[0-9a-fA-F]{32}", os.environ.get("R2_ACCOUNT_ID", ""))
    if acc:
        os.environ["R2_ACCOUNT_ID"] = acc.group(0).lower()

    # מקבלים את MEDIA_BASE_URL גם אם נשמר כ-Secret וגם כ-Variable
    missing = [k for k in ("TG_API_ID", "TG_API_HASH", "TG_BOT_TOKEN", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID",
                           "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "MEDIA_BASE_URL") if not os.environ.get(k)]
    if missing:
        log("חסרים ערכים ב-GitHub (Settings ← Secrets and variables ← Actions): " + ", ".join(missing))
        if "MEDIA_BASE_URL" in missing:
            log("MEDIA_BASE_URL = הכתובת הציבורית של ה-bucket ב-R2 (https://pub-….r2.dev). "
                "ב-Cloudflare: R2 ← ה-bucket ← Settings ← Public access ← R2.dev subdomain ← Allow.")
        sys.exit(1)
    if not re.match(r"^https://", os.environ["MEDIA_BASE_URL"].strip()):
        log("MEDIA_BASE_URL חייב להתחיל ב-https:// (למשל https://pub-xxxx.r2.dev)")
        sys.exit(1)

    deadline = time.time() + 60 * int(os.environ.get("TIME_BUDGET_MIN") or 320)
    bitrate = (os.environ.get("AUDIO_BITRATE") or "").strip() or None
    max_items = int(os.environ.get("MAX_PER_CHANNEL") or 30)
    channels = parse_channels(os.environ.get("CHANNELS"))
    arc = Archive(os.environ["MEDIA_BASE_URL"])
    uploader = make_uploader()

    client = TelegramClient(StringSession(), int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"])
    client.flood_sleep_threshold = 900   # המתנה אוטומטית בהגבלות קצב של טלגרם
    await client.start(bot_token=os.environ["TG_BOT_TOKEN"])
    try:
        total = 0
        for ch in channels:
            added, done = await sync_channel(client, uploader, arc, ch, deadline, bitrate, max_items)
            total += added
            log(f"✓ @{ch['username']}: נוספו {added}" + ("" if done else " (ימשיך בהרצה הבאה)"))
            if time.time() >= deadline:
                break
        # שומרים רק כשבאמת נוסף משהו – בלי קומיט מיותר כל שעה כשהארכיון כבר מלא
        if total:
            arc.save()
        log(f"סיום. נוספו {total} פרקים. בארכיון: {len(arc.data['items'])}.")
        # NOTIFY_CHAT_ID: אפשר כמה צ'אטים, מופרדים בפסיק
        chats = [c.strip() for c in (os.environ.get("NOTIFY_CHAT_ID") or "").replace(";", ",").split(",") if c.strip()]
        if arc.new and chats:
            text = notify_text(arc.new, len(arc.data["items"]))
            for chat in chats:
                await notify(client, chat, text)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
