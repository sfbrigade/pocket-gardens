import { useDebouncedValue, useMounted } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useStaticContext } from '../StaticContext';
import { lookupAddress, resolvePlotIdentification, suggestedTitle } from './plot-identification';

export default function usePlotSuggestions (values, disabled) {
  const mounted = useMounted();
  const { env } = useStaticContext() || {};
  const [position] = useDebouncedValue(values.position, 800);
  const query = useQuery({
    queryKey: ['nearby-address', position?.latitude.toFixed(5), position?.longitude.toFixed(5)],
    queryFn: ({ signal }) => lookupAddress(position, { signal, baseUrl: env?.VITE_PHOTON_BASE_URL }),
    enabled: mounted && !!position && !values.addressEdited && !disabled,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const identification = resolvePlotIdentification(values, query.data);
  const title = suggestedTitle(identification.address, values.locator);
  const addressNote = values.addressEdited
    ? 'Entered by you. Moving the pin will keep this address.'
    : query.isFetching
      ? 'Looking up a nearby address. You can enter it manually.'
      : query.isError
        ? 'No nearby address could be suggested. Enter it manually if known.'
        : identification.address
          ? 'Suggested nearby address. Confirm the building number and street side.'
          : 'Optional. Set a pin for an address suggestion, or enter one manually.';
  return { identification, result: query.data, title, addressNote };
}
