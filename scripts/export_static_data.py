from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.handbook_data import HANDBOOK_CATEGORIES
from app.permission_data import PERMISSION_DOCUMENTS
from app.sample_data import SAMPLE_DOCUMENTS


DATA_DIR = ROOT / "data"
SITE_DIR = ROOT / "site"
ASSET_DIR = SITE_DIR / "assets"
SOURCE_PAGES = {
    "출생·사망": (3, 10),
    "가족관계시스템": (11, 14),
    "주민등록시스템": (15, 47),
    "부동산종합공부": (48, 51),
    "토지이용계획": (52, 52),
    "건축행정시스템": (53, 55),
    "차세대지방세": (56, 61),
    "부동산공시가격": (62, 62),
    "부동산거래관리": (63, 64),
    "외국인정보공동이용": (65, 68),
    "민원처리운영창구": (69, 72),
    "자동차등록원부": (73, 73),
}
RELATED_SITES = [
    ("국가법령정보센터", "https://www.law.go.kr/LSW/main.html"),
    ("나의 사건 검색", "https://www.scourt.go.kr/portal/information/events/search/search.jsp"),
    ("웹팩스", "http://102.6.1.119:8080/WebFax/users/login"),
    ("모바일 신분증 진위확인·사본저장 시스템", "https://ive.mobileid.go.kr/userLogin.do"),
]
HANDBOOK_LABEL_LINES = {
    "inheritance-one-stop": ["안심상속 원스톱서비스", "재산조회"],
    "real-estate-transaction": ["부동산거래관리시스템", "(임대차신고·확정일자)"],
}


def copy_asset(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Missing static document: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def attachment_rows(connection: sqlite3.Connection, table: str) -> list[dict]:
    return [dict(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY id")]


def main() -> None:
    database = DATA_DIR / "manuals.db"
    if not database.is_file():
        raise FileNotFoundError("data/manuals.db is required to export attachments")

    if ASSET_DIR.exists():
        shutil.rmtree(ASSET_DIR)
    ASSET_DIR.mkdir(parents=True)
    copy_asset(ROOT / "static" / "donggu-logo.png", ASSET_DIR / "donggu-logo.png")

    source_manual = DATA_DIR / "source-manual.pdf"
    source_manual_url = None
    if source_manual.is_file():
        copy_asset(source_manual, ASSET_DIR / "source-manual.pdf")
        source_manual_url = "assets/source-manual.pdf"

    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        permission_rows = attachment_rows(connection, "permission_attachments")
        handbook_rows = attachment_rows(connection, "handbook_attachments")
    finally:
        connection.close()

    permissions = []
    for item in PERMISSION_DOCUMENTS:
        exported = dict(item)
        exported["attachments"] = []
        for row in permission_rows:
            if row["permission_slug"] != item["slug"]:
                continue
            stored_name = Path(row["stored_filename"]).name
            copy_asset(
                DATA_DIR / "permission_attachments" / stored_name,
                ASSET_DIR / "permissions" / stored_name,
            )
            exported["attachments"].append({
                "name": row["original_filename"],
                "type": row["file_type"],
                "size": row["size_bytes"],
                "date": row["created_at"],
                "url": f"assets/permissions/{stored_name}",
            })
        permissions.append(exported)

    handbooks = []
    for item in HANDBOOK_CATEGORIES:
        exported = dict(item)
        if item["slug"] in HANDBOOK_LABEL_LINES:
            exported["label_lines"] = HANDBOOK_LABEL_LINES[item["slug"]]
        exported["attachments"] = []
        for row in handbook_rows:
            if row["category_slug"] != item["slug"]:
                continue
            stored_name = Path(row["stored_filename"]).name
            copy_asset(
                DATA_DIR / "handbook_attachments" / stored_name,
                ASSET_DIR / "handbooks" / stored_name,
            )
            exported["attachments"].append({
                "name": row["original_filename"],
                "type": row["file_type"],
                "size": row["size_bytes"],
                "date": row["created_at"],
                "url": f"assets/handbooks/{stored_name}",
            })
        handbooks.append(exported)

    documents = []
    for index, item in enumerate(SAMPLE_DOCUMENTS, start=1):
        documents.append({
            "slug": f"guide-{index:02d}",
            **item,
            "source_pages": list(SOURCE_PAGES.get(item["category"], ())),
        })

    payload = {
        "exported_on": date.today().isoformat(),
        "source_manual": source_manual_url,
        "documents": documents,
        "permissions": permissions,
        "handbooks": handbooks,
        "related_sites": [{"name": name, "url": url} for name, url in RELATED_SITES],
    }
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (SITE_DIR / "data.js").write_text(f"window.PORTAL_DATA={serialized};\n", encoding="utf-8")


if __name__ == "__main__":
    main()
