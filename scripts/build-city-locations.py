"""Build the offline city lookup from public-domain US Census Gazetteer data."""
import csv
import io
import json
from pathlib import Path
import urllib.request
import zipfile

SOURCE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip"
with urllib.request.urlopen(SOURCE, timeout=60) as response:
    archive = zipfile.ZipFile(io.BytesIO(response.read()))
with archive.open(archive.namelist()[0]) as raw:
    rows = list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"), delimiter="|"))
places = [[row["USPS"], row["NAME"], float(row["INTPTLAT"]), float(row[next(key for key in row if key.strip() == "INTPTLONG")])] for row in rows]
target = Path(__file__).resolve().parents[1] / "src/server/data/us-places.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Wrote {len(places)} places ({target.stat().st_size} bytes)")
