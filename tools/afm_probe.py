from __future__ import annotations

import csv
import hashlib
import os
import re
import shutil
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image

START_URL = "https://www.afm-optic.com/maryll-france-maryll-france-optiques,3.htm"
BASE_URL = "https://www.afm-optic.com"
OUT_ROOT = Path("AFM_Maryll_Optiques")
ZIP_PATH = Path("AFM_Maryll_Optiques_FACE_PROFIL_COMPLET.zip")
MANIFEST_PATH = OUT_ROOT / "MANIFESTE_PHOTOS.csv"
SUMMARY_PATH = OUT_ROOT / "CONTROLE_FINAL.txt"
ERROR_PATH = OUT_ROOT / "ERREURS.txt"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
    "Referer": BASE_URL + "/",
}

MODEL_RE = re.compile(
    r"/maryll-france-optiques-(?P<slug>.+?),3-(?P<model_id>\d+)(?:-(?P<color_id>\d+))?\.htm$",
    re.I,
)
IMAGE_EXT_RE = re.compile(r"\.(jpg|jpeg|png|webp)(?:\?|$)", re.I)
PRINT_LOCK = Lock()


@dataclass
class PhotoRecord:
    model: str
    color_id: str
    title: str
    description: str
    page_url: str
    face_url: str
    profile_url: str
    face_file: str = ""
    profile_file: str = ""
    face_sha256: str = ""
    profile_sha256: str = ""
    face_dimensions: str = ""
    profile_dimensions: str = ""
    status: str = "A_TELECHARGER"
    error: str = ""


def log(message: str) -> None:
    with PRINT_LOCK:
        print(message, flush=True)


def clean_text(value: str) -> str:
    return " ".join((value or "").replace("\xa0", " ").split())


def safe_name(value: str, max_len: int = 110) -> str:
    value = clean_text(value)
    value = re.sub(r'[<>:"/\\|?*]+', "_", value)
    value = value.strip(" ._-")
    return (value or "INCONNU")[:max_len]


def abs_url(value: str, base: str) -> str:
    return urljoin(base, (value or "").strip())


def model_match(url: str):
    return MODEL_RE.search(unquote(urlparse(url).path))


def model_key(url: str) -> tuple[str, str] | None:
    m = model_match(url)
    if not m:
        return None
    return (m.group("slug").lower(), m.group("model_id"))


def model_display(slug: str) -> str:
    s = unquote(slug).upper()
    if s.startswith("PENTOS-"):
        s = s.replace("-", " ")
    elif re.fullmatch(r"PO\.\d+-M", s):
        s = s[:-2] + " M"
    return s


def color_id_from_url(url: str) -> str:
    m = model_match(url)
    return m.group("color_id") if m and m.group("color_id") else ""


def get_bytes(url: str, timeout: int = 90, attempts: int = 6) -> bytes:
    last = None
    for attempt in range(1, attempts + 1):
        try:
            response = requests.get(url, headers=HEADERS, timeout=timeout)
            response.raise_for_status()
            if not response.content:
                raise RuntimeError("réponse vide")
            return response.content
        except Exception as exc:
            last = exc
            if attempt < attempts:
                time.sleep(min(10, 0.8 * (2 ** (attempt - 1))))
    raise RuntimeError(f"échec après {attempts} essais: {last}")


def get_soup(url: str) -> BeautifulSoup:
    data = get_bytes(url, timeout=90, attempts=6)
    return BeautifulSoup(data, "html.parser")


def discover_model_pages() -> list[tuple[str, str]]:
    soup = get_soup(START_URL)
    found: dict[tuple[str, str], tuple[str, str]] = {}
    for a in soup.find_all("a", href=True):
        url = abs_url(a.get("href"), START_URL).split("#", 1)[0]
        key = model_key(url)
        if not key:
            continue
        slug, _model_id = key
        found.setdefault(key, (model_display(slug), url))

    pages = sorted(found.values(), key=lambda x: x[0])
    log(f"[INDEX] {len(pages)} modèles uniques détectés.")
    if len(pages) < 70:
        raise RuntimeError(f"Seulement {len(pages)} modèles détectés sur la page principale.")
    return pages


def best_img_url(img, page_url: str) -> str:
    if img is None:
        return ""
    for attr in ("data-original", "data-src", "data-lazy-src", "src"):
        value = img.get(attr)
        if value and not value.startswith("data:"):
            return abs_url(value, page_url)
    srcset = img.get("srcset") or img.get("data-srcset")
    if srcset:
        parts = [p.strip().split()[0] for p in srcset.split(",") if p.strip()]
        if parts:
            return abs_url(parts[-1], page_url)
    return ""


def parse_model_page(model: str, page_url: str) -> list[PhotoRecord]:
    soup = get_soup(page_url)

    descriptions: dict[str, str] = {}
    colors_box = soup.select_one("#les_couleurs")
    if colors_box:
        for a in colors_box.find_all("a", href=True):
            cid = color_id_from_url(abs_url(a.get("href"), page_url))
            text = clean_text(a.get_text(" ", strip=True))
            if cid and text:
                descriptions[cid] = text

    records: dict[str, PhotoRecord] = {}
    for a in soup.select("a[data-cle-sous-reference][data-photo-1-sous-reference]"):
        cid = clean_text(a.get("data-cle-sous-reference", ""))
        face = abs_url(a.get("data-photo-1-sous-reference", ""), page_url)
        profile = best_img_url(a.find("img"), page_url)
        href = abs_url(a.get("href", ""), page_url)
        title = clean_text(a.get("data-titre-sous-reference", ""))
        description = descriptions.get(cid, title)
        if not cid or not face or not profile:
            continue
        records[cid] = PhotoRecord(
            model=model,
            color_id=cid,
            title=title or description or f"{model} coloris {cid}",
            description=description or title,
            page_url=href or page_url,
            face_url=face,
            profile_url=profile,
        )

    # Repli pour d'anciens modèles dont le carrousel aurait une structure différente.
    if not records and colors_box:
        for a in colors_box.find_all("a", href=True):
            href = abs_url(a.get("href"), page_url)
            cid = color_id_from_url(href)
            if not cid:
                continue
            detail = get_soup(href)
            face_a = detail.select_one(".produit-fiche-photo-grande a[href]")
            face = abs_url(face_a.get("href"), href) if face_a else ""
            profile = ""
            for carousel_a in detail.select("a[data-cle-sous-reference]"):
                if clean_text(carousel_a.get("data-cle-sous-reference", "")) == cid:
                    profile = best_img_url(carousel_a.find("img"), href)
                    break
            title = clean_text(detail.find("h1").get_text(" ", strip=True)) if detail.find("h1") else clean_text(a.get_text(" ", strip=True))
            if face and profile:
                records[cid] = PhotoRecord(
                    model=model,
                    color_id=cid,
                    title=title,
                    description=clean_text(a.get_text(" ", strip=True)) or title,
                    page_url=href,
                    face_url=face,
                    profile_url=profile,
                )

    result = list(records.values())
    result.sort(key=lambda r: (r.title, int(r.color_id) if r.color_id.isdigit() else r.color_id))
    log(f"[MODÈLE] {model}: {len(result)} coloris")
    if not result:
        raise RuntimeError(f"Aucun coloris détecté pour {model}: {page_url}")
    return result


def extension_for(url: str) -> str:
    match = IMAGE_EXT_RE.search(urlparse(url).path)
    ext = "." + match.group(1).lower() if match else ".jpg"
    return ".jpg" if ext == ".jpeg" else ext


def validate_image(data: bytes) -> tuple[int, int, str]:
    from io import BytesIO

    with Image.open(BytesIO(data)) as image:
        image.load()
        width, height = image.size
        fmt = (image.format or "").upper()
    if width < 400 or height < 200:
        raise RuntimeError(f"image anormalement petite: {width}x{height}")
    return width, height, fmt


def download_photo(job: tuple[int, str, str, Path]) -> tuple[int, str, str, str, str]:
    index, view, url, destination = job
    data = get_bytes(url, timeout=120, attempts=7)
    width, height, _fmt = validate_image(data)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.write_bytes(data)
    os.replace(temporary, destination)
    sha = hashlib.sha256(data).hexdigest()
    return index, view, str(destination), sha, f"{width}x{height}"


def write_manifest(records: list[PhotoRecord]) -> None:
    fields = [
        "modele", "identifiant_couleur", "reference", "description", "page_source",
        "photo_face", "photo_profil", "url_face", "url_profil",
        "dimensions_face", "dimensions_profil", "sha256_face", "sha256_profil",
        "statut", "erreur",
    ]
    with MANIFEST_PATH.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter=";")
        writer.writeheader()
        for record in records:
            writer.writerow({
                "modele": record.model,
                "identifiant_couleur": record.color_id,
                "reference": record.title,
                "description": record.description,
                "page_source": record.page_url,
                "photo_face": record.face_file,
                "photo_profil": record.profile_file,
                "url_face": record.face_url,
                "url_profil": record.profile_url,
                "dimensions_face": record.face_dimensions,
                "dimensions_profil": record.profile_dimensions,
                "sha256_face": record.face_sha256,
                "sha256_profil": record.profile_sha256,
                "statut": record.status,
                "erreur": record.error,
            })


def make_zip() -> None:
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for path in sorted(OUT_ROOT.rglob("*")):
            if path.is_file():
                archive.write(path, path.as_posix())
    log(f"[ZIP] {ZIP_PATH} — {ZIP_PATH.stat().st_size / (1024 ** 2):.1f} Mo")


def main() -> int:
    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    OUT_ROOT.mkdir(parents=True)

    models = discover_model_pages()
    records: list[PhotoRecord] = []
    parse_errors: list[str] = []

    for position, (model, page_url) in enumerate(models, start=1):
        try:
            records.extend(parse_model_page(model, page_url))
        except Exception as exc:
            message = f"{model} | {page_url} | {exc}"
            parse_errors.append(message)
            log(f"[ERREUR MODÈLE {position}/{len(models)}] {message}")

    # Déduplication stricte par identifiant de sous-référence.
    dedup: dict[str, PhotoRecord] = {}
    duplicate_errors: list[str] = []
    for record in records:
        if record.color_id in dedup:
            previous = dedup[record.color_id]
            if previous.face_url != record.face_url or previous.profile_url != record.profile_url:
                duplicate_errors.append(
                    f"Sous-référence {record.color_id} dupliquée: {previous.model} / {record.model}"
                )
        else:
            dedup[record.color_id] = record
    records = list(dedup.values())
    records.sort(key=lambda r: (r.model, r.title, r.color_id))

    log(f"[TOTAL] {len(models)} modèles, {len(records)} coloris, {len(records) * 2} photos attendues.")
    if len(records) < 850:
        parse_errors.append(f"Nombre de coloris trop faible: {len(records)}")

    jobs: list[tuple[int, str, str, Path]] = []
    for index, record in enumerate(records):
        folder = OUT_ROOT / safe_name(record.model)
        stem = f"{safe_name(record.title, 85)}_{record.color_id}"
        face_path = folder / f"{stem}_FACE{extension_for(record.face_url)}"
        profile_path = folder / f"{stem}_PROFIL{extension_for(record.profile_url)}"
        jobs.append((index, "face", record.face_url, face_path))
        jobs.append((index, "profile", record.profile_url, profile_path))

    failures: list[str] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        future_map = {pool.submit(download_photo, job): job for job in jobs}
        for future in as_completed(future_map):
            job = future_map[future]
            index, view, url, _path = job
            try:
                result_index, result_view, file_path, sha, dimensions = future.result()
                record = records[result_index]
                relative = Path(file_path).as_posix()
                if result_view == "face":
                    record.face_file = relative
                    record.face_sha256 = sha
                    record.face_dimensions = dimensions
                else:
                    record.profile_file = relative
                    record.profile_sha256 = sha
                    record.profile_dimensions = dimensions
                completed += 1
                if completed % 100 == 0 or completed == len(jobs):
                    log(f"[PHOTOS] {completed}/{len(jobs)} téléchargées")
            except Exception as exc:
                message = f"{records[index].model} | {records[index].title} | {view} | {url} | {exc}"
                failures.append(message)
                log(f"[ERREUR PHOTO] {message}")

    for record in records:
        missing = []
        if not record.face_file:
            missing.append("FACE")
        if not record.profile_file:
            missing.append("PROFIL")
        if missing:
            record.status = "INCOMPLET"
            record.error = "Photo(s) manquante(s): " + ", ".join(missing)
        else:
            record.status = "OK"

    all_errors = parse_errors + duplicate_errors + failures
    if all_errors:
        ERROR_PATH.write_text("\n".join(all_errors) + "\n", encoding="utf-8")

    write_manifest(records)

    ok_colors = sum(record.status == "OK" for record in records)
    image_files = [p for p in OUT_ROOT.rglob("*") if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    total_bytes = sum(p.stat().st_size for p in image_files)
    summary = (
        "AFM OPTIC — MARYLL FRANCE — OPTIQUES\n"
        "=======================================\n\n"
        f"Page analysée : {START_URL}\n"
        f"Modèles détectés : {len(models)}\n"
        f"Coloris détectés : {len(records)}\n"
        f"Coloris complets (face + profil) : {ok_colors}\n"
        f"Photos attendues : {len(records) * 2}\n"
        f"Photos réellement présentes : {len(image_files)}\n"
        f"Volume des photos : {total_bytes / (1024 ** 2):.1f} Mo\n"
        f"Erreurs : {len(all_errors)}\n\n"
        "La vue FACE provient du fichier original /photos/ de chaque sous-référence.\n"
        "La vue PROFIL provient de la vignette haute définition /vignettes/ associée au même coloris.\n"
    )
    SUMMARY_PATH.write_text(summary, encoding="utf-8")
    log("\n" + summary)
    make_zip()

    if parse_errors or failures or ok_colors != len(records) or len(image_files) != len(records) * 2:
        log("[ÉCHEC] L'archive est incomplète. Voir ERREURS.txt.")
        return 2

    log("[SUCCÈS] ZIP complet contrôlé.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
