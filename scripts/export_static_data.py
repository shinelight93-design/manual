"""GitHub Pages용 정적 포털(site/) 자료를 만든다.

사용법
  python scripts/export_static_data.py            PC의 data 폴더(DB·첨부파일)에서 전체를 새로 만든다.
  python scripts/export_static_data.py --refresh  이미 만든 site/data.js의 첨부파일 목록을 그대로 두고
                                                  업무매뉴얼 문구·순서·원문 분할·검색 색인만 다시 만든다.
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pypdf import PdfReader, PdfWriter  # noqa: E402

from app.handbook_data import HANDBOOK_CATEGORIES  # noqa: E402
from app.permission_data import PERMISSION_DOCUMENTS  # noqa: E402
from app.sample_data import SAMPLE_DOCUMENTS  # noqa: E402

DATA_DIR = ROOT / "data"
SITE_DIR = ROOT / "site"
ASSET_DIR = SITE_DIR / "assets"
MANUAL_SLICE_DIR = ASSET_DIR / "manual"
SOURCE_MANUAL_NAME = "통합민원 업무매뉴얼.pdf"

# 원본 매뉴얼에서 업무별로 보여줄 쪽 (2026.11.12판, 전체 73쪽)
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

# 업무매뉴얼 화면에 보일 분류명·큰 제목·작은 글씨·담당부서 (원래 분류명 기준)
MANUAL_OVERRIDES = {
    "출생·사망": {"category": "출생·사망", "title": "출생·사망",
                "summary": "출생신고, 사망신고, 재산조회 원스톱 서비스"},
    "가족관계시스템": {"category": "가족관계시스템", "title": "가족관계시스템",
                  "summary": "가족관계시스템 증명서"},
    "주민등록시스템": {"category": "주민등록시스템", "title": "주민등록시스템",
                  "summary": "등·초본, 인감, 본인서명, 전입신고, 전입세대확인서, 주민등록증"},
    "부동산종합공부": {"category": "부동산종합공부시스템", "title": "부동산종합공부시스템",
                  "summary": "토지·임야대장, 지적·임야도 등"},
    "토지이용계획": {"category": "KLIP(토지이용계획확인서)", "title": "KLIP(토지이용계획확인서)",
                 "summary": "토지이용계획확인원"},
    "건축행정시스템": {"category": "건축행정시스템(세움터)", "title": "건축행정시스템(세움터)",
                  "summary": "건축물대장, 현황도면"},
    "차세대지방세": {"category": "차세대지방세시스템", "title": "차세대지방세시스템",
                 "summary": "지방세납세증명서, 세목별과세증명서, 납부확인서 등"},
    "부동산공시가격": {"category": "부동산공시가격산정시스템", "title": "부동산공시가격산정시스템",
                  "summary": "개별공시지가확인서, 개별주택가격확인서", "department": "민원토지과(토지)·세무1과(주택)"},
    "부동산거래관리": {"category": "부동산거래관리시스템", "title": "부동산거래관리시스템",
                  "summary": "확정일자 부여, 임대차신고", "department": "민원토지과 토지관리팀"},
    "외국인정보공동이용": {"category": "외국인정보공동이용시스템", "title": "외국인정보공동이용시스템",
                    "summary": "출입국사실증명서, 외국인사실증명서, 체류지변경, 체류확인서"},
    "민원처리운영창구": {"category": "민원처리운영창구", "title": "민원처리운영창구"},
    "자동차등록원부": {"category": "자동차등록원부", "title": "자동차등록원부",
                  "summary": "자동차등록원부 갑·을부", "department_replace": ("차량등록계", "차량등록팀")},
}

RELATED_SITES = [
    {"name": "국가법령정보센터", "url": "https://www.law.go.kr/LSW/main.html"},
    {"name": "나의 사건 검색", "url": "https://www.scourt.go.kr/portal/information/events/search/search.jsp"},
    {"name": "웹팩스", "url": "http://102.6.1.119:8080/WebFax/users/login"},
    {"name": "모바일 신분증 진위확인·사본저장 시스템", "url": "https://ive.mobileid.go.kr/userLogin.do",
     "lines": ["모바일 신분증 진위확인·사본", "저장 시스템"]},
    {"name": "도로명주소", "url": "https://www.juso.go.kr/"},
    {"name": "토지이음", "url": "https://www.eum.go.kr/web/am/amMain.jsp"},
    {"name": "나라배움터", "url": "https://logodi.nhi.go.kr/"},
]

HANDBOOK_LABEL_LINES = {
    "inheritance-one-stop": ["안심상속 원스톱서비스", "재산조회"],
    "real-estate-transaction": ["부동산거래관리시스템", "(임대차신고·확정일자)"],
}
# 업무편람 분류 순서 (KLIP을 민원처리운영창구 앞으로)
HANDBOOK_ORDER = [
    "birth-death", "inheritance-one-stop", "family-relation", "resident-registration", "seal-signature",
    "foreigner-information", "real-estate-transaction", "klip", "civil-service-window",
]


def copy_asset(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Missing static document: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def attachment_rows(connection: sqlite3.Connection, table: str) -> list[dict]:
    return [dict(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY id")]


def ordered_handbooks(handbooks: list[dict]) -> list[dict]:
    rank = {slug: index for index, slug in enumerate(HANDBOOK_ORDER)}
    return sorted(handbooks, key=lambda item: rank.get(item["slug"], len(rank)))


def build_documents() -> list[dict]:
    documents = []
    for index, item in enumerate(SAMPLE_DOCUMENTS, start=1):
        original_category = item["category"]
        override = MANUAL_OVERRIDES.get(original_category, {})
        document = {"slug": f"guide-{index:02d}", **item}
        for key in ("category", "title", "summary", "department"):
            if key in override:
                document[key] = override[key]
        if "department_replace" in override:
            old, new = override["department_replace"]
            document["department"] = document["department"].replace(old, new)
        document["source_pages"] = list(SOURCE_PAGES.get(original_category, ()))
        documents.append(document)
    return documents


def page_text(page) -> str:
    text = page.extract_text() or ""
    text = re.sub(r"-\s*\d{1,3}\s*-", " ", text)  # 쪽 번호 "- 9 -"
    return re.sub(r"\s+", " ", text).strip()


def build_source_assets(documents: list[dict], source_manual: Path) -> tuple[dict | None, list[dict]]:
    """업무별 원문 PDF를 잘라 저장하고, 원문 검색 색인을 만든다."""
    if MANUAL_SLICE_DIR.exists():
        shutil.rmtree(MANUAL_SLICE_DIR)
    if not source_manual.is_file():
        return None, []
    MANUAL_SLICE_DIR.mkdir(parents=True)
    reader = PdfReader(source_manual)
    total = len(reader.pages)
    index: list[dict] = []
    for document in documents:
        if len(document["source_pages"]) != 2:
            continue
        start, end = document["source_pages"]
        if not 1 <= start <= end <= total:
            raise ValueError(f"{document['category']}: 원본은 {total}쪽까지 있습니다 ({start}~{end}쪽 지정)")
        writer = PdfWriter()
        for number in range(start, end + 1):
            writer.add_page(reader.pages[number - 1])
            index.append({"p": number, "s": document["slug"], "c": document["category"],
                          "t": page_text(reader.pages[number - 1])})
        destination = MANUAL_SLICE_DIR / f"{document['slug']}.pdf"
        with destination.open("wb") as handle:
            writer.write(handle)
        document["source_file"] = f"assets/manual/{destination.name}"
    stat = source_manual.stat()
    try:
        made = reader.metadata.modification_date or reader.metadata.creation_date
    except Exception:  # noqa: BLE001 - 작성일이 없거나 형식이 다르면 파일 날짜 사용
        made = None
    info = {
        "name": SOURCE_MANUAL_NAME,
        "url": "assets/source-manual.pdf",
        "size": stat.st_size,
        "date": (made.date() if made else date.fromtimestamp(stat.st_mtime)).isoformat(),
        "pages": total,
    }
    return info, index


def write_site(payload: dict, search_index: list[dict]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (SITE_DIR / "data.js").write_text(f"window.PORTAL_DATA={serialized};\n", encoding="utf-8")
    index = json.dumps(search_index, ensure_ascii=False, separators=(",", ":"))
    (SITE_DIR / "search-index.js").write_text(f"window.PORTAL_SEARCH={index};\n", encoding="utf-8")


def finalize(payload: dict) -> None:
    documents = build_documents()
    source_info, search_index = build_source_assets(documents, ASSET_DIR / "source-manual.pdf")
    payload["documents"] = documents
    payload["source_manual"] = source_info["url"] if source_info else None
    payload["source_manual_file"] = source_info
    payload["handbooks"] = ordered_handbooks(payload["handbooks"])
    for handbook in payload["handbooks"]:
        if handbook["slug"] in HANDBOOK_LABEL_LINES:
            handbook["label_lines"] = HANDBOOK_LABEL_LINES[handbook["slug"]]
    payload["related_sites"] = RELATED_SITES
    write_site(payload, search_index)


def refresh() -> None:
    raw = (SITE_DIR / "data.js").read_text(encoding="utf-8").strip()
    payload = json.loads(raw.removeprefix("window.PORTAL_DATA=").rstrip(";"))
    finalize(payload)


def main() -> None:
    database = DATA_DIR / "manuals.db"
    if not database.is_file():
        raise FileNotFoundError("data/manuals.db is required to export attachments")

    if ASSET_DIR.exists():
        shutil.rmtree(ASSET_DIR)
    ASSET_DIR.mkdir(parents=True)
    copy_asset(ROOT / "static" / "donggu-logo.png", ASSET_DIR / "donggu-logo.png")

    source_manual = DATA_DIR / "source-manual.pdf"
    if source_manual.is_file():
        copy_asset(source_manual, ASSET_DIR / "source-manual.pdf")

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
            copy_asset(DATA_DIR / "permission_attachments" / stored_name, ASSET_DIR / "permissions" / stored_name)
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
        exported["attachments"] = []
        for row in handbook_rows:
            if row["category_slug"] != item["slug"]:
                continue
            stored_name = Path(row["stored_filename"]).name
            copy_asset(DATA_DIR / "handbook_attachments" / stored_name, ASSET_DIR / "handbooks" / stored_name)
            exported["attachments"].append({
                "name": row["original_filename"],
                "type": row["file_type"],
                "size": row["size_bytes"],
                "date": row["created_at"],
                "url": f"assets/handbooks/{stored_name}",
            })
        handbooks.append(exported)

    finalize({
        "exported_on": date.today().isoformat(),
        "permissions": permissions,
        "handbooks": handbooks,
    })


if __name__ == "__main__":
    refresh() if "--refresh" in sys.argv[1:] else main()
