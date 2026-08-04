import re
import sys
from urllib.parse import urlparse

import afm_probe

_original_parse = afm_probe.parse_model_page
_image_re = re.compile(r"\.(?:jpg|jpeg|png|webp)$", re.I)


def _is_real_image(url: str) -> bool:
    path = urlparse(url or "").path
    return bool(_image_re.search(path)) and not path.lower().endswith("/blank.gif")


def parse_only_real_colors(model: str, page_url: str):
    records = _original_parse(model, page_url)
    valid = [
        record for record in records
        if _is_real_image(record.face_url) and _is_real_image(record.profile_url)
    ]
    removed = len(records) - len(valid)
    if removed:
        afm_probe.log(
            f"[NETTOYAGE] {model}: {removed} ancienne(s) entrée(s) vide(s) exclue(s) "
            "car aucune photo n'est publiée."
        )
    return valid


afm_probe.parse_model_page = parse_only_real_colors
raise SystemExit(afm_probe.main())
