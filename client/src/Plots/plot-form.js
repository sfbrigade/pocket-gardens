import { v4 as uuid } from 'uuid';
import { plotPermissionLabels } from '../plots.js';

export const stages = [{ value: 'potential', label: 'Potential' }, { value: 'preparing', label: 'Preparing' }, { value: 'active', label: 'Active' }];
export const permissions = Object.entries(plotPermissionLabels).map(([value, label]) => ({ value, label }));
export const maxPlantQuantity = 2147483647;
export const beds = ['Tree well', 'Hell strip', 'Median', 'Raised bed', 'Neighborhood hub', 'Other'];
export const soils = ['Sandy', 'Clay', 'Bedrock', 'Rocky / concrete', 'Loam', 'Not usable', 'Unknown'];
export const sunLevels = ['Full sun', 'Partial sun', 'Shade', 'Unknown'];

export function createPlotDraft () {
  return {
    submissionId: uuid(),
    stage: 'potential',
    position: null,
    address: '',
    addressEdited: false,
    locator: '',
    name: '',
    nameEdited: false,
    photo: '',
    photoWasSelected: false,
    permissionStatus: 'unknown',
    firstPlanted: '',
    bedType: '',
    area: '',
    sunExposure: '',
    soilType: '',
    environmentalNotes: '',
    plants: [],
  };
}

export function hasDraftContent (values) {
  return !!(values.position || values.address || values.locator || values.name || values.photoWasSelected ||
    values.stage !== 'potential' || values.permissionStatus !== 'unknown' || values.firstPlanted ||
    values.bedType || values.area !== '' || values.sunExposure || values.soilType || values.environmentalNotes || values.plants.length);
}

export function plotDraftErrors (values) {
  const errors = {};
  if (!values.position || !Number.isFinite(values.position.latitude) || !Number.isFinite(values.position.longitude)) errors.position = 'Choose a map location';
  if (!values.locator.trim()) errors.locator = 'Describe exactly where the plot is';
  if (values.area !== '' && (!Number.isFinite(Number(values.area)) || Number(values.area) < 0)) errors.area = 'Enter a nonnegative area';
  if (values.stage !== 'potential') {
    values.plants.forEach(({ quantity }, index) => {
      if (quantity !== '' && (!Number.isInteger(Number(quantity)) || Number(quantity) < 0 || Number(quantity) > maxPlantQuantity)) {
        errors[`plants.${index}.quantity`] = `Enter a whole quantity between 0 and ${maxPlantQuantity.toLocaleString('en-US')}`;
      }
    });
  }
  return errors;
}

export function plotPayload (values) {
  const optional = (value) => typeof value === 'string' ? value.trim() || undefined : value;
  return {
    submissionId: values.submissionId,
    stage: values.stage,
    Latitude: values.position?.latitude,
    Longitude: values.position?.longitude,
    'Street Address': optional(values.address),
    'Street City Address (for Maps)': optional(values.address),
    'Location Description': values.locator.trim(),
    'Pocket Garden Name': optional(values.name),
    Photos: values.photo ? [values.photo] : undefined,
    permissionStatus: values.permissionStatus,
    firstPlanted: values.stage === 'active' ? optional(values.firstPlanted) : undefined,
    'Bed Type': optional(values.bedType),
    'Est. Area (Sq. Ft)': values.area === '' ? undefined : Number(values.area),
    sunExposure: optional(values.sunExposure),
    'Soil Type': optional(values.soilType),
    environmentalNotes: optional(values.environmentalNotes),
    plants: values.stage === 'potential'
      ? []
      : values.plants.map((plant) => ({
        ...(plant.plantId ? { plantId: plant.plantId } : { newPlant: plant.newPlant }),
        quantity: plant.quantity === '' ? undefined : Number(plant.quantity),
        notes: optional(plant.notes),
      })),
  };
}

export function plotFormErrors (errors) {
  const names = {
    Latitude: 'position',
    Longitude: 'position',
    'Location Description': 'locator',
    'Pocket Garden Name': 'name',
    'Street Address': 'address',
    'Street City Address (for Maps)': 'address',
    Photos: 'photo',
    'Bed Type': 'bedType',
    'Est. Area (Sq. Ft)': 'area',
    'Soil Type': 'soilType',
  };
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== 'plotId').map(([key, value]) => [names[key] || key, value]));
}
