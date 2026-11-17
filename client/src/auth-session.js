export async function setAuthenticatedUser (queryClient, user) {
  await queryClient.cancelQueries();
  // Keep the observed session query so the auth provider receives the new user.
  queryClient.removeQueries({
    predicate: ({ queryKey }) => queryKey.length !== 2 || queryKey[0] !== 'users' || queryKey[1] !== 'me',
  });
  queryClient.setQueryData(['users', 'me'], user);
}
