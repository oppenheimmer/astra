import type { Satellite } from "./types";

interface Mission {
  label: string;
  fact: string;
  source: string;
}
// Match documented missions by NORAD number. A missing role is not evidence of a classified mission.
const missions: Record<string, Mission> = {
  "25544": {
    label: "Space station",
    fact: "The International Space Station is a crewed orbital laboratory for research in microgravity.",
    source:
      "https://www.nasa.gov/international-space-station/space-station-research-and-technology/",
  },
  "48274": {
    label: "Space station",
    fact: "Tianhe is the core module of China’s Tiangong space station.",
    source: "https://en.cmse.gov.cn/missions/CMTH/",
  },
  "20580": {
    label: "Space telescope",
    fact: "The Hubble Space Telescope observes the universe from above Earth’s atmosphere.",
    source: "https://science.nasa.gov/mission/hubble/overview/about-hubble/",
  },
  "57800": {
    label: "X-ray observatory",
    fact: "XRISM studies hot gas and energetic objects through X-ray imaging and spectroscopy.",
    source: "https://science.nasa.gov/mission/xrism/spacecraft/",
  },
  "59588": {
    label: "Technology demonstrator",
    fact: "NASA’s ACS3 mission tests a deployable solar sail and lightweight composite support booms.",
    source: "https://www.nasa.gov/mission/acs3/",
  },
  "25994": {
    label: "Earth observation",
    fact: "Terra was designed to study Earth’s land, oceans and atmosphere as a connected system.",
    source: "https://science.nasa.gov/mission/terra/",
  },
  "27424": {
    label: "Earth observation",
    fact: "Aqua was designed to study Earth’s water cycle and related changes in the climate system.",
    source: "https://science.nasa.gov/mission/aqua/",
  },
  "27386": {
    label: "Earth observation",
    fact: "Envisat was an ESA environmental-observation mission. Its mission ended in 2012, but the spacecraft remains an orbital object.",
    source:
      "https://www.esa.int/Applications/Observing_the_Earth/Envisat/Mission_overview",
  },
  "28931": {
    label: "Earth observation",
    fact: "ALOS, also known as Daichi, was designed for land observation and mapping.",
    source: "https://global.jaxa.jp/activity/pr/brochure/files/sat01.pdf",
  },
  "39766": {
    label: "Radar Earth observation",
    fact: "ALOS-2, or Daichi-2, uses radar observations for mapping, disaster monitoring and environmental research.",
    source: "https://global.jaxa.jp/press/alos2/",
  },
  "16908": {
    label: "Geodetic satellite",
    fact: "Ajisai is a passive laser-ranging satellite used to measure Earth’s shape and support precise geodesy.",
    source: "https://global.jaxa.jp/projects/sat/egs/topics.html",
  },
};
const communications: Mission = {
  label: "Communications satellite",
  fact: "An AST SpaceMobile satellite designed to provide cellular broadband links directly to ordinary mobile phones.",
  source: "https://ast-science.com/spacemobile-network/",
};
export const satelliteCatalogueSource =
  "https://celestrak.org/satcat/satcat-format.php";
export const ownerNames: Record<string, string> = {
  US: "United States",
  PRC: "China",
  CIS: "CIS / former USSR",
  JPN: "Japan",
  ISS: "International Space Station",
  ESA: "European Space Agency",
  FR: "France",
  IT: "Italy",
  ARGN: "Argentina",
  CA: "Canada",
  IND: "India",
};
export function describeSatellite(satellite: Satellite): Mission {
  if (satellite.metadata?.objectType === "R/B")
    return {
      label: "Rocket body",
      fact: "A rocket stage remaining in Earth orbit. It is tracked separately from the spacecraft it launched.",
      source: satelliteCatalogueSource,
    };
  if (satellite.metadata?.objectType === "DEB")
    return {
      label: "Space debris",
      fact: "A fragment or discarded object in Earth orbit, rather than a complete spacecraft.",
      source: satelliteCatalogueSource,
    };
  const mission = missions[String(satellite.elements.NORAD_CAT_ID)];
  if (mission) return mission;
  if (/^STARLINK-\d+$/.test(satellite.name))
    return {
      label: "Communications satellite / Starlink",
      fact: "A SpaceX Starlink spacecraft providing satellite internet from low Earth orbit.",
      source: "https://www.starlink.com/technology",
    };
  if (
    satellite.metadata?.objectType === "PAY" &&
    /^SPACEMOBILE-\d+$/.test(satellite.name)
  )
    return communications;
  if (satellite.metadata?.objectType === "PAY")
    return {
      label: "Satellite / payload",
      fact: "A catalogued spacecraft or payload. Its specific mission has not been identified in this app.",
      source: satelliteCatalogueSource,
    };
  return {
    label: "Type not catalogued",
    fact: "No reliable object classification is available in the loaded catalogue.",
    source: satelliteCatalogueSource,
  };
}
