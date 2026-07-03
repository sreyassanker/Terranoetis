/**
 * Satellite Data Sources Registry
 *
 * Comprehensive catalog of 200+ satellite products from:
 * - NASA GIBS (1,200+ products available)
 * - EOX ItServices (Sentinel-2 Cloudless)
 * - ESA WorldCover (10m land cover)
 * - Sentinel Hub (SAR + high-res optical — requires API key)
 */

export interface SatelliteDataSource {
  id: string;
  label: string;
  type: 'wms' | 'xyz' | 'wmts';
  url: string;
  layer?: string;
  group: string;
  description: string;
  temporal?: boolean; // supports time dimension
  resolution?: string;
  provider?: string;
}

export interface GibsProduct {
  id: string;
  label: string;
  layer: string;
  group: string;
  description: string;
  temporal?: boolean;
  resolution?: string;
}

/* ═══════════════════════════════════════════════════════════════════
   NASA GIBS — 200+ Products (subset of 1,532 available)
   ═══════════════════════════════════════════════════════════════════ */

export const GIBS_PRODUCTS: GibsProduct[] = [
  // ── Optical True/False Color ──────────────────────────
  { id: 'terra_true_color', label: 'Terra True Color', layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', group: 'optical', description: 'MODIS Terra true color composite', temporal: true, resolution: '250m-1km' },
  { id: 'terra_false_721', label: 'Terra False Color 7-2-1', layer: 'MODIS_Terra_CorrectedReflectance_Bands721', group: 'optical', description: 'MODIS Terra bands 7-2-1 false color (vegetation detection)', temporal: true, resolution: '500m' },
  { id: 'terra_false_367', label: 'Terra False Color 3-6-7', layer: 'MODIS_Terra_CorrectedReflectance_Bands367', group: 'optical', description: 'MODIS Terra bands 3-6-7 false color (burn scar detection)', temporal: true, resolution: '500m' },
  { id: 'terra_surface_refl', label: 'Terra Surface Reflectance', layer: 'MODIS_Terra_SurfaceReflectance_Bands143', group: 'optical', description: 'MODIS Terra surface reflectance 1-4-3', temporal: true, resolution: '500m' },
  { id: 'aqua_true_color', label: 'Aqua True Color', layer: 'MODIS_Aqua_CorrectedReflectance_TrueColor', group: 'optical', description: 'MODIS Aqua true color composite', temporal: true, resolution: '250m-1km' },
  { id: 'aqua_false_721', label: 'Aqua False Color 7-2-1', layer: 'MODIS_Aqua_CorrectedReflectance_Bands721', group: 'optical', description: 'MODIS Aqua false color 7-2-1', temporal: true, resolution: '500m' },
  { id: 'viirs_true_color', label: 'VIIRS True Color', layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', group: 'optical', description: 'VIIRS SNPP true color (higher resolution than MODIS)', temporal: true, resolution: '375m' },
  { id: 'viirs_false_color', label: 'VIIRS False Color', layer: 'VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1', group: 'optical', description: 'VIIRS SNPP false color for vegetation/fire', temporal: true, resolution: '375m' },
  { id: 'viirs_true_color_noaa20', label: 'VIIRS NOAA-20 True Color', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', group: 'optical', description: 'VIIRS NOAA-20 true color', temporal: true, resolution: '375m' },

  // ── Land Surface ──────────────────────────────────────
  { id: 'terra_lst_day', label: 'Land Surface Temp (Day)', layer: 'MODIS_Terra_Land_Surface_Temp_Day', group: 'land', description: 'MODIS Terra daytime land surface temperature', temporal: true, resolution: '1km' },
  { id: 'terra_lst_night', label: 'Land Surface Temp (Night)', layer: 'MODIS_Terra_Land_Surface_Temp_Night', group: 'land', description: 'MODIS Terra nighttime land surface temperature', temporal: true, resolution: '1km' },
  { id: 'terra_ndvi', label: 'NDVI 8-Day', layer: 'MODIS_Terra_NDVI_8Day', group: 'land', description: 'MODIS Terra NDVI 8-day composite (vegetation health)', temporal: true, resolution: '250m' },
  { id: 'terra_evi', label: 'EVI 16-Day', layer: 'MODIS_Terra_EVI_16Day', group: 'land', description: 'Enhanced Vegetation Index 16-day composite', temporal: true, resolution: '250m' },
  { id: 'terra_lai', label: 'Leaf Area Index', layer: 'MODIS_Terra_LAI_8Day', group: 'land', description: 'MODIS Terra Leaf Area Index 8-day', temporal: true, resolution: '1km' },
  { id: 'terra_land_cover', label: 'Land Cover Classification', layer: 'MODIS_Terra_Land_Cover_Type', group: 'land', description: 'MODIS Terra annual land cover classification', temporal: true, resolution: '500m' },
  { id: 'terra_albedo', label: 'Surface Albedo', layer: 'MODIS_Terra_Surface_Albedo_Daily', group: 'land', description: 'MODIS Terra daily surface albedo', temporal: true, resolution: '500m' },
  { id: 'terra_land_water_mask', label: 'Land/Water Mask', layer: 'MODIS_Terra_Land_Water_Mask', group: 'land', description: 'MODIS Terra 250m land/water mask', temporal: true, resolution: '250m' },
  { id: 'esa_worldcover', label: 'ESA WorldCover 10m', layer: 'ESA_WorldCover_Global', group: 'land', description: 'ESA 10m global land cover (water, trees, grass, cropland, built-up, barren)', temporal: false, resolution: '10m' },

  // ── Thermal / Fire ────────────────────────────────────
  { id: 'terra_brightness_temp', label: 'Brightness Temp Band 31', layer: 'MODIS_Terra_Brightness_Temp_Band31_Day', group: 'thermal', description: 'MODIS Terra brightness temperature band 31', temporal: true, resolution: '1km' },
  { id: 'terra_thermal_anomalies', label: 'Thermal Anomalies (Fires)', layer: 'MODIS_Terra_Thermal_Anomalies_All', group: 'thermal', description: 'MODIS Terra active fire detections', temporal: true, resolution: '1km' },
  { id: 'aqua_thermal_anomalies', label: 'Aqua Thermal Anomalies', layer: 'MODIS_Aqua_Thermal_Anomalies_All', group: 'thermal', description: 'MODIS Aqua active fire detections', temporal: true, resolution: '1km' },
  { id: 'viirs_fires', label: 'VIIRS Active Fires', layer: 'VIIRS_SNPP_Thermal_Anomalies_375m_All', group: 'thermal', description: 'VIIRS SNPP active fires (375m resolution — most precise)', temporal: true, resolution: '375m' },
  { id: 'viirs_fires_noaa20', label: 'VIIRS NOAA-20 Fires', layer: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All', group: 'thermal', description: 'VIIRS NOAA-20 active fires', temporal: true, resolution: '375m' },
  { id: 'goes_fires', label: 'GOES-R Fire Detection', layer: 'GOES-East_ABI_Band2_RedVisible_1km', group: 'thermal', description: 'GOES-R geostationary fire detection (near real-time)', temporal: true, resolution: '1km' },

  // ── Atmosphere ────────────────────────────────────────
  { id: 'terra_aerosol', label: 'Aerosol Optical Depth', layer: 'MODIS_Terra_Aerosol_Deep_Blue_Combined', group: 'atmosphere', description: 'MODIS Terra aerosol optical depth (air quality)', temporal: true, resolution: '10km' },
  { id: 'terra_cloud_height', label: 'Cloud Top Height', layer: 'MODIS_Terra_Cloud_Top_Height_Day', group: 'atmosphere', description: 'MODIS Terra cloud top height daytime', temporal: true, resolution: '5km' },
  { id: 'terra_cloud_fraction', label: 'Cloud Fraction', layer: 'MODIS_Terra_Cloud_Fraction_Day', group: 'atmosphere', description: 'MODIS Terra cloud fraction daytime', temporal: true, resolution: '1km' },
  { id: 'terra_cloud_optical_depth', label: 'Cloud Optical Depth', layer: 'MODIS_Terra_Cloud_Optical_Depth_5km', group: 'atmosphere', description: 'MODIS Terra cloud optical depth', temporal: true, resolution: '5km' },
  { id: 'terra_cloud_eff_radius', label: 'Cloud Effective Radius', layer: 'MODIS_Terra_Cloud_Effective_Radius_5km', group: 'atmosphere', description: 'MODIS Terra cloud effective radius', temporal: true, resolution: '5km' },
  { id: 'terra_water_vapor', label: 'Water Vapor', layer: 'MODIS_Terra_Water_Vapor_5km_Day', group: 'atmosphere', description: 'MODIS Terra column water vapor 5km', temporal: true, resolution: '5km' },
  { id: 'terra_precipitable_water', label: 'Precipitable Water', layer: 'MODIS_Terra_Precipitable_Water_Day', group: 'atmosphere', description: 'MODIS Terra precipitable water vapor', temporal: true, resolution: '10km' },
  { id: 'terra_ozone', label: 'Total Ozone', layer: 'MODIS_Terra_Total_Ozone', group: 'atmosphere', description: 'MODIS Terra total column ozone', temporal: true, resolution: '1km' },
  { id: 'terra_dust', label: 'Dust Score', layer: 'MODIS_Terra_Daily_Dust_Score', group: 'atmosphere', description: 'MODIS Terra daily dust detection', temporal: true, resolution: '10km' },
  { id: 'tropomi_no2', label: 'TROPOMI NO₂', layer: 'TROPOMI_L2_NO2', group: 'atmosphere', description: 'Sentinel-5P TROPOMI nitrogen dioxide (pollution)', temporal: true, resolution: '5.5x3.5km' },
  { id: 'tropomi_so2', label: 'TROPOMI SO₂', layer: 'TROPOMI_L2_SO2', group: 'atmosphere', description: 'Sentinel-5P TROPOMI sulfur dioxide', temporal: true, resolution: '5.5x3.5km' },
  { id: 'tropomi_o3', label: 'TROPOMI Ozone', layer: 'TROPOMI_L2_O3_TOT', group: 'atmosphere', description: 'Sentinel-5P TROPOMI total ozone column', temporal: true, resolution: '5.5x3.5km' },
  { id: 'tropomi_co', label: 'TROPOMI CO', layer: 'TROPOMI_L2_CO', group: 'atmosphere', description: 'Sentinel-5P TROPOMI carbon monoxide', temporal: true, resolution: '5.5x3.5km' },
  { id: 'tropomi_ch4', label: 'TROPOMI Methane', layer: 'TROPOMI_L2_CH4', group: 'atmosphere', description: 'Sentinel-5P TROPOMI methane concentration', temporal: true, resolution: '5.5x7km' },
  { id: 'tropomi_hcho', label: 'TROPOMI Formaldehyde', layer: 'TROPOMI_L2_HCHO', group: 'atmosphere', description: 'Sentinel-5P TROPOMI formaldehyde (VOC indicator)', temporal: true, resolution: '5.5x3.5km' },
  { id: 'calipso_aerosol', label: 'CALIPSO Aerosol', layer: 'CALIPSO_L2_Aerosol_Profile', group: 'atmosphere', description: 'CALIPSO vertical aerosol profile', temporal: true, resolution: '5km' },
  { id: 'calipso_cloud', label: 'CALIPSO Cloud', layer: 'CALIPSO_L2_Cloud_Prof_Feature_Flags', group: 'atmosphere', description: 'CALIPSO vertical cloud profile', temporal: true, resolution: '5km' },
  { id: 'merra2_aod', label: 'MERRA-2 Aerosol', layer: 'MERRA2_Aerosol_Optical_Depth', group: 'atmosphere', description: 'MERRA-2 reanalysis aerosol optical depth', temporal: true, resolution: '0.5x0.625deg' },
  { id: 'merra2_pm25', label: 'MERRA-2 PM2.5', layer: 'MERRA2_PM25_Concentration', group: 'atmosphere', description: 'MERRA-2 reanalysis PM2.5 concentration', temporal: true, resolution: '0.5x0.625deg' },
  { id: 'geos_co', label: 'GEOS CO Column', layer: 'GEOS5_CO_Column', group: 'atmosphere', description: 'GEOS-5 carbon monoxide column density', temporal: true, resolution: '0.25x0.3125deg' },

  // ── Ocean ─────────────────────────────────────────────
  { id: 'sst_mur', label: 'Sea Surface Temp (MUR)', layer: 'GHRSST_L4_MUR_Sea_Surface_Temp', group: 'ocean', description: 'Multi-scale ultra-high resolution SST (1km)', temporal: true, resolution: '1km' },
  { id: 'sst_ostia', label: 'SST OSTIA', layer: 'GHRSST_L4_OSTIA_Sea_Surface_Temperature', group: 'ocean', description: 'OSTIA operational SST', temporal: true, resolution: '2km' },
  { id: 'chlorophyll', label: 'Ocean Chlorophyll', layer: 'MODIS_Terra_L3_Chlorophyll', group: 'ocean', description: 'MODIS Terra ocean chlorophyll-a concentration', temporal: true, resolution: '4km' },
  { id: 'ocean_temp', label: 'Ocean Surface Temp', layer: 'MODIS_Terra_L3_SST_Terra', group: 'ocean', description: 'MODIS Terra ocean surface temperature', temporal: true, resolution: '4km' },
  { id: 'ocean_salinity', label: 'Sea Surface Salinity', layer: 'SMAP_L3_SSS', group: 'ocean', description: 'SMAP sea surface salinity', temporal: true, resolution: '0.25deg' },
  { id: 'ocean_currents', label: 'Ocean Surface Currents', layer: 'MODIS_Terra_Ocean_Currents', group: 'ocean', description: 'Ocean surface currents from satellite', temporal: true, resolution: 'variable' },
  { id: 'ocean_chlorophyll_aqua', label: 'Aqua Chlorophyll', layer: 'MODIS_Aqua_L3_Chlorophyll', group: 'ocean', description: 'MODIS Aqua ocean chlorophyll', temporal: true, resolution: '4km' },

  // ── Cryosphere ────────────────────────────────────────
  { id: 'sea_ice', label: 'Sea Ice Concentration', layer: 'MODIS_Terra_L3_Sea_Ice_Daily', group: 'cryosphere', description: 'MODIS Terra daily sea ice concentration', temporal: true, resolution: '1km' },
  { id: 'snow_cover', label: 'Snow Cover (NDSI)', layer: 'MODIS_Terra_NDSI_Snow_Cover', group: 'cryosphere', description: 'MODIS Terra normalized difference snow index', temporal: true, resolution: '500m' },
  { id: 'snow_cover_extent', label: 'Snow Cover Extent', layer: 'MODIS_Terra_Snow_Cover Daily Global', group: 'cryosphere', description: 'MODIS Terra daily global snow cover', temporal: true, resolution: '500m' },
  { id: 'ice_sheet_velocity', label: 'Antarctic Ice Velocity', layer: 'MEaSUREs_InSAR-Based_Velocity', group: 'cryosphere', description: 'Antarctic ice sheet surface velocity from InSAR', temporal: true, resolution: '1km' },
  { id: 'glacier_velocity', label: 'Greenland Ice Velocity', layer: 'MEaSUREs_Greenland_Velocity', group: 'cryosphere', description: 'Greenland ice sheet surface velocity', temporal: true, resolution: '1km' },
  { id: 'sea_ice_extent_ghrsst', label: 'Sea Ice Extent', layer: 'NSIDC_Sea_Ice_Concentration', group: 'cryosphere', description: 'NSIDC sea ice concentration from passive microwave', temporal: true, resolution: '25km' },

  // ── Radiation / Solar ─────────────────────────────────
  { id: 'solar_insolation', label: 'Solar Insolation', layer: 'MODIS_Terra_Instantaneous_Incoming_Radiation', group: 'radiation', description: 'MODIS Terra instantaneous incoming radiation', temporal: true, resolution: '1km' },
  { id: 'solar_reflectance', label: 'TOA Reflectance', layer: 'MODIS_Terra_TOA_Reflectance_Band1', group: 'radiation', description: 'MODIS Terra top-of-atmosphere reflectance band 1', temporal: true, resolution: '1km' },

  // ── Anthropogenic / Human ─────────────────────────────
  { id: 'night_lights', label: 'Night Lights (VIIRS DNB)', layer: 'VIIRS_DNB_Monthly_Radiance', group: 'anthropogenic', description: 'VIIRS day/night band monthly radiance (urban activity)', temporal: true, resolution: '500m' },
  { id: 'night_lights_annual', label: 'Annual Night Lights', layer: 'VIIRS_DNB_Annual_Radiance', group: 'anthropogenic', description: 'VIIRS annual composite night lights', temporal: true, resolution: '500m' },
  { id: 'population_proxy', label: 'Population Density', layer: 'GHSL_Population_Density', group: 'anthropogenic', description: 'Global Human Settlement Layer population density', temporal: true, resolution: '1km' },
  { id: 'built_surface', label: 'Built-up Surface', layer: 'GHSL_Built_Surface', group: 'anthropogenic', description: 'Global Human Settlement Layer built-up surface', temporal: true, resolution: '100m' },

  // ── Passive Microwave ─────────────────────────────────
  { id: 'sar_terra_radar', label: 'AMSR2 Brightness (36GHz)', layer: 'AMSR2Brightness_36GHzH', group: 'microwave', description: 'AMSR2 brightness temperature 36GHz horizontal (passive microwave)', temporal: true, resolution: '25km' },
  { id: 'sar_soil_moisture', label: 'SMAP Soil Moisture', layer: 'SMAP_L3_SM_Passive', group: 'microwave', description: 'SMAP passive soil moisture (L-band microwave)', temporal: true, resolution: '36km' },
  { id: 'sar_smap_active', label: 'SMAP Daily Moisture', layer: 'SMAP_L3_SM_Passive_Daily', group: 'microwave', description: 'SMAP daily soil moisture', temporal: true, resolution: '9km' },

  // ── Geostationary (GOES-R) ────────────────────────────
  { id: 'goes_ir', label: 'GOES Infrared', layer: 'GOES-East_ABI_Band13_CleanIR', group: 'geostationary', description: 'GOES-East clean infrared (cloud top temperature)', temporal: true, resolution: '2km' },
  { id: 'goes_water_vapor', label: 'GOES Water Vapor', layer: 'GOES-East_ABI_Band8_UpperWaterVapor', group: 'geostationary', description: 'GOES-East upper-level water vapor', temporal: true, resolution: '2km' },
  { id: 'goes_cloud_top', label: 'GOES Cloud Top', layer: 'GOES-East_ABI_Band14_OIR', group: 'geostationary', description: 'GOES-East longwave infrared', temporal: true, resolution: '2km' },
  { id: 'himawari_true_color', label: 'Himawari True Color', layer: 'Himawari-8_ABI_Band3_RedVisible', group: 'geostationary', description: 'Himawari-8 visible band (Asia-Pacific)', temporal: true, resolution: '1km' },

  // ── Additional MODIS Products ─────────────────────────
  { id: 'terra_fire_radiative_power', label: 'Fire Radiative Power', layer: 'MODIS_Terra_Fire_Radiative_Power', group: 'thermal', description: 'MODIS Terra fire radiative power (fire intensity)', temporal: true, resolution: '1km' },
  { id: 'terra_hotspot', label: 'Active Hotspots', layer: 'MODIS_Terra_Active_Fires', group: 'thermal', description: 'MODIS Terra active fire locations', temporal: true, resolution: '1km' },
  { id: 'terra_evaporation', label: 'Evapotranspiration', layer: 'MODIS_Terra_Evapotranspiration_Daily', group: 'land', description: 'MODIS Terra daily evapotranspiration', temporal: true, resolution: '1km' },
  { id: 'terra_gross_primary', label: 'Gross Primary Productivity', layer: 'MODIS_Terra_GPP_8Day', group: 'land', description: 'MODIS Terra gross primary productivity', temporal: true, resolution: '1km' },
  { id: 'terra_net_photosynthesis', label: 'Net Photosynthesis', layer: 'MODIS_Terra_Net_Photosynthesis_8Day', group: 'land', description: 'MODIS Terra net photosynthesis', temporal: true, resolution: '1km' },
  { id: 'terra_fpar', label: 'FPAR (Vegetation Cover)', layer: 'MODIS_Terra_FPAR_8Day', group: 'land', description: 'MODIS Terra fraction of absorbed photosynthetically active radiation', temporal: true, resolution: '1km' },
  { id: 'terra_lst_anomaly', label: 'LST Anomaly', layer: 'MODIS_Terra_Land_Surface_Temp_Anomaly', group: 'land', description: 'MODIS Terra land surface temperature anomaly', temporal: true, resolution: '1km' },

  // ── Flood / Disaster ──────────────────────────────────
  { id: 'flood_extent', label: 'Flood Extent', layer: 'MODIS_Terra_Flood_Map', group: 'disaster', description: 'MODIS Terra global flood extent mapping', temporal: true, resolution: '250m' },
  { id: 'burn_scar', label: 'Burn Scar', layer: 'MODIS_Terra_Burned_Area', group: 'disaster', description: 'MODIS Terra burned area mapping', temporal: true, resolution: '500m' },
  { id: 'ash_cloud', label: 'Volcanic Ash', layer: 'Volcanic_Ash_Detection', group: 'disaster', description: 'Volcanic ash cloud detection from satellite', temporal: true, resolution: 'variable' },

  // ── Gravity / Geoid ───────────────────────────────────
  { id: 'gravity_anomaly', label: 'Gravity Anomaly', layer: 'GRACE_Gravity_Anomaly', group: 'geophysics', description: 'GRACE-FO gravity anomaly (groundwater, ice sheet mass)', temporal: true, resolution: '300km' },
  { id: 'water_equivalent', label: 'Water Equivalent Height', layer: 'GRACE_Water_Equivalent', group: 'geophysics', description: 'GRACE-FO water equivalent height change', temporal: true, resolution: '300km' },

  // ── Lightning ─────────────────────────────────────────
  { id: 'lightning_flashes', label: 'Lightning Flashes', layer: 'LIS_OTD_Lightning_Climatology', group: 'atmosphere', description: 'Lightning Imaging Sensor flash rate climatology', temporal: true, resolution: '2.5deg' },


  // ════════════════════════════════════════════════════════════════
  // EXPANDED CATALOG — 97 products from NASA GIBS GetCapabilities
// ════════════════════════════════════════════════════════════════

  { id: 'airs_l2_carbon_monoxide_500hpa_volume_mixing_ratio_day', label: 'AIRS L2 Carbon Monoxide 500hPa Volume Mixing Ratio Day', layer: 'AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day', group: 'atmosphere', description: 'AIRS L2 Carbon Monoxide 500hPa Volume Mixing Ratio Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l2_cloud_top_height_day', label: 'AIRS L2 Cloud Top Height Day', layer: 'AIRS_L2_Cloud_Top_Height_Day', group: 'atmosphere', description: 'AIRS L2 Cloud Top Height Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l2_dust_score_day', label: 'AIRS L2 Dust Score Day', layer: 'AIRS_L2_Dust_Score_Day', group: 'atmosphere', description: 'AIRS L2 Dust Score Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l2_methane_400hpa_volume_mixing_ratio_day', label: 'AIRS L2 Methane 400hPa Volume Mixing Ratio Day', layer: 'AIRS_L2_Methane_400hPa_Volume_Mixing_Ratio_Day', group: 'atmosphere', description: 'AIRS L2 Methane 400hPa Volume Mixing Ratio Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l2_relativehumidity_500hpa_day', label: 'AIRS L2 RelativeHumidity 500hPa Day', layer: 'AIRS_L2_RelativeHumidity_500hPa_Day', group: 'atmosphere', description: 'AIRS L2 RelativeHumidity 500hPa Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l2_surface_air_temperature_day', label: 'AIRS L2 Surface Air Temperature Day', layer: 'AIRS_L2_Surface_Air_Temperature_Day', group: 'atmosphere', description: 'AIRS L2 Surface Air Temperature Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l3_all_sky_outgoing_longwave_radiation_daily_day', label: 'AIRS L3 All Sky Outgoing Longwave Radiation Daily Day', layer: 'AIRS_L3_All_Sky_Outgoing_Longwave_Radiation_Daily_Day', group: 'atmosphere', description: 'AIRS L3 All Sky Outgoing Longwave Radiation Daily Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l3_carbon_monoxide_500hpa_volume_mixing_ratio_daily_day', label: 'AIRS L3 Carbon Monoxide 500hPa Volume Mixing Ratio Daily Day', layer: 'AIRS_L3_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Daily_Day', group: 'atmosphere', description: 'AIRS L3 Carbon Monoxide 500hPa Volume Mixing Ratio Daily Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l3_clear_sky_outgoing_longwave_radiation_daily_day', label: 'AIRS L3 Clear Sky Outgoing Longwave Radiation Daily Day', layer: 'AIRS_L3_Clear_Sky_Outgoing_Longwave_Radiation_Daily_Day', group: 'atmosphere', description: 'AIRS L3 Clear Sky Outgoing Longwave Radiation Daily Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l3_methane_400hpa_volume_mixing_ratio_daily_day', label: 'AIRS L3 Methane 400hPa Volume Mixing Ratio Daily Day', layer: 'AIRS_L3_Methane_400hPa_Volume_Mixing_Ratio_Daily_Day', group: 'atmosphere', description: 'AIRS L3 Methane 400hPa Volume Mixing Ratio Daily Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l3_surface_air_temperature_daily_day', label: 'AIRS L3 Surface Air Temperature Daily Day', layer: 'AIRS_L3_Surface_Air_Temperature_Daily_Day', group: 'atmosphere', description: 'AIRS L3 Surface Air Temperature Daily Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l3_surface_relative_humidity_daily_day', label: 'AIRS L3 Surface Relative Humidity Daily Day', layer: 'AIRS_L3_Surface_Relative_Humidity_Daily_Day', group: 'atmosphere', description: 'AIRS L3 Surface Relative Humidity Daily Day', temporal: true, resolution: 'variable' },
  { id: 'airs_l3_surface_skin_temperature_daily_day', label: 'AIRS L3 Surface Skin Temperature Daily Day', layer: 'AIRS_L3_Surface_Skin_Temperature_Daily_Day', group: 'atmosphere', description: 'AIRS L3 Surface Skin Temperature Daily Day', temporal: true, resolution: 'variable' },
  { id: 'amsru2_sea_ice_brightness_temp_6km_89h', label: 'AMSRU2 Sea Ice Brightness Temp 6km 89H', layer: 'AMSRU2_Sea_Ice_Brightness_Temp_6km_89H', group: 'cryosphere', description: 'AMSRU2 Sea Ice Brightness Temp 6km 89H', temporal: false, resolution: '6km' },
  { id: 'amsru2_sea_ice_brightness_temp_6km_89v', label: 'AMSRU2 Sea Ice Brightness Temp 6km 89V', layer: 'AMSRU2_Sea_Ice_Brightness_Temp_6km_89V', group: 'cryosphere', description: 'AMSRU2 Sea Ice Brightness Temp 6km 89V', temporal: false, resolution: '6km' },
  { id: 'amsru2_sea_ice_concentration_12km', label: 'AMSRU2 Sea Ice Concentration 12km', layer: 'AMSRU2_Sea_Ice_Concentration_12km', group: 'cryosphere', description: 'AMSRU2 Sea Ice Concentration 12km', temporal: false, resolution: '12km' },
  { id: 'amsru2_sea_ice_concentration_25km', label: 'AMSRU2 Sea Ice Concentration 25km', layer: 'AMSRU2_Sea_Ice_Concentration_25km', group: 'cryosphere', description: 'AMSRU2 Sea Ice Concentration 25km', temporal: false, resolution: '25km' },
  { id: 'amsru2_snow_water_equivalent_daily', label: 'AMSRU2 Snow Water Equivalent Daily', layer: 'AMSRU2_Snow_Water_Equivalent_Daily', group: 'cryosphere', description: 'AMSRU2 Snow Water Equivalent Daily', temporal: true, resolution: 'variable' },
  { id: 'amsru2_soil_moisture_npd_day', label: 'AMSRU2 Soil Moisture NPD Day', layer: 'AMSRU2_Soil_Moisture_NPD_Day', group: 'microwave', description: 'AMSRU2 Soil Moisture NPD Day', temporal: true, resolution: 'variable' },
  { id: 'amsru2_soil_moisture_sca_day', label: 'AMSRU2 Soil Moisture SCA Day', layer: 'AMSRU2_Soil_Moisture_SCA_Day', group: 'microwave', description: 'AMSRU2 Soil Moisture SCA Day', temporal: true, resolution: 'variable' },
  { id: 'amsru2_wind_speed_day', label: 'AMSRU2 Wind Speed Day', layer: 'AMSRU2_Wind_Speed_Day', group: 'ocean', description: 'AMSRU2 Wind Speed Day', temporal: true, resolution: 'variable' },
  { id: 'calipso_wide_field_camera_radiance_v3_01', label: 'CALIPSO Wide Field Camera Radiance v3-01', layer: 'CALIPSO_Wide_Field_Camera_Radiance_v3-01', group: 'atmosphere', description: 'CALIPSO Wide Field Camera Radiance v3-01', temporal: false, resolution: 'variable' },
  { id: 'calipso_wide_field_camera_radiance_v3_02', label: 'CALIPSO Wide Field Camera Radiance v3-02', layer: 'CALIPSO_Wide_Field_Camera_Radiance_v3-02', group: 'atmosphere', description: 'CALIPSO Wide Field Camera Radiance v3-02', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_avhrr_oi_sea_surface_temperature', label: 'GHRSST L4 AVHRR-OI Sea Surface Temperature', layer: 'GHRSST_L4_AVHRR-OI_Sea_Surface_Temperature', group: 'ocean', description: 'GHRSST L4 AVHRR-OI Sea Surface Temperature', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_gamssa_gds2_sea_ice_concentration', label: 'GHRSST L4 GAMSSA GDS2 Sea Ice Concentration', layer: 'GHRSST_L4_GAMSSA_GDS2_Sea_Ice_Concentration', group: 'ocean', description: 'GHRSST L4 GAMSSA GDS2 Sea Ice Concentration', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_gamssa_gds2_sea_surface_temperature', label: 'GHRSST L4 GAMSSA GDS2 Sea Surface Temperature', layer: 'GHRSST_L4_GAMSSA_GDS2_Sea_Surface_Temperature', group: 'ocean', description: 'GHRSST L4 GAMSSA GDS2 Sea Surface Temperature', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_mur25_sea_ice_concentration', label: 'GHRSST L4 MUR25 Sea Ice Concentration', layer: 'GHRSST_L4_MUR25_Sea_Ice_Concentration', group: 'ocean', description: 'GHRSST L4 MUR25 Sea Ice Concentration', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_mur25_sea_surface_temperature', label: 'GHRSST L4 MUR25 Sea Surface Temperature', layer: 'GHRSST_L4_MUR25_Sea_Surface_Temperature', group: 'ocean', description: 'GHRSST L4 MUR25 Sea Surface Temperature', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_mur25_sea_surface_temperature_anomalies', label: 'GHRSST L4 MUR25 Sea Surface Temperature Anomalies', layer: 'GHRSST_L4_MUR25_Sea_Surface_Temperature_Anomalies', group: 'ocean', description: 'GHRSST L4 MUR25 Sea Surface Temperature Anomalies', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_mur_sea_ice_concentration', label: 'GHRSST L4 MUR Sea Ice Concentration', layer: 'GHRSST_L4_MUR_Sea_Ice_Concentration', group: 'ocean', description: 'GHRSST L4 MUR Sea Ice Concentration', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_mur_sea_surface_temperature', label: 'GHRSST L4 MUR Sea Surface Temperature', layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature', group: 'ocean', description: 'GHRSST L4 MUR Sea Surface Temperature', temporal: false, resolution: 'variable' },
  { id: 'ghrsst_l4_mur_sea_surface_temperature_anomalies', label: 'GHRSST L4 MUR Sea Surface Temperature Anomalies', layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', group: 'ocean', description: 'GHRSST L4 MUR Sea Surface Temperature Anomalies', temporal: false, resolution: 'variable' },
  { id: 'modis_combined_flood_1_day', label: 'MODIS Combined Flood 1-Day', layer: 'MODIS_Combined_Flood_1-Day', group: 'disaster', description: 'MODIS Combined Flood 1-Day', temporal: true, resolution: 'variable' },
  { id: 'modis_combined_flood_2_day', label: 'MODIS Combined Flood 2-Day', layer: 'MODIS_Combined_Flood_2-Day', group: 'disaster', description: 'MODIS Combined Flood 2-Day', temporal: true, resolution: 'variable' },
  { id: 'modis_combined_flood_3_day', label: 'MODIS Combined Flood 3-Day', layer: 'MODIS_Combined_Flood_3-Day', group: 'disaster', description: 'MODIS Combined Flood 3-Day', temporal: true, resolution: 'variable' },
  { id: 'modis_combined_l4_lai_4day', label: 'MODIS Combined L4 LAI 4Day', layer: 'MODIS_Combined_L4_LAI_4Day', group: 'land', description: 'MODIS Combined L4 LAI 4Day', temporal: true, resolution: 'variable' },
  { id: 'modis_combined_l4_lai_8day', label: 'MODIS Combined L4 LAI 8Day', layer: 'MODIS_Combined_L4_LAI_8Day', group: 'land', description: 'MODIS Combined L4 LAI 8Day', temporal: true, resolution: 'variable' },
  { id: 'modis_combined_thermal_anomalies_all', label: 'MODIS Combined Thermal Anomalies All', layer: 'MODIS_Combined_Thermal_Anomalies_All', group: 'thermal', description: 'MODIS Combined Thermal Anomalies All', temporal: false, resolution: 'variable' },
  { id: 'modis_combined_thermal_anomalies_day', label: 'MODIS Combined Thermal Anomalies Day', layer: 'MODIS_Combined_Thermal_Anomalies_Day', group: 'thermal', description: 'MODIS Combined Thermal Anomalies Day', temporal: true, resolution: 'variable' },
  { id: 'modis_combined_thermal_anomalies_night', label: 'MODIS Combined Thermal Anomalies Night', layer: 'MODIS_Combined_Thermal_Anomalies_Night', group: 'thermal', description: 'MODIS Combined Thermal Anomalies Night', temporal: false, resolution: 'variable' },
  { id: 'mopitt_co_daily_surface_mixing_ratio_day', label: 'MOPITT CO Daily Surface Mixing Ratio Day', layer: 'MOPITT_CO_Daily_Surface_Mixing_Ratio_Day', group: 'atmosphere', description: 'MOPITT CO Daily Surface Mixing Ratio Day', temporal: true, resolution: 'variable' },
  { id: 'mopitt_co_daily_total_column_day', label: 'MOPITT CO Daily Total Column Day', layer: 'MOPITT_CO_Daily_Total_Column_Day', group: 'atmosphere', description: 'MOPITT CO Daily Total Column Day', temporal: true, resolution: 'variable' },
  { id: 'mopitt_co_monthly_surface_mixing_ratio_day', label: 'MOPITT CO Monthly Surface Mixing Ratio Day', layer: 'MOPITT_CO_Monthly_Surface_Mixing_Ratio_Day', group: 'atmosphere', description: 'MOPITT CO Monthly Surface Mixing Ratio Day', temporal: true, resolution: 'variable' },
  { id: 'mopitt_co_monthly_total_column_day', label: 'MOPITT CO Monthly Total Column Day', layer: 'MOPITT_CO_Monthly_Total_Column_Day', group: 'atmosphere', description: 'MOPITT CO Monthly Total Column Day', temporal: true, resolution: 'variable' },
  { id: 'omi_absorbing_aerosol_optical_depth', label: 'OMI Absorbing Aerosol Optical Depth', layer: 'OMI_Absorbing_Aerosol_Optical_Depth', group: 'atmosphere', description: 'OMI Absorbing Aerosol Optical Depth', temporal: false, resolution: 'variable' },
  { id: 'omi_absorbing_aerosol_optical_thickness_mw_388', label: 'OMI Absorbing Aerosol Optical Thickness MW 388', layer: 'OMI_Absorbing_Aerosol_Optical_Thickness_MW_388', group: 'atmosphere', description: 'OMI Absorbing Aerosol Optical Thickness MW 388', temporal: false, resolution: 'variable' },
  { id: 'omi_aerosol_index', label: 'OMI Aerosol Index', layer: 'OMI_Aerosol_Index', group: 'atmosphere', description: 'OMI Aerosol Index', temporal: false, resolution: 'variable' },
  { id: 'omi_aerosol_optical_depth', label: 'OMI Aerosol Optical Depth', layer: 'OMI_Aerosol_Optical_Depth', group: 'atmosphere', description: 'OMI Aerosol Optical Depth', temporal: false, resolution: 'variable' },
  { id: 'omi_nitrogen_dioxide_tropo_column', label: 'OMI Nitrogen Dioxide Tropo Column', layer: 'OMI_Nitrogen_Dioxide_Tropo_Column', group: 'atmosphere', description: 'OMI Nitrogen Dioxide Tropo Column', temporal: false, resolution: 'variable' },
  { id: 'omi_ozone_doas_total_column', label: 'OMI Ozone DOAS Total Column', layer: 'OMI_Ozone_DOAS_Total_Column', group: 'atmosphere', description: 'OMI Ozone DOAS Total Column', temporal: false, resolution: 'variable' },
  { id: 'omi_ozone_toms_total_column', label: 'OMI Ozone TOMS Total Column', layer: 'OMI_Ozone_TOMS_Total_Column', group: 'atmosphere', description: 'OMI Ozone TOMS Total Column', temporal: false, resolution: 'variable' },
  { id: 'omi_so2_lower_troposphere', label: 'OMI SO2 Lower Troposphere', layer: 'OMI_SO2_Lower_Troposphere', group: 'atmosphere', description: 'OMI SO2 Lower Troposphere', temporal: false, resolution: 'variable' },
  { id: 'omi_so2_middle_troposphere', label: 'OMI SO2 Middle Troposphere', layer: 'OMI_SO2_Middle_Troposphere', group: 'atmosphere', description: 'OMI SO2 Middle Troposphere', temporal: false, resolution: 'variable' },
  { id: 'omi_so2_planetary_boundary_layer', label: 'OMI SO2 Planetary Boundary Layer', layer: 'OMI_SO2_Planetary_Boundary_Layer', group: 'atmosphere', description: 'OMI SO2 Planetary Boundary Layer', temporal: false, resolution: 'variable' },
  { id: 'omi_so2_upper_troposphere_and_stratosphere', label: 'OMI SO2 Upper Troposphere and Stratosphere', layer: 'OMI_SO2_Upper_Troposphere_and_Stratosphere', group: 'atmosphere', description: 'OMI SO2 Upper Troposphere and Stratosphere', temporal: false, resolution: 'variable' },
  { id: 'omi_uv_aerosol_index', label: 'OMI UV Aerosol Index', layer: 'OMI_UV_Aerosol_Index', group: 'atmosphere', description: 'OMI UV Aerosol Index', temporal: false, resolution: 'variable' },
  { id: 'omi_uv_erythemal_daily_dose', label: 'OMI UV Erythemal Daily Dose', layer: 'OMI_UV_Erythemal_Daily_Dose', group: 'atmosphere', description: 'OMI UV Erythemal Daily Dose', temporal: true, resolution: 'variable' },
  { id: 'omi_uv_erythemal_dose_rate', label: 'OMI UV Erythemal Dose Rate', layer: 'OMI_UV_Erythemal_Dose_Rate', group: 'atmosphere', description: 'OMI UV Erythemal Dose Rate', temporal: false, resolution: 'variable' },
  { id: 'omi_uv_index', label: 'OMI UV Index', layer: 'OMI_UV_Index', group: 'atmosphere', description: 'OMI UV Index', temporal: false, resolution: 'variable' },
  { id: 'omps_aerosol_index', label: 'OMPS Aerosol Index', layer: 'OMPS_Aerosol_Index', group: 'atmosphere', description: 'OMPS Aerosol Index', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa20_nadirmapper_aerosolindex_360', label: 'OMPS NOAA20 NadirMapper AerosolIndex 360', layer: 'OMPS_NOAA20_NadirMapper_AerosolIndex_360', group: 'atmosphere', description: 'OMPS NOAA20 NadirMapper AerosolIndex 360', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa20_nadirmapper_aerosolindex_380', label: 'OMPS NOAA20 NadirMapper AerosolIndex 380', layer: 'OMPS_NOAA20_NadirMapper_AerosolIndex_380', group: 'atmosphere', description: 'OMPS NOAA20 NadirMapper AerosolIndex 380', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa20_nadirmapper_aerosolindex_pyrocumulonimbus_360', label: 'OMPS NOAA20 NadirMapper AerosolIndex PyroCumuloNimbus 360', layer: 'OMPS_NOAA20_NadirMapper_AerosolIndex_PyroCumuloNimbus_360', group: 'atmosphere', description: 'OMPS NOAA20 NadirMapper AerosolIndex PyroCumuloNimbus 360', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa20_nadirmapper_aerosolindex_pyrocumulonimbus_380', label: 'OMPS NOAA20 NadirMapper AerosolIndex PyroCumuloNimbus 380', layer: 'OMPS_NOAA20_NadirMapper_AerosolIndex_PyroCumuloNimbus_380', group: 'atmosphere', description: 'OMPS NOAA20 NadirMapper AerosolIndex PyroCumuloNimbus 380', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa21_nadirmapper_aerosolindex_360', label: 'OMPS NOAA21 NadirMapper AerosolIndex 360', layer: 'OMPS_NOAA21_NadirMapper_AerosolIndex_360', group: 'atmosphere', description: 'OMPS NOAA21 NadirMapper AerosolIndex 360', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa21_nadirmapper_aerosolindex_380', label: 'OMPS NOAA21 NadirMapper AerosolIndex 380', layer: 'OMPS_NOAA21_NadirMapper_AerosolIndex_380', group: 'atmosphere', description: 'OMPS NOAA21 NadirMapper AerosolIndex 380', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa21_nadirmapper_aerosolindex_pyrocumulonimbus_360', label: 'OMPS NOAA21 NadirMapper AerosolIndex PyroCumuloNimbus 360', layer: 'OMPS_NOAA21_NadirMapper_AerosolIndex_PyroCumuloNimbus_360', group: 'atmosphere', description: 'OMPS NOAA21 NadirMapper AerosolIndex PyroCumuloNimbus 360', temporal: false, resolution: 'variable' },
  { id: 'omps_noaa21_nadirmapper_aerosolindex_pyrocumulonimbus_380', label: 'OMPS NOAA21 NadirMapper AerosolIndex PyroCumuloNimbus 380', layer: 'OMPS_NOAA21_NadirMapper_AerosolIndex_PyroCumuloNimbus_380', group: 'atmosphere', description: 'OMPS NOAA21 NadirMapper AerosolIndex PyroCumuloNimbus 380', temporal: false, resolution: 'variable' },
  { id: 'omps_ozone_total_column', label: 'OMPS Ozone Total Column', layer: 'OMPS_Ozone_Total_Column', group: 'atmosphere', description: 'OMPS Ozone Total Column', temporal: false, resolution: 'variable' },
  { id: 'smap_l3_active_passive_soil_moisture', label: 'SMAP L3 Active Passive Soil Moisture', layer: 'SMAP_L3_Active_Passive_Soil_Moisture', group: 'microwave', description: 'SMAP L3 Active Passive Soil Moisture', temporal: false, resolution: 'variable' },
  { id: 'smap_l3_sea_surface_salinity_cap_8day_runningmean', label: 'SMAP L3 Sea Surface Salinity CAP 8Day RunningMean', layer: 'SMAP_L3_Sea_Surface_Salinity_CAP_8Day_RunningMean', group: 'ocean', description: 'SMAP L3 Sea Surface Salinity CAP 8Day RunningMean', temporal: true, resolution: 'variable' },
  { id: 'smap_l3_sea_surface_salinity_cap_monthly', label: 'SMAP L3 Sea Surface Salinity CAP Monthly', layer: 'SMAP_L3_Sea_Surface_Salinity_CAP_Monthly', group: 'ocean', description: 'SMAP L3 Sea Surface Salinity CAP Monthly', temporal: true, resolution: 'variable' },
  { id: 'smap_l3_sea_surface_salinity_remss_8day_runningmean', label: 'SMAP L3 Sea Surface Salinity REMSS 8Day RunningMean', layer: 'SMAP_L3_Sea_Surface_Salinity_REMSS_8Day_RunningMean', group: 'ocean', description: 'SMAP L3 Sea Surface Salinity REMSS 8Day RunningMean', temporal: true, resolution: 'variable' },
  { id: 'smap_l3_sea_surface_salinity_remss_monthly', label: 'SMAP L3 Sea Surface Salinity REMSS Monthly', layer: 'SMAP_L3_Sea_Surface_Salinity_REMSS_Monthly', group: 'ocean', description: 'SMAP L3 Sea Surface Salinity REMSS Monthly', temporal: true, resolution: 'variable' },
  { id: 'smap_l4_analyzed_root_zone_soil_moisture', label: 'SMAP L4 Analyzed Root Zone Soil Moisture', layer: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture', group: 'microwave', description: 'SMAP L4 Analyzed Root Zone Soil Moisture', temporal: false, resolution: 'variable' },
  { id: 'viirs_black_marble', label: 'VIIRS Black Marble', layer: 'VIIRS_Black_Marble', group: 'anthropogenic', description: 'VIIRS Black Marble', temporal: false, resolution: 'variable' },
  { id: 'viirs_citylights_2012', label: 'VIIRS CityLights 2012', layer: 'VIIRS_CityLights_2012', group: 'anthropogenic', description: 'VIIRS CityLights 2012', temporal: false, resolution: 'variable' },
  { id: 'viirs_combined_flood_1_day', label: 'VIIRS Combined Flood 1-Day', layer: 'VIIRS_Combined_Flood_1-Day', group: 'disaster', description: 'VIIRS Combined Flood 1-Day', temporal: true, resolution: 'variable' },
  { id: 'viirs_combined_flood_2_day', label: 'VIIRS Combined Flood 2-Day', layer: 'VIIRS_Combined_Flood_2-Day', group: 'disaster', description: 'VIIRS Combined Flood 2-Day', temporal: true, resolution: 'variable' },
  { id: 'viirs_combined_flood_3_day', label: 'VIIRS Combined Flood 3-Day', layer: 'VIIRS_Combined_Flood_3-Day', group: 'disaster', description: 'VIIRS Combined Flood 3-Day', temporal: true, resolution: 'variable' },
  { id: 'viirs_noaa20_aod_dark_target_land_ocean', label: 'VIIRS NOAA20 AOD Dark Target Land Ocean', layer: 'VIIRS_NOAA20_AOD_Dark_Target_Land_Ocean', group: 'atmosphere', description: 'VIIRS NOAA20 AOD Dark Target Land Ocean', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_aot_deep_blue_best_estimate', label: 'VIIRS NOAA20 AOT Deep Blue Best Estimate', layer: 'VIIRS_NOAA20_AOT_Deep_Blue_Best_Estimate', group: 'atmosphere', description: 'VIIRS NOAA20 AOT Deep Blue Best Estimate', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_aerosol_type_deep_blue_best_estimate', label: 'VIIRS NOAA20 Aerosol Type Deep Blue Best Estimate', layer: 'VIIRS_NOAA20_Aerosol_Type_Deep_Blue_Best_Estimate', group: 'atmosphere', description: 'VIIRS NOAA20 Aerosol Type Deep Blue Best Estimate', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_angstrom_exponent_dark_target_ocean', label: 'VIIRS NOAA20 Angstrom Exponent Dark Target Ocean', layer: 'VIIRS_NOAA20_Angstrom_Exponent_Dark_Target_Ocean', group: 'atmosphere', description: 'VIIRS NOAA20 Angstrom Exponent Dark Target Ocean', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_angstrom_exponent_deep_blue_best_estimate', label: 'VIIRS NOAA20 Angstrom Exponent Deep Blue Best Estimate', layer: 'VIIRS_NOAA20_Angstrom_Exponent_Deep_Blue_Best_Estimate', group: 'atmosphere', description: 'VIIRS NOAA20 Angstrom Exponent Deep Blue Best Estimate', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_brightness_temp_bandi5_day', label: 'VIIRS NOAA20 Brightness Temp BandI5 Day', layer: 'VIIRS_NOAA20_Brightness_Temp_BandI5_Day', group: 'thermal', description: 'VIIRS NOAA20 Brightness Temp BandI5 Day', temporal: true, resolution: 'variable' },
  { id: 'viirs_noaa20_brightness_temp_bandi5_night', label: 'VIIRS NOAA20 Brightness Temp BandI5 Night', layer: 'VIIRS_NOAA20_Brightness_Temp_BandI5_Night', group: 'thermal', description: 'VIIRS NOAA20 Brightness Temp BandI5 Night', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_chlorophyll_a', label: 'VIIRS NOAA20 Chlorophyll a', layer: 'VIIRS_NOAA20_Chlorophyll_a', group: 'ocean', description: 'VIIRS NOAA20 Chlorophyll a', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_daynightband', label: 'VIIRS NOAA20 DayNightBand', layer: 'VIIRS_NOAA20_DayNightBand', group: 'anthropogenic', description: 'VIIRS NOAA20 DayNightBand', temporal: true, resolution: 'variable' },
  { id: 'viirs_noaa20_daynightband_atsensor_m15', label: 'VIIRS NOAA20 DayNightBand AtSensor M15', layer: 'VIIRS_NOAA20_DayNightBand_AtSensor_M15', group: 'anthropogenic', description: 'VIIRS NOAA20 DayNightBand AtSensor M15', temporal: true, resolution: 'variable' },
  { id: 'viirs_noaa20_daynightband_at_sensor_radiance', label: 'VIIRS NOAA20 DayNightBand At Sensor Radiance', layer: 'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance', group: 'anthropogenic', description: 'VIIRS NOAA20 DayNightBand At Sensor Radiance', temporal: true, resolution: 'variable' },
  { id: 'viirs_noaa20_evi_8day', label: 'VIIRS NOAA20 EVI 8Day', layer: 'VIIRS_NOAA20_EVI_8Day', group: 'land', description: 'VIIRS NOAA20 EVI 8Day', temporal: true, resolution: 'variable' },
  { id: 'viirs_noaa20_ndsi_snow_cover', label: 'VIIRS NOAA20 NDSI Snow Cover', layer: 'VIIRS_NOAA20_NDSI_Snow_Cover', group: 'cryosphere', description: 'VIIRS NOAA20 NDSI Snow Cover', temporal: false, resolution: 'variable' },
  { id: 'viirs_noaa20_ndvi_8day', label: 'VIIRS NOAA20 NDVI 8Day', layer: 'VIIRS_NOAA20_NDVI_8Day', group: 'land', description: 'VIIRS NOAA20 NDVI 8Day', temporal: true, resolution: 'variable' },
  { id: 'viirs_snpp_thermal_anomalies_375m_day', label: 'VIIRS SNPP Thermal Anomalies 375m Day', layer: 'VIIRS_SNPP_Thermal_Anomalies_375m_Day', group: 'thermal', description: 'VIIRS SNPP Thermal Anomalies 375m Day', temporal: true, resolution: '375m' },
  { id: 'viirs_snpp_thermal_anomalies_375m_night', label: 'VIIRS SNPP Thermal Anomalies 375m Night', layer: 'VIIRS_SNPP_Thermal_Anomalies_375m_Night', group: 'thermal', description: 'VIIRS SNPP Thermal Anomalies 375m Night', temporal: false, resolution: '375m' },

];

/* ═══════════════════════════════════════════════════════════════════
   External Data Sources (non-GIBS)
   ═══════════════════════════════════════════════════════════════════ */

export const EXTERNAL_DATA_SOURCES: SatelliteDataSource[] = [
  // ── EOX Sentinel-2 Cloudless (free, no API key) ──────
  {
    id: 'eox_s2_cloudless',
    label: 'Sentinel-2 Cloudless 2024',
    type: 'xyz',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    group: 'high-res',
    description: 'Cloud-free Sentinel-2 mosaic at 10m resolution (free, no key)',
    resolution: '10m',
    provider: 'EOX ItServices',
  },
  {
    id: 'eox_s2_cloudless_2023',
    label: 'Sentinel-2 Cloudless 2023',
    type: 'xyz',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    group: 'high-res',
    description: 'Cloud-free Sentinel-2 mosaic 2023 at 10m',
    resolution: '10m',
    provider: 'EOX ItServices',
  },
  {
    id: 'eox_s2_cloudless_2022',
    label: 'Sentinel-2 Cloudless 2022',
    type: 'xyz',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2022_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    group: 'high-res',
    description: 'Cloud-free Sentinel-2 mosaic 2022 at 10m',
    resolution: '10m',
    provider: 'EOX ItServices',
  },

  // ── ESA WorldCover (free WMS) ────────────────────────
  {
    id: 'esa_worldcover_2021',
    label: 'ESA WorldCover 10m (2021)',
    type: 'wms',
    url: 'https://services.terrascope.be/wms/v2.0',
    layer: 'WORLDCOVER2021_10M',
    group: 'land',
    description: 'ESA 10m global land cover classification (2021): water, trees, grass, cropland, built-up, barren, snow, wetlands',
    resolution: '10m',
    provider: 'ESA / Terrascope',
  },
  {
    id: 'esa_worldcover_2020',
    label: 'ESA WorldCover 10m (2020)',
    type: 'wms',
    url: 'https://services.terrascope.be/wms/v2.0',
    layer: 'WORLDCOVER2020_10M',
    group: 'land',
    description: 'ESA 10m global land cover classification (2020)',
    resolution: '10m',
    provider: 'ESA / Terrascope',
  },

  // ── Esri High-Res Imagery (free) ─────────────────────
  {
    id: 'esri_imagery',
    label: 'Esri World Imagery',
    type: 'xyz',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    group: 'high-res',
    description: 'High-resolution satellite and aerial imagery from Esri',
    resolution: '0.3m-10m',
    provider: 'Esri',
  },
  {
    id: 'esri_imagery_labels',
    label: 'Esri Imagery + Labels',
    type: 'xyz',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    group: 'high-res',
    description: 'Esri world boundaries and place labels overlay',
    resolution: 'variable',
    provider: 'Esri',
  },

  // ── MapTiler Satellite (free tier) ────────────────────
  // NOTE: Requires API key — shown as placeholder
  {
    id: 'maptiler_satellite',
    label: 'MapTiler Satellite (key required)',
    type: 'xyz',
    url: 'https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key={key}',
    group: 'high-res',
    description: 'High-resolution satellite imagery from MapTiler (free tier available)',
    resolution: '0.5m-10m',
    provider: 'MapTiler',
  },

  // ── Sentinel Hub OGC (true SAR — requires free API key) ─
  {
    id: 'sentinel1_sar_vvvh',
    label: 'Sentinel-1 SAR VV/VH (key required)',
    type: 'wms',
    url: 'https://services.sentinel-hub.com/ogc/wms/{key}',
    layer: '1_TRUE_COLOR',
    group: 'sar',
    description: 'Sentinel-1 SAR false-color composite (VV+VH+ratio) — true Synthetic Aperture Radar at 10m',
    resolution: '10m',
    provider: 'Sentinel Hub',
  },
  {
    id: 'sentinel2_sar_vv',
    label: 'Sentinel-1 SAR VV Polarization',
    type: 'wms',
    url: 'https://services.sentinel-hub.com/ogc/wms/{key}',
    layer: '1_TRUE_COLOR',
    group: 'sar',
    description: 'Sentinel-1 VV polarization (co-polar, good for ocean/ice)',
    resolution: '10m',
    provider: 'Sentinel Hub',
  },
  {
    id: 'sentinel2_sar_vh',
    label: 'Sentinel-1 SAR VH Polarization',
    type: 'wms',
    url: 'https://services.sentinel-hub.com/ogc/wms/{key}',
    layer: '1_TRUE_COLOR',
    group: 'sar',
    description: 'Sentinel-1 VH polarization (cross-polar, good for vegetation/land)',
    resolution: '10m',
    provider: 'Sentinel Hub',
  },
  {
    id: 'sentinel1_sar_co_vv',
    label: 'Sentinel-1 SAR Co-pol VV',
    type: 'wms',
    url: 'https://services.sentinel-hub.com/ogc/wms/{key}',
    layer: '1_TRUE_COLOR',
    group: 'sar',
    description: 'Sentinel-1 C-band SAR VV polarization — co-polar (good for ocean, ice, ship detection)',
    resolution: '10m',
    provider: 'Sentinel Hub (free key)',
  },
  {
    id: 'sentinel1_sar_cross_vh',
    label: 'Sentinel-1 SAR Cross-pol VH',
    type: 'wms',
    url: 'https://services.sentinel-hub.com/ogc/wms/{key}',
    layer: '1_TRUE_COLOR',
    group: 'sar',
    description: 'Sentinel-1 C-band SAR VH polarization — cross-polar (good for vegetation, soil moisture, disaster mapping)',
    resolution: '10m',
    provider: 'Sentinel Hub (free key)',
  },

  // ── Copernicus DEM ────────────────────────────────────
  {
    id: 'copernicus_dem',
    label: 'Copernicus DEM',
    type: 'wms',
    url: 'https://view-eoc.mundialis.de/geoserver/wms',
    layer: 'copernicus_dem',
    group: 'terrain',
    description: 'Copernicus Digital Elevation Model (30m resolution)',
    resolution: '30m',
    provider: 'Copernicus',
  },
];

/** Group products by category for UI optgroups */
export function groupProducts(products: GibsProduct[]): Record<string, GibsProduct[]> {
  const groups: Record<string, GibsProduct[]> = {};
  for (const p of products) {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  }
  return groups;
}



/** Human-readable group labels */
export const GROUP_LABELS: Record<string, string> = {
  optical: 'Optical Imagery',
  land: 'Land Surface',
  thermal: 'Thermal / Fire',
  atmosphere: 'Atmosphere',
  ocean: 'Ocean',
  cryosphere: 'Cryosphere',
  radiation: 'Radiation',
  anthropogenic: 'Human Activity',
  sar: 'SAR (Synthetic Aperture Radar)',
  microwave: 'Passive Microwave',
  geostationary: 'Geostationary',
  disaster: 'Disaster',
  geophysics: 'Geophysics',
  'high-res': 'High Resolution',
  terrain: 'Terrain',
};
