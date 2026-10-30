"""PDF metadata and font-embedding audit helpers."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


EMBEDDED_TRUETYPE_KEYS = ("/FontFile2",)


def audit_pdf(pdf_path: Path | str) -> dict:
    path = Path(pdf_path)
    result = {
        "status": "UNAVAILABLE",
        "page_size_mm": None,
        "metadata_title_empty": None,
        "plot_title_status": "UNAVAILABLE",
        "fonts": [],
        "evidence_type": "none",
        "detail": [],
    }
    if not path.is_file():
        result["detail"].append("PDF missing")
        return result

    fonts: list[dict] = []
    page_size_mm = None
    metadata_title_empty = None
    try:
        from pypdf import PdfReader

        reader = PdfReader(path)
        if reader.pages:
            box = reader.pages[0].mediabox
            page_size_mm = [
                round(float(box.width) / 72 * 25.4, 3),
                round(float(box.height) / 72 * 25.4, 3),
            ]
        metadata = reader.metadata or {}
        metadata_title = str(metadata.get("/Title") or "")
        metadata_title_empty = metadata_title.strip() == ""

        def descriptor_embedded(font_obj: object) -> bool:
            descriptor = font_obj.get("/FontDescriptor")
            if descriptor is None:
                return False
            descriptor_obj = descriptor.get_object()
            font_file = descriptor_obj.get(EMBEDDED_TRUETYPE_KEYS[0])
            if font_file is None:
                return False
            try:
                return bool(font_file.get_object().get_data())
            except Exception:
                return False

        def inspect_font(key: str, value: object) -> None:
            font = value.get_object()
            subtype = str(font.get("/Subtype", "")).strip().upper()
            base_font = str(font.get("/BaseFont", ""))
            embedded = False
            compliant = False
            font_issues: list[str] = []

            if subtype == "/TYPE3":
                font_issues.append("Type 3 font is not allowed")
            elif subtype == "/TRUETYPE":
                embedded = descriptor_embedded(font)
                compliant = embedded
                if not embedded:
                    font_issues.append("TrueType font is not embedded with FontFile2")
            elif subtype == "/TYPE0":
                descendants = font.get("/DescendantFonts")
                if descendants is None:
                    font_issues.append("Type0 font has no DescendantFonts")
                else:
                    descendants_obj = descendants.get_object()
                    descendant_results: list[tuple[bool, bool]] = []
                    for descendant in descendants_obj:
                        descendant_obj = descendant.get_object()
                        descendant_subtype = str(
                            descendant_obj.get("/Subtype", "")
                        ).strip().upper()
                        descendant_embedded = descriptor_embedded(descendant_obj)
                        descendant_ok = (
                            descendant_subtype == "/CIDFONTTYPE2"
                            and descendant_embedded
                        )
                        descendant_results.append(
                            (descendant_ok, descendant_embedded)
                        )
                        if descendant_subtype != "/CIDFONTTYPE2":
                            font_issues.append(
                                "Type0 descendant is not CIDFontType2"
                            )
                        elif not descendant_embedded:
                            font_issues.append(
                                "CIDFontType2 font is not embedded with FontFile2"
                            )
                    embedded = bool(descendant_results) and all(
                        item_embedded for _ok, item_embedded in descendant_results
                    )
                    compliant = bool(descendant_results) and all(
                        item_ok for item_ok, _item_embedded in descendant_results
                    )
            else:
                font_issues.append(
                    f"font subtype {subtype or '<missing>'} is non-compliant"
                )

            fonts.append(
                {
                    "key": key,
                    "subtype": subtype.lower(),
                    "base_font": base_font,
                    "embedded": embedded,
                    "compliant": compliant,
                    "issues": font_issues,
                }
            )

        for page in reader.pages:
            font_dict = page.get("/Resources", {}).get("/Font", {})
            for key, value in font_dict.items():
                inspect_font(key, value)
        result["evidence_type"] = "pdf_structure_embedded"
    except ImportError:
        result["detail"].append("pypdf unavailable")
    except Exception as exc:
        result["detail"].append(f"PDF structure read failed: {exc}")

    if result["evidence_type"].startswith("pdf_structure") is False:
        pdffonts = shutil.which("pdffonts")
        if pdffonts:
            try:
                completed = subprocess.run(
                    [pdffonts, str(path)], capture_output=True, text=True, timeout=30
                )
                result["evidence_type"] = "pdffonts"
                result["detail"].append(completed.stdout.strip()[:2000])
            except Exception as exc:
                result["detail"].append(f"pdffonts failed: {exc}")

    if result["evidence_type"] == "pdf_structure_embedded":
        result["fonts"] = fonts
        all_fonts_compliant = bool(fonts) and all(
            font["compliant"] for font in fonts
        )
        result["status"] = (
            "PASS" if all_fonts_compliant else "FAIL"
        )
        for font in fonts:
            for issue in font["issues"]:
                result["detail"].append(
                    f"{font['key']} ({font['subtype'] or 'unknown'}): {issue}"
                )
        if not fonts:
            result["detail"].append("No font dictionaries found")
    elif result["evidence_type"] == "pdffonts":
        result["detail"].append(
            "pdffonts output cannot prove the DescendantFonts chain"
        )
    result["metadata_title_empty"] = metadata_title_empty
    result["page_size_mm"] = page_size_mm
    return result
