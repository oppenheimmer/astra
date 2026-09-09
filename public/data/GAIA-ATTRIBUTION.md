# Gaia DR3 data used by Starmap

This work has made use of data from the European Space Agency (ESA) mission [Gaia](https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium ([DPAC](https://www.cosmos.esa.int/web/gaia/dpac/consortium)). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.

- [Gaia DR3 credit and citation instructions](https://gea.esac.esa.int/archive/documentation/GDR3/Miscellaneous/sec_credit_and_citation_instructions/)
- [Gaia DR3 acknowledgements](https://gea.esac.esa.int/archive/documentation/GDR3/Miscellaneous/sec_acknowl/)
- Gaia Collaboration et al. (2016), *The Gaia mission*, [A&A 595, A1](https://doi.org/10.1051/0004-6361/201629272).
- Gaia Collaboration et al. (2023), *Gaia Data Release 3: Summary of the content and survey properties*, [A&A 674, A1](https://doi.org/10.1051/0004-6361/202243940).
- [Gaia DR3 main catalogue data model](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html)

Starmap requests bounded cone searches from [ARI Heidelberg's Gaia service](https://gaia.ari.uni-heidelberg.de/), an [official Gaia partner data centre](https://www.cosmos.esa.int/web/gaia/dr3), with the ESA Gaia Archive as a fallback. Both use `gaiadr3.gaia_source` and its `hipparcos2_best_neighbour` cross-match. It uses source IDs, ICRS coordinates, reference epoch, proper motions, G-band apparent magnitudes, parallax and parallax signal-to-noise. Source IDs remain strings to preserve all 64 bits.

The bundled whole-sky overview contains 140,763 Gaia DR3 sources at 7.5 < G ≤ 9, extracted on 7 September 2026 by `scripts/build_gaia_overview.py` using those same tables. Compact rows preserve source IDs, Hipparcos cross-matches, positions, epoch, G magnitudes, proper motions and qualifying distance estimates. Stored RA is rounded to 8 decimals in hours, declination to 7 decimals in degrees, G to 3 decimals, and proper motions to 4 decimals in mas/year. At wide zoom, the brightest source per equal-area ICRS cell is used to reduce overlaps; at fields ≤20°, this density thinning is removed. The UI labels the overview limit and simplification.

Gaia G is a broad photometric band and is not interchangeable with visual V magnitude. The app supplements its HYG bright-star sample with Gaia sources at 7.5 < G ≤ 14, and labels that distinction. A field contains at most the brightest 6,000 Gaia entries, with a notice when truncated. This is a visual observing chart, not a scientifically complete or homogeneous catalogue. Missing values remain unknown.

Distances are rough inverse parallaxes, only shown for positive parallaxes with signal-to-noise ≥10; parallax zero-point corrections, Bayesian distance inference and perspective acceleration are not included. Gaia reference-epoch proper motions are applied to the observing year. Spatial neighbourhoods show the available loaded sample, not a complete census.
