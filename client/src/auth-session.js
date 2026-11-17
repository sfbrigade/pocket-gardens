export function clearAccountQueries (queryClient) {
  // Removal also cancels pending queries. Keep the observed session query.
  queryClient.removeQueries({
    predicate: ({ queryKey }) => queryKey.length !== 2 || queryKey[0] !== 'users' || queryKey[1] !== 'me',
  });
}

export async function setAuthenticatedUser (queryClient, user) {
  await queryClient.cancelQueries();
  clearAccountQueries(queryClient);
  queryClient.setQueryData(['users', 'me'], user);
}
