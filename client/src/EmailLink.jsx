import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Container, Stack, Title } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from './Api';
import { authPath, loginDestination } from './LoginDestination';

export default function EmailLink ({ action }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = searchParams.get('token');
  const verifyingEmail = action === 'verify-email';
  const from = loginDestination(searchParams.get('from'));
  const title = verifyingEmail ? 'Verify your email' : 'Log in with your email link';
  // Only redeem on confirmation, so opening a link does not consume it.
  const mutation = useMutation({
    mutationFn: () => verifyingEmail ? Api.auth.verifyEmail(token) : Api.auth.verifyMagicLink(token),
    onSuccess: async (response) => {
      if (verifyingEmail) {
        navigate(authPath('/login', from), { replace: true, state: { flash: 'Your email has been verified. You can now log in.', loginMethod: 'password' } });
      } else {
        await queryClient.cancelQueries({ queryKey: ['users', 'me'], exact: true });
        queryClient.setQueryData(['users', 'me'], response.data);
        navigate(from, { replace: true });
      }
    },
  });

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name='referrer' content='no-referrer' />
      </Head>
      <Container>
        <Stack w={{ base: '100%', xs: 320 }}>
          <Title>{title}</Title>
          {!token && <Alert color='red'>This link is invalid. Please request a new one.</Alert>}
          {mutation.error && <Alert color='red'>{mutation.error._form}</Alert>}
          {token && <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>{verifyingEmail ? 'Verify email' : 'Log in'}</Button>}
          <Link to={authPath('/login', from)}>Back to login</Link>
        </Stack>
      </Container>
    </>
  );
}
