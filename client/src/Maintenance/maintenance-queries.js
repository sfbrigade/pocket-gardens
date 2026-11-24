import { queryOptions, useQuery } from '@tanstack/react-query';
import Api from '../Api';
import { useAuthContext } from '../AuthContext';

export function useMaintenanceCapabilities () {
  const { user, isPending } = useAuthContext();
  const account = user?.id ?? 'anonymous';
  const options = queryOptions({
    queryKey: ['maintenance-capabilities', account],
    queryFn: ({ signal }) => Api.maintenance.capabilities(signal).then(({ data }) => data),
    enabled: !isPending,
    select: (data) => !user && !data.allowAnonymous ? { ...data, canCreate: false, canManage: false } : data,
  });
  const capabilities = useQuery(options);
  return { account, authPending: isPending, capabilities };
}
