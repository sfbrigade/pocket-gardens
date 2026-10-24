import { useEffect, useRef } from 'react';
import { useDebouncedValue, useMounted } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useStaticContext } from '../StaticContext';
import { addressSuggestionPatch, lookupAddress, suggestedTitle } from './plot-identification';

export default function usePlotSuggestions (form, disabled) {
  const mounted = useMounted();
  const { env } = useStaticContext() || {};
  const [position] = useDebouncedValue(form.values.position, 800);
  const positionKey = form.values.position ? `${form.values.position.latitude.toFixed(5)},${form.values.position.longitude.toFixed(5)}` : '';
  const lastPosition = useRef(positionKey);
  const query = useQuery({
    queryKey: ['nearby-address', position?.latitude.toFixed(5), position?.longitude.toFixed(5)],
    queryFn: ({ signal }) => lookupAddress(position, { signal, baseUrl: env?.VITE_PHOTON_BASE_URL }),
    enabled: mounted && !!position && !form.values.addressEdited && !disabled,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
  });
  useEffect(() => {
    if (lastPosition.current !== positionKey) {
      const previous = lastPosition.current;
      lastPosition.current = positionKey;
      if (previous && !disabled && !form.getValues().addressEdited) form.setFieldValue('address', '');
    }
  }, [positionKey]);
  useEffect(() => {
    if (disabled) return;
    const patch = addressSuggestionPatch(form.getValues(), query.data);
    if (patch.address !== undefined && patch.address !== form.getValues().address) form.setFieldValue('address', patch.address);
  }, [query.data, positionKey, disabled]);
  const title = suggestedTitle(form.values.address, form.values.locator);
  useEffect(() => {
    if (!disabled && !form.getValues().nameEdited && form.getValues().name !== title) form.setFieldValue('name', title);
  }, [title, form.values.nameEdited, disabled]);
  const addressNote = form.values.addressEdited
    ? 'Entered by you. Moving the pin will keep this address.'
    : query.isFetching
      ? 'Looking up a nearby address. You can enter it manually.'
      : query.isError
        ? 'No nearby address could be suggested. Enter it manually if known.'
        : query.data
          ? 'Suggested nearby address. Confirm the building number and street side.'
          : 'Optional. Set a pin for an address suggestion, or enter one manually.';
  return { title, addressNote };
}
