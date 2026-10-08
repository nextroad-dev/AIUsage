import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServices } from '@/data/hooks';

const consentKey = ['codexResetConsent'] as const;

/** App-wide opt-in, read locally before any public data request is allowed. */
export function useCodexResetPreference() {
  const service = useServices().data?.codexReset;
  const client = useQueryClient();
  const query = useQuery({
    queryKey: consentKey,
    queryFn: () => service!.getEnabled(),
    enabled: !!service,
    staleTime: Infinity,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const saving = service!.setEnabled(enabled);
      if (!enabled) {
        // Hide content and cancel observers immediately, including other open account screens.
        client.setQueryData(consentKey, false);
        const cancelled = client.cancelQueries({ queryKey: ['codexReset'] });
        await Promise.all([saving, cancelled]);
      } else {
        await saving;
      }
      return await service!.getEnabled();
    },
    onSuccess: (enabled) => {
      client.setQueryData(consentKey, enabled);
      if (enabled) void client.invalidateQueries({ queryKey: ['codexReset'] });
    },
  });
  return {
    enabled: query.data === true,
    loaded: query.data !== undefined,
    pending: mutation.isPending,
    setEnabled: mutation.mutateAsync,
  };
}
