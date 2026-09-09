# Earth map

Satellite ground-track land outlines use Natural Earth 1:110m physical land polygons.

- Source: https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/
- Repository: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
- Terms: https://www.naturalearthdata.com/about/terms-of-use/ — public domain.

`scripts/build_earth_land.py` projects the polygons to the same longitude/latitude grid as the satellite track, rounding chart coordinates to 0.01 SVG units. The small map uses an equirectangular projection; it shows geographic position, not the satellite's altitude above Earth.
