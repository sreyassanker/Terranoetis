Here are the 20 military-advanced gaps and their researched solutions across 100+ sources:
1. MIL-STD-2525 / APP-6 Tactical Symbology (Full)
Gap: Current milsymbol@3.0.4 renders basic point icons only. No affiliation frames (friend/foe/hostile/neutral), no echelon modifiers, no status, no tactical graphics (boundaries, zones, obstacles, routes).
Solutions:
- spatialillusions/milsymbol (https://github.com/spatialillusions/milsymbol) — upgrade to latest for full SIDC support
- missioncommand/mil-sym-ts (https://github.com/missioncommand/mil-sym-ts) — official US Army TypeScript lib, renders full 2525D/APP-6D with multi-point tactical graphics
- missioncommand/emp3-web (https://github.com/missioncommand/emp3-web) — Map SDK over CesiumJS with built-in MIL-STD-2525 drawing/editing
- spatialillusions/vmf-parser (https://github.com/spatialillusions/vmf-parser) — parse VMF tactical messages into symbols
- orbat-mapper/convert-symbology (https://github.com/orbat-mapper/convert-symbology) — convert between 2525C and 2525D standards
2. Blue Force Tracking (BFT)
Gap: No BFT data ingest. No position reporting format (NFFI, CoT), no friendly unit tracking, no combat ID, no IFF integration.
Solutions:
- snstac/pytak (https://github.com/snstac/pytak) — Python CoT client/server library for ingesting BFT positions
- FreeTAKServer (https://github.com/FreeTAKTeam/FreeTakServer) — open TAK server handling CoT routing, federation, REST API
- aiscot / adsbcot (https://github.com/ampledata/aiscot) — reference gateways converting AIS/ADS-B → CoT PLI messages
- NFFI STANAG 5527 (https://knogin.com/en/developers/nato-nffi-stanag5527-friendly-force) — NATO Friendly Force Information format reference
- CoT Developer Guide (MITRE) (https://nps.edu/documents/104517539/109705106/COT+Developer+Guide.pdf) — definitive spec for Cursor on Target protocol
3. Common Operational Picture (COP) / C2
Gap: No shared SA framework, no OPORD/FRAGO/WARNORD, no CCIR management, no multi-echelon COP fusion.
Solutions:
- psmitty7373/cop (https://github.com/psmitty7373/cop) — web-based collaborative COP with real-time diagramming, event tracking, OPNotes
- tkuester/taky (https://github.com/tkuester/taky) — lightweight TAK server for CoT/chat/data package distribution
- JC3IEDM STANAG 5525 (https://en.wikipedia.org/wiki/JC3IEDM) — NATO C2 data model for COP alignment
- OpenC2SIM (https://openc2sim.github.io/) — C2-to-Sim interoperability with MSDL/C-BML schemas for OPORD/FRAGO
- orbat-mapper/msdllib (https://github.com/orbat-mapper/msdllib) — TypeScript parser for MSDL (Military Scenario Definition Language)
4. Order of Battle (ORBAT)
Gap: No force laydown, no unit hierarchy (corps→div→bde→bn), no readiness reporting (REDCON), no TO&E.
Solutions:
- orbat-mapper/orbat-mapper (https://github.com/orbat-mapper/orbat-mapper) — full web app for building ORBATs with hierarchical structures, timeline, MSDL/GeoJSON import
- Spatial Illusions Unit Generator (https://spatialillusions.com/unitgenerator/) — web tool for unit symbols & ORBAT JSON export
- olimolly/orbat (https://github.com/olimolly/orbat) — drag-and-drop ORBAT editor with 3-level hierarchy, SVG symbols, JSON I/O
- DST ViPA ORBAT Data Model (https://www.dst.defence.gov.au/sites/default/files/publications/documents/DST-Group-TN-1539.pdf) — Australian Defence paper defining ORBAT data model (strength, equipment, REDCON)
- DATE Force Structures (https://odin.tradoc.army.mil/DATEWORLD) — US Army training environment with published battalion-level ORBATs
5. Targeting / Fires (F2T2EA)
Gap: No target nomination/thumbing workflow, no weaponeering, no BDA, no joint targeting cycle support.
Solutions:
- Weaponeering Paper (arXiv) (https://arxiv.org/pdf/2503.09475) — WEZ algorithms for threat-aware weaponeering with moving targets
- JBanks/weapon_targeting (https://github.com/JBanks/weapon_targeting) — Python simulator for Joint Fire Automation with targeting algorithms
- F2T2EA Kill Chain Reference (https://www.thelightningpress.com/c-uas-kill-chain-f2t2ea/) — doctrinal reference covering Find→Fix→Track→Target→Engage→Assess
- OpenDDS (https://github.com/OpenDDS/OpenDDS) — DDS pub-sub for distributing target tracks and fire missions in real-time
- JTCG/ME Report (https://www.dote.osd.mil/Portals/97/pub/reports/FY2022/dotemanaged/2022jtcg-me1.pdf) — DOT&E report on DCiDE, JWS, DIEE weaponeering tools
6. Threat Evaluation & Weapon Assignment (TEWA)
Gap: No TEWA engine — no raid analysis, threat prioritization, weapon pairing, engagement zone management.
Solutions:
- SWARD Testbed (https://sourceforge.net/projects/sward/) — open Java testbed for benchmarking weapon allocation algorithms (MMR, GA, PSO)
- WeaponTargetAssignment (https://github.com/mtsznowak/WeaponTargetAssignment) — WTA algorithm implementations
- chaos-one (Iron Dome Sim) (https://github.com/EgorKhaklin/chaos-one) — browser air defense with 350ms WTA loop, multi-tier interceptors
- 3-D SMA TEWA Paper (https://doi.org/10.1057/s41274-016-0139-6) — Stable Marriage Algorithm for TEWA, 25% improvement in neutralization
- TEWA Framework Thesis (https://scholar.sun.ac.za/server/api/core/bitstreams/812770bb-6509-4f91-a6e9-8d596da78a5a/content) — comprehensive performance evaluation with MATLAB source
7. Air Defense / Missile Warning
Gap: No ballistic missile trajectory prediction, no impact point estimation, no IAMD framework, only basic oref_alerts.
Solutions:
- Thrusty Ballistic Simulator (https://github.com/armscontrolwonk/GUI-Flyout-Implementation) — 3-DOF trajectory simulator validated against Scud-B/No-dong
- ballistic-simulator (C) (https://github.com/piotrrsawicki/ballistic-simulator) — high-fidelity C simulator with RK8PD, J2, EGM2008, NRLMSISE-00
- IAMD Simulation (HTML/JS) (https://gist.github.com/definitelynotguru/643419e53020d70973ba8b734dc16570) — full IAMD with tiered defense, Kalman filtering, ballistic/cruise/hypersonic threats
- THAAD Simulation (https://github.com/YehiaGewily/THAAD-Simulation) — 3D kinematic THAAD with Kalman-filtered PIP computation
- OpenBallistics (https://github.com/YudoTLE/openballistics) — header-only C++ lib with Python bindings for projectile trajectory and intercept
8. Mission Planning / Route Planning
Gap: No military route optimization with threat avoidance, no ATO generation, no no-fly zones, no low-level flight planning.
Solutions:
- convoy-or (https://github.com/cognis-digital/convoy-or) — military convoy routing with threat-cost overlays, OR-Tools, GeoJSON export
- IFPV Mission Planning (https://github.com/zhigao3ks/IFPV) — adversarial cognitive simulation with trajectory planning, 19.4% mission success improvement
- Larp Risk Field Planning (https://github.com/wzjoriv/Larp) — quadtree route planning with GeoJSON repulsion fields for threat zones
- ethz-asl/terrain-navigation (https://github.com/ethz-asl/terrain-navigation) — safe low-altitude fixed-wing terrain following with RRT* in Dubins space
- flight_guard_ai_aria_agent (https://github.com/comsompom/flight_guard_ai_aria_agent) — military AI mission planner with multi-agent orchestration, human-in-the-loop
9. Tactical Data Links (Link 16, JREAP, VMF)
Gap: Zero data link support — no Link-16 J-series parsing, no VMF K-series, no JREAP gateway.
Solutions:
- Ersatz MIL-STD-6016 (https://github.com/liotier/Ersatz-MIL-STD-6016) — reconstructed Link 16 J-series message schema (78 message types, 23 NPGs)
- Link16_JTIDS (https://github.com/shaohua0720/Link16_JTIDS) — full Link 16 implementation with Reed-Solomon, AES, USRP hardware interface
- spatialillusions/vmf-parser (https://github.com/spatialillusions/vmf-parser) — pure JS parser for VMF (MIL-STD-6017, MIL-STD-2045)
- Vmfcat CLI (https://github.com/victoriousian/Vmfcat) — command-line VMF message generation for firesupport/airops/airdef
- simple_tdl (Wireshark) (https://github.com/ph6564/simple_tdl) — Wireshark decoder for tactical data link protocols
10. Electronic Warfare / SIGINT
Gap: Only gps_jamming layer exists. No EOB, no TDOA/FDOA geolocation, no EW battle management, no spectrum deconfliction.
Solutions:
- emitter-detection-python (https://github.com/nodonoughue/emitter-detection-python) — complete TDOA/FDOA/AOA geolocation algorithms (pip install ewgeo)
- SpectralEye (https://github.com/njavro/SpectralEye) — EW C2 with NVIDIA Sionna RT ray-traced RF propagation, CesiumJS visualization
- ew-tactical-map-system (https://github.com/FelipeKreulich/ew-tactical-map-system) — real-time EW tactical map with FSPL propagation, RSS multilateration, RTL-SDR
- Specter EW Planning (https://github.com/XJabor/specter-ew) — tactical EW planner with ITU-R P.526 diffraction, J/S margin jamming analysis
- ATAKRR (https://github.com/jack-driscoll/atakrr) — ATAK plugin for passive spectrum monitoring, AMC, RF fingerprinting, triangulation
- OpenWar Intelligence (https://openwarintelligence.org/) — open C4ISR dashboard with A2/AD, GPS jamming, EW platform mapping
11. ISR (Intelligence, Surveillance, Reconnaissance)
Gap: No ISR tasking cycle (PED), no collection plan management, no sensor cueing, no automated target recognition.
Solutions:
- VIAME (Kitware) (https://github.com/Kitware/VIAME) — video/image analytics for object detection/tracking supporting WAMI pipelines
- GrokSAR (https://github.com/GrokCV/GrokSAR) — open SAR target detection toolbox with DenoDet models
- NIZAM COP (C-UAS) (https://github.com/altunbulakemre75/nizam-agent-c2) — real-time C2 with multi-sensor fusion (YOLO+Kalman IMM), CesiumJS
- GRDL (GEOINT R&D Library) (https://github.com/GEOINT/grdl) — modular Python for SAR/EO geospatial intelligence with CFAR detectors
- jMISB (https://github.com/WestRidgeSystems/jmisb) — Java implementation of MISB motion imagery metadata (STANAG 4609)
- FOCUS PED Simulation (DTIC) (https://dsiac.dtic.mil/articles/modeling-intelligence-ped-with-focus-a-tactical-level-isr-simulation/) — tactical ISR PED process simulation
12. Maritime Domain Awareness (MDA)
Gap: AIS tracking exists but no vessel behavior analytics, no dark ship detection, no EEZ alerts, no pattern-of-life.
Solutions:
- Open Maritime Anomaly Detection (https://github.com/snudial/open-maritime-anomaly-detection) — LLM-grounded AIS anomaly generation with route slicing
- GeoTrackNet (https://github.com/CIA-Oceanix/GeoTrackNet) — probabilistic neural network + a contrario detection for maritime anomalies
- DarkVesselNet (https://github.com/arunshar/darkvessel-stack) — Sentinel-1 SAR + Sentinel-2 + AIS fused through Prithvi-2 foundation model
- Ghost Hunter (https://github.com/sahiti3636/Ghost-hunter-main) — dark vessel detection with SAR+CNN+AIS silence verification
- Shadow Fleet AIS Detection (https://github.com/Anton-Geo/shadow-fleet-ais-detection) — streaming pipeline for Going Dark, Loitering, Draft Changes, DFSI index
- Thalweg (https://github.com/deringeorge-nebula/thalweg) — real-time maritime intel: 40K+ vessels, dark fleet, sanctions monitoring
13. Nuclear / WMD Monitoring
Gap: Zero nuclear detection. No CTBT/IMS data, no fallout modeling, no WMD dispersion assessment.
Solutions:
- PyVDMS (https://github.com/psmsmets/PyVDMS) — Python client for CTBTO IMS data and IDC products (nuclear test-ban verification)
- FLEXPART (https://github.com/flexpart/flexpart) — gold-standard Lagrangian dispersion model for radionuclide transport
- NuclearDetonation.jl (https://github.com/Msturroc/NuclearDetonation.jl) — Julia package coupling Glasstone weapon effects + Lagrangian dispersion
- ATP45.jl (https://github.com/tcarion/ATP45.jl) — NATO ATP-45 hazard prediction for CBRN incidents
- glasstone (Python) (https://github.com/GOFAI/glasstone) — nuclear weapons effects models (blast, thermal, radiation)
- NukeMap (https://github.com/SysAdminDoc/NukeMap) — browser-based nuclear effects simulator with 38 presets, casualty estimation
- CTBTO vDEC (https://www.ctbto.org/resources/for-researchers-experts/vdec) — virtual Data Exploitation Centre for IMS data access
14. Collateral Damage Estimation (CDE)
Gap: No CDE methodology. No weaponeering effects modeling, no no-strike list management, no CIVCAS assessment.
Solutions:
- BlastFoam (https://github.com/synthetik-technologies/blastfoam) — OpenFOAM CFD solver for HE detonation, airblast, explosive safety
- Balistic (https://github.com/InsaneInfinity/Balistic) — CesiumJS simulator with SRTM terrain masking, blast zones, 195 weapon DB
- CasEx (https://github.com/andresla/CasEx) — Python JARUS SORA casualty expectation models (explosion, ballistic descent)
- ConWep (USACE PDC) (https://www.nwo.usace.army.mil/About/Centers-of-Expertise/Protective-Design-Center/PDC-Software/) — conventional weapons effects (TM 5-855-1) airblast/fragment/breach
- CJCSI 3160.01 (https://www.justsecurity.org/wp-content/uploads/2017/04/Collateral-Damage-Estimation-Methodology-CJCSI.pdf) — official CDM policy: all 5 CDE levels, CER tables, no-strike methodology
- CDE AI Assessment (arXiv) (https://arxiv.org/html/2510.20337) — novel AI CDE model with temporal/spatial/force KRR architecture
15. Cyber Operations / EW Convergence
Gap: cyber_threats layer exists (AlienVault OTX). No CNO framework, no cyber kill chain, no ELINT/CYBER convergence.
Solutions:
- AttackFlow (https://github.com/Pr0cella/AttackFlow) — interactive cyber kill chain editor mapping ATT&CK/CAPEC/STIX 2.1
- MITRE ATT&CK Navigator (https://github.com/mitre-attack/attack-navigator) — official tool for visualizing defensive coverage and threat mapping
- ThreatMapper (https://github.com/anpa1200/threatmapper) — AI threat intel: LLM-based ATT&CK extraction, APT comparison (174+ groups)
- ARIADNE (https://github.com/Su1ph3r/ariadne) — AI attack path synthesizer ingesting 45+ security tools to knowledge graphs
- IntelOwl (https://github.com/intelowlproject/intelowl) — threat intel management with 100+ analyzers (VT, YARA, CAPA, OTX)
- iNTERCEPT (https://github.com/smittix/intercept) — unified SIGINT platform: SDR-based ADS-B/AIS/ACARS/drone ID
- Beelzebub (https://github.com/beelzebub-labs/beelzebub) — LLM-powered deception runtime with adaptive honeypots, MITRE TTP capture
16. Decision Support & Wargaming
Gap: No COA comparison, no wargaming/adjudication, no red/blue teaming, no predictive maneuver analysis.
Solutions:
- Panopticon (https://github.com/Panopticon-AI-team/panopticon) — wargaming platform with multi-agent RL, TypeScript/React, red/blue simulation
- Sandkasten (https://github.com/lerugray/sandkasten) — open wargame with NATO symbology, radar detection, fog of war, MapLibre GL JS
- COA Engine (NATO DIANA) (https://github.com/mipelin/coa-engine) — AI-assisted COA analysis with tick simulation, ROE-constrained ranking
- Tactical-Matrix-Console (https://github.com/endend2003-cmd/Tactical-Matrix-Console) — 3D tactical simulation with PyTorch, LLM, Three.js decision support
- SAGA Wargames (OpenAI) (https://fablestudio.github.io/openai-wargames) — multi-agent LLM wargaming with automated red/blue teaming
17. After Action Review (AAR) / Playback
Gap: No time-replay of ops, no CZML playback, no synchronized multi-stream debrief.
Solutions:
- CZML Guide (Cesium) (https://github.com/CesiumGS/cesium/wiki/CZML-Guide) — native JSON format for time-dynamic scenes with interpolation
- czml3 (Python) (https://pypi.org/project/czml3/) — type-checked CZML generation for mission playback
- Cesium Time Dynamic Stories (https://cesium.com/learn/ion/stories-time-dynamic/) — playback speed control, camera following, synchronized multi-layer replay
- TacticalShift AAR (https://github.com/TacticalShift/aar) — Arma 3 AAR viewer demonstrating tactical debrief workflow
- CZML Generator (https://github.com/lis-aw/CZML-Generator) — time-based orbital/vehicle position interpolation patterns
18. Force Protection / Base Defense
Gap: Only point locations. No base defense zones, no IED/MIED analysis, no C-UAS, no perimeter surveillance.
Solutions:
- Empyrean C-UAS Architecture (https://empyreandefense.com/insights/recipes/counter-uas-force-protection) — reference C-UAS force protection combining COP, EMSO, MIL-STD-2525
- UNIFY.C2 C-UAS Platform (https://www.prnewswire.com/news-releases/unifyc2-selected-to-deliver-integrated-counter-uas-common-operating-picture-at-beale-air-force-base-302804358.html) — open C-UAS COP with multi-sensor fusion
- DRAIDIS Convoy Protection (https://www.tacticaledgeai.com/draidis/use-cases/convoy-route-protection) — AI threat assessment fusing IED history, terrain, sensor anomalies
- US Army FM 7-0 IED Mitigation (https://www.trngcmd.marines.mil/Portals/207/Docs/FMTBE/Student%20Materials/FMSO%20Manual/211.pdf) — doctrinal route analysis and VP/VA identification manual
19. GEOINT Advanced Analytics
Gap: Existing satellite imagery layers (MODIS/VIIRS/Sentinel) but no automated change detection, no spectral unmixing, no target-specific geolocation.
Solutions:
- Open-CD (https://github.com/likyoo/open-cd) — most comprehensive change detection toolbox (866★), 30+ methods
- Awesome Remote Sensing Change Detection (https://github.com/wenhwu/awesome-remote-sensing-change-detection) — curated list of datasets/tools/methods
- Spectral Unmixing Toolbox (https://github.com/arthur-e/unmixing) — interactive LSMA for multispectral with endmember extraction
- SentinelChange-AI (https://github.com/intelav/SentinelChange-AI) — GPU change detection on Sentinel-2 with ChangeStar, SAM, ESRGAN
- satellite-image-deep-learning (https://github.com/satellite-image-deep-learning/techniques) — 10.2k★ guide covering change detection, segmentation, classification
- PySptools (https://pypi.org/project/pysptools/) — hyperspectral image processing: unmixing, endmember extraction, classification
20. HADR / Civil-Military Cooperation
Gap: No disaster response C2, no UN OCHA integration, no logistics distribution optimization, no camp planning.
Solutions:
- UN OCHA Digital Services (https://www.unocha.org/ocha-digital-services) — Humanitarian Insight, VOSOCC, ReliefWeb API, Key Figures API
- OCHA Key Figures API (https://keyfigures.api.unocha.org/) — real-time humanitarian funding and operational statistics
- Humanitarian Logistics Optimization (https://github.com/mishkajain/Humanitarian-Logistics-Optimization) — OR-Tools LP for multi-supply node disaster logistics
- Google OR-Tools (https://developers.google.com/optimization/) — open-source optimization suite for routing/scheduling/logistics
- Logistics Cluster (WFP) (https://logcluster.org/) — global coordination with data standards for relief logistics
- Humanitarian Response Portal (https://www.humanitarianresponse.info/) — UN OCHA info sharing platform for disaster response coordination
Cross-Cutting CesiumJS Integration Gems
Resource	URL	Description
tak-webview-cesium	https://github.com/sgofferj/tak-webview-cesium (https://github.com/sgofferj/tak-webview-cesium)	CesiumJS viewer for TAK/CoT data with MIL-STD-2525
CommandVue	https://github.com/uraanai/CommandVue (https://github.com/uraanai/CommandVue)	Vue 3 + CesiumJS ops dashboard with MIL-STD-2525, WebSocket telemetry
WorldWideView	https://github.com/silvertakana/worldwideview (https://github.com/silvertakana/worldwideview)	Plugin-driven CesiumJS GEOINT engine
AMOS	https://github.com/merkuriddg/amos-autonomous_mission_orchestration_system (https://github.com/merkuriddg/amos-autonomous_mission_orchestration_system)	Multi-domain C2 with CesiumJS + Link-16/VMF/EW/SIGINT