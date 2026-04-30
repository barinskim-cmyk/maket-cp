"""
setup_gdrive.py — одноразовый OAuth-flow для подключения Google Drive.

ЧТО ДЕЛАЕТ:
  1. Читает client credentials из v2/backend/secrets/google-oauth-client.json
  2. Открывает браузер на странице Google: «Maket CP запрашивает доступ к Drive»
  3. Ты подтверждаешь → Google редиректит на http://localhost:8080/ с кодом
  4. Скрипт обменивает код на access_token + refresh_token
  5. Сохраняет токены в v2/backend/secrets/google-token.json

ЗАПУСК (один раз):
    cd v2/backend
    pip3 install -r requirements.txt   # если ещё не ставила google-* библиотеки
    python3 setup_gdrive.py

После успешного запуска создастся файл google-token.json и его уже не надо
трогать — refresh_token автоматически обновляет access_token каждый час.

Если refresh_token «протух» (Google инвалидирует через 7 дней в Testing mode,
или после смены пароля Google) — просто запусти скрипт снова.

ВАЖНО:
  - Test users в Audience должны включать твой email — иначе Google скажет
    «Access blocked: Maket CP has not completed the Google verification process».
  - Скрипт надо запускать на той машине, где будет работать pywebview-app.
    Refresh token привязан к creds, не к машине, но удобнее держать рядом.
"""

import json
import os
import sys
from pathlib import Path

# ── Пути ──
HERE = Path(__file__).resolve().parent
SECRETS_DIR = HERE / "secrets"
CLIENT_SECRETS_PATH = SECRETS_DIR / "google-oauth-client.json"
TOKEN_PATH = SECRETS_DIR / "google-token.json"

# ── Scopes — drive.file даёт доступ ТОЛЬКО к файлам, что наше приложение
#    само создало. Чужие файлы пользователя нам недоступны. ──
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def main():
    if not CLIENT_SECRETS_PATH.exists():
        print(f"❌ Не найден файл credentials: {CLIENT_SECRETS_PATH}")
        print("   Скачай JSON из Google Cloud Console → APIs & Services → Credentials")
        print("   и положи его как secrets/google-oauth-client.json")
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("❌ Не установлены google-auth-oauthlib / google-api-python-client.")
        print("   Запусти: pip3 install -r requirements.txt")
        sys.exit(1)

    print("→ Читаю client credentials из", CLIENT_SECRETS_PATH.name)
    print("→ Запускаю OAuth-flow. Сейчас откроется браузер.")
    print("  Если откроется не тот gmail — выбери правильный аккаунт.")
    print()

    # InstalledAppFlow поддерживает и web-, и installed-credentials.
    # run_local_server поднимает временный HTTP-сервер на http://localhost:8080/
    # (URI должен быть зарегистрирован в Authorized redirect URIs в Google Console).
    flow = InstalledAppFlow.from_client_secrets_file(
        str(CLIENT_SECRETS_PATH),
        scopes=SCOPES,
    )

    # access_type='offline' + prompt='consent' гарантируют выдачу refresh_token.
    # Без этого Google вернёт только access_token (1 час), и скрипт придётся
    # запускать снова через час.
    creds = flow.run_local_server(
        port=8080,
        access_type="offline",
        prompt="consent",
        open_browser=True,
    )

    # Сериализуем токены: refresh_token переживает рестарты, access_token
    # обновляется автоматически Drive-клиентом по token_uri.
    token_data = {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }

    # Гарантируем что secrets/ существует (на случай первого запуска)
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        json.dump(token_data, f, indent=2, ensure_ascii=False)
    # Только владельцу — read/write. Защита от случайного шаринга по сети.
    try:
        os.chmod(TOKEN_PATH, 0o600)
    except Exception:
        pass

    print()
    print("✓ Авторизация успешна.")
    print("✓ Токены сохранены:", TOKEN_PATH)
    print()
    print("Что доступно теперь:")
    print(f"  - refresh_token живёт пока ты не отзовёшь доступ в myaccount.google.com")
    print(f"  - В Testing mode Google инвалидирует token через 7 дней — тогда")
    print(f"    просто запусти этот скрипт ещё раз.")
    print()

    # Проверяем что Drive API реально отвечает
    print("→ Делаю тестовый запрос к Drive API...")
    try:
        from googleapiclient.discovery import build

        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        about = service.about().get(fields="user(emailAddress,displayName),storageQuota").execute()
        user = about.get("user", {})
        quota = about.get("storageQuota", {})

        used_gb = int(quota.get("usage", 0)) / 1024 / 1024 / 1024
        limit_raw = quota.get("limit")
        limit_gb = int(limit_raw) / 1024 / 1024 / 1024 if limit_raw else None

        print(f"✓ Подключено к Drive: {user.get('emailAddress', '?')} ({user.get('displayName', '?')})")
        if limit_gb:
            print(f"  Storage: {used_gb:.1f} GB / {limit_gb:.0f} GB")
        else:
            print(f"  Storage: {used_gb:.1f} GB used (unlimited plan?)")
    except Exception as e:
        print(f"⚠ Тестовый запрос не прошёл, но токен сохранён: {e}")
        print("  Возможно временная сетевая проблема — приложение всё равно сможет")
        print("  использовать токен.")

    print()
    print("Готово. Можно запускать основное приложение.")


if __name__ == "__main__":
    main()
