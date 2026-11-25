import { useEffect, useId } from 'react';
import { Alert, Button, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import Api from '../Api';
import { cacheUpdatedPlot, plotQueryOptions, updatePlotViewport } from '../plots';

export default function PlotStage ({ plot, accountId }) {
  const mutationKey = ['plot-stage', accountId, plot.id];
  const attempts = useMutationState({
    filters: { mutationKey, exact: true },
    select: ({ mutationId, state }) => ({ id: mutationId, status: state.status, error: state.error }),
  });
  const attempt = attempts.at(-1);
  if (plot.stage !== 'potential' && !attempt) return null;
  return <StageAction plot={plot} mutationKey={mutationKey} attempt={attempt} />;
}

function StageAction ({ plot, mutationKey, attempt }) {
  const { plotId } = useParams();
  const client = useQueryClient();
  const modalId = useId();
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => Api.plots.update(plot.id, { stage: 'preparing', expectedStage: 'potential' }),
    onSuccess: ({ data }) => cacheUpdatedPlot(client, data, ['stage'], plotId),
  });
  useEffect(() => () => modals.close(modalId), [modalId]);

  const writeError = attempt?.error;
  const writeStatus = writeError?.response?.status;
  const verify = !!writeError && (!writeStatus || writeStatus === 409 || writeStatus >= 500);
  const verification = useQuery({
    queryKey: ['plot-stage-verification', ...mutationKey.slice(1), attempt?.id],
    queryFn: async () => {
      const options = plotQueryOptions(plotId);
      // A request that started before the failed write could return the old stage.
      await client.cancelQueries({ queryKey: options.queryKey, exact: true });
      const current = await client.fetchQuery({ ...options, staleTime: 0, retry: false });
      updatePlotViewport(client, current.id, { stage: current.stage });
      return current.stage;
    },
    enabled: verify,
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const error = verify ? verification.error : writeError;
  const status = error?.response?.status;
  const blocked = [401, 403, 404].includes(status);
  const saving = attempt?.status === 'pending';
  const checking = verify && verification.isFetching;
  const needsCheck = verify && !verification.isSuccess;
  const errorMessage = {
    401: 'Sign in again to change the garden stage.',
    403: 'You no longer have access to change the garden stage.',
    404: 'This garden is no longer available.',
  }[status] || (needsCheck ? 'Unable to check the current stage. Check again before moving the garden.' : 'Unable to move the garden. Try again.');

  function confirmMove () {
    modals.openConfirmModal({
      modalId,
      title: 'Move this garden to Preparing?',
      children: <Text>The stage for {plot['Pocket Garden Name'] || 'this garden'} will change from Potential site to Preparing.</Text>,
      labels: { confirm: 'Move to Preparing', cancel: 'Cancel' },
      onConfirm: () => { if (!client.isMutating({ mutationKey, exact: true })) mutation.mutate(); },
    });
  }

  return (
    <>
      {plot.stage === 'potential' && !blocked && !needsCheck && (
        <Button variant='light' loading={saving} onClick={confirmMove}>Move to Preparing</Button>
      )}
      {error && !checking && <Alert color='red' role='alert' w='100%'>{errorMessage}</Alert>}
      {needsCheck && !checking && !blocked && <Button variant='subtle' onClick={() => verification.refetch()}>Check garden stage</Button>}
      {checking && <Text size='sm' role='status'>Checking garden stage…</Text>}
      {(attempt?.status === 'success' || (verify && verification.isSuccess)) && (
        <Alert color={plot.stage === 'preparing' ? 'green' : 'blue'} role='status' w='100%'>
          {plot.stage === 'preparing'
            ? (verify ? 'This garden is already Preparing.' : 'Garden moved to Preparing.')
            : (plot.stage === 'potential' ? 'This garden is still a Potential site. Try moving it again.' : 'The garden stage has changed. Review its current stage above.')}
        </Alert>
      )}
    </>
  );
}
