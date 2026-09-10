# City locations

`us-places.json` is generated from the public-domain [2025 US Census National Places Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html).

Run `python scripts/build-city-locations.py` from the repository root to rebuild it. Each record contains state abbreviation, Census place name, latitude, and longitude. No applicant data is sent to a geocoding service.

Mileage is rounded great-circle (straight-line) distance from the place's representative point to downtown San Francisco (37.7749, -122.4194). San Francisco itself is zero miles. This is an estimate, not driving mileage. Unknown or ambiguous places return no mileage; they do not prevent submission. No location is inferred for older records.
