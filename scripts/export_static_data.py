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
from datetime import date, timedelta, timezone
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
KST = timezone(timedelta(hours=9))

# 원본 매뉴얼에서 업무별로 보여줄 쪽 (2026.11.14판, 전체 73쪽)
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
    {"name": "부동산 공시가격 알리미", "url": "https://www.realtyprice.kr/notice/main/main.do"},
    {"name": "나라배움터", "url": "https://logodi.nhi.go.kr/"},
]

# 권한신청서식 화면 조정
#  method: 신청방법 문구 교체 / notes_into_method: 주의사항을 신청방법 아래로 옮기고 주의사항 칸 없앰
#  notes_as_tips: 주의사항을 신청방법 아래 작은 글씨(∎)로 옮김 / attachments_enabled: 서식 칸 표시 여부
#  title_lines: 전체자료 카드 제목 줄바꿈
PERMISSION_OVERRIDES = {
    "certificate": {"notes_as_tips": True},
    "civil-service-window": {"method": "시스템 사용자 등록 ➜ 교육수료 ➜ 서식 작성 후 교육수료증과 함께 공문발송"},
    "official-price": {"notes_into_method": True, "title_lines": ["부동산공시가격", "시스템"]},
    "donggu-homepage": {"notes_as_tips": True, "attachments_enabled": False},
    "real-estate-transaction": {"title_lines": ["부동산거래관리", "시스템"]},
    "real-estate-ledger": {"title_lines": ["부동산종합공부", "시스템"]},
}
PERMISSION_NOTICE = {
    "label": "공통사항",
    "text": "시스템 담당부서의 ‘권한신청 안내공문’과 전임자의 ‘권한신청공문’ 확인.",
}

# 주민등록 담당자 월간 업무 달력 (주민등록 업무매뉴얼 전체자료 화면)
#  weeks: 주별 일정 / start·end: 막대가 걸치는 날짜 / label: 기간 안내 / columns: 업무 목록 칸 수
#  last_weekday: 화면에서 이번 달 마지막 평일을 계산해 그 날짜 칸과 맨 아래 줄에 함께 표시
RESIDENT_CALENDAR = {
    "title": "주민등록 담당자 월간 업무 달력",
    "weeks": [
        {"days": [1, 7], "events": [
            {"start": 1, "end": 5, "label": "매달 5일 이내", "columns": 2,
             "items": ["국가데이터처 인구동향조사", "행정통별인구현황", "주민등록 및 발급상황보고", "회수 주민등록증 인계"]},
            {"start": 1, "end": 7, "label": "매달 초", "items": ["주민등록증 미발급자 발급 통지"]},
        ]},
        {"days": [8, 14], "events": []},
        {"days": [15, 21], "events": [
            {"start": 15, "end": 21, "label": "매달 중순 이후", "items": ["신규주민등록증 발급 통지"], "continues": True},
        ]},
        {"days": [22, 28], "events": []},
        {"days": [29, 31], "events": []},
    ],
    "last_weekday": {"label": "매달 마지막 평일", "items": ["공동주택 인구현황"]},
}

# 담당자별 업무매뉴얼 (manuals/ 폴더의 PDF, 장별로 나눠 보여줌)
MANUALS_DIR = ROOT / "manuals"
MANUAL_SETS = [
    {
        "key": "resident", "file": "resident-manual.pdf", "name": "주민등록 담당자 업무매뉴얼.pdf",
        "department": "주민등록 담당자",
        "chapters": [
            ("일간 업무", "주민등록시스템 일일처리현황, 주민등록증 발급대장 출력, 주민등록증 수령 및 증수령 문자 안내", 2, 2),
            ("월간 업무", "공동주택인구현황, 인구동향조사, 행정통별인구현황, 주민등록증 발급상황, 회수 주민등록증 인계, "
                     "전출입사후확인서 교부, 신규주민등록증 발급 통지, 미발급자 발급 통지", 3, 6),
            ("분기 업무", "거주불명자 행정상 관리주소 이전, 주민등록 사실조사", 7, 7),
            ("수시 업무", "11호 통보, 거주불명 등록, 거주불명자 재등록, 신규 주민등록증 발급 지연, 과태료 고지서 출력 및 납부, "
                      "습득 주민등록증,\n장기 미수령증, 등본 상 외국인 세대원 등록", 8, 21),
        ],
    },
    {
        "key": "seal", "file": "seal-manual.pdf", "name": "인감 담당자 업무매뉴얼.pdf",
        "department": "인감 담당자",
        "chapters": [
            ("일간 업무", "세외수입(일일마감)", 2, 3),
            ("주간 업무", "무인민원발급기 마감, 인감증명서 대리발급사실통보 등기 송부, 인감대장 송부·수신", 4, 5),
            ("월간 업무", "월보 제출, 대학민원 수수료 납부, 주민등록증 등기우편 수수료 납부", 6, 7),
        ],
    },
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
        document["set"] = "manual"
        documents.append(document)
    for manual in MANUAL_SETS:
        for index, (title, summary, start, end) in enumerate(manual["chapters"], start=1):
            documents.append({
                "slug": f"{manual['key']}-{index:02d}", "set": manual["key"],
                "category": title, "title": title, "summary": summary,
                "department": manual["department"], "department_label": "담당",
                "content": summary, "source_pages": [start, end],
            })
    return documents


def page_text(page) -> str:
    text = (page.extract_text() or "").replace("\x00", " ")
    text = re.sub(r"-\s*\d{1,3}\s*-", " ", text)  # 쪽 번호 "- 9 -"
    return re.sub(r"\s+", " ", text).strip()


def manual_date(reader: PdfReader, path: Path) -> str:
    try:
        made = reader.metadata.modification_date or reader.metadata.creation_date
    except Exception:  # noqa: BLE001 - 작성일이 없거나 형식이 다르면 파일 날짜 사용
        made = None
    if made and made.tzinfo:
        return made.astimezone(KST).date().isoformat()
    if made:
        return made.date().isoformat()
    return date.fromtimestamp(path.stat().st_mtime).isoformat()


def slice_manual(set_key: str, documents: list[dict], source_manual: Path, name: str, url: str) -> tuple[dict | None, list[dict]]:
    """한 매뉴얼을 업무(장)별 PDF로 잘라 저장하고, 원문 검색 색인을 만든다."""
    members = [document for document in documents if document["set"] == set_key]
    if not source_manual.is_file():
        return None, []
    reader = PdfReader(source_manual)
    total = len(reader.pages)
    index: list[dict] = []
    for document in members:
        if len(document["source_pages"]) != 2:
            continue
        start, end = document["source_pages"]
        if not 1 <= start <= end <= total:
            raise ValueError(f"{document['category']}: {name}은 {total}쪽까지 있습니다 ({start}~{end}쪽 지정)")
        writer = PdfWriter()
        for number in range(start, end + 1):
            writer.add_page(reader.pages[number - 1])
            index.append({"m": set_key, "p": number, "s": document["slug"], "c": document["category"],
                          "t": page_text(reader.pages[number - 1])})
        destination = MANUAL_SLICE_DIR / f"{document['slug']}.pdf"
        with destination.open("wb") as handle:
            writer.write(handle)
        document["source_file"] = f"assets/manual/{destination.name}"
    info = {"name": name, "url": url, "size": source_manual.stat().st_size,
            "date": manual_date(reader, source_manual), "pages": total}
    return info, index


def write_site(payload: dict, search_index: list[dict]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (SITE_DIR / "data.js").write_text(f"window.PORTAL_DATA={serialized};\n", encoding="utf-8")
    index = json.dumps(search_index, ensure_ascii=False, separators=(",", ":"))
    (SITE_DIR / "search-index.js").write_text(f"window.PORTAL_SEARCH={index};\n", encoding="utf-8")


def finalize(payload: dict) -> None:
    documents = build_documents()
    if MANUAL_SLICE_DIR.exists():
        shutil.rmtree(MANUAL_SLICE_DIR)
    MANUAL_SLICE_DIR.mkdir(parents=True)
    source_files: dict[str, dict] = {}
    search_index: list[dict] = []
    info, index = slice_manual("manual", documents, ASSET_DIR / "source-manual.pdf",
                               SOURCE_MANUAL_NAME, "assets/source-manual.pdf")
    if info:
        source_files["manual"] = info
        search_index += index
    for manual in MANUAL_SETS:
        source = MANUALS_DIR / manual["file"]
        if not source.is_file():
            continue
        copy_asset(source, ASSET_DIR / manual["file"])
        info, index = slice_manual(manual["key"], documents, ASSET_DIR / manual["file"],
                                   manual["name"], f"assets/{manual['file']}")
        if info:
            source_files[manual["key"]] = info
            search_index += index
    payload["documents"] = [document for document in documents if document.get("source_file") or document["set"] == "manual"]
    payload["source_files"] = source_files
    payload["source_manual"] = source_files.get("manual", {}).get("url")
    payload["source_manual_file"] = source_files.get("manual")
    payload["handbooks"] = ordered_handbooks(payload["handbooks"])
    for handbook in payload["handbooks"]:
        if handbook["slug"] in HANDBOOK_LABEL_LINES:
            handbook["label_lines"] = HANDBOOK_LABEL_LINES[handbook["slug"]]
    originals = {item["slug"]: item for item in PERMISSION_DOCUMENTS}
    for permission in payload["permissions"]:
        if permission["slug"] in originals:
            original = originals[permission["slug"]]
            permission["method"], permission["notes"] = original["method"], list(original["notes"])
            permission["attachments_enabled"] = original.get("attachments_enabled", True)
            permission.pop("method_tips", None)
        override = PERMISSION_OVERRIDES.get(permission["slug"], {})
        if "method" in override:
            permission["method"] = override["method"]
        if override.get("notes_into_method") and permission["notes"]:
            permission["method"] = "\n".join([permission["method"], *permission["notes"]])
            permission["notes"] = []
        if override.get("notes_as_tips") and permission["notes"]:
            permission["method_tips"] = permission["notes"]
            permission["notes"] = []
        if "attachments_enabled" in override:
            permission["attachments_enabled"] = override["attachments_enabled"]
        if "title_lines" in override:
            permission["title_lines"] = override["title_lines"]
    payload["permission_notice"] = PERMISSION_NOTICE
    payload["calendars"] = {"resident": RESIDENT_CALENDAR}
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
