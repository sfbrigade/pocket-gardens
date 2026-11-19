import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Container, Stack, Title } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from './Api';
import { authPath, loginDestination } from './LoginDestination';
import { magicLinkConfirmationURL } from './auth-session';

const callbackMessages = new Map([
  ['BANNED_USER', 'Your account has been deactivated.'],
  ['REGISTRATION_CLOSED', 'Registration is closed. A valid invitation is required.'],
  ['INVALID_INVITATION', 'This invitation is invalid or no longer available.'],
]);

export default function EmailLink ({ action }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const callbackError = searchParams.get('error');
  const verifyingEmail = action === 'verify-email';
  const callbackMessage = callbackMessages.get(callbackError) || 'This link is invalid or has expired. Please request a new one.';
  const from = loginDestination(searchParams.get('from'));
  const title = verifyingEmail ? 'Verify your email' : 'Log in with your email link';
  // Only redeem on confirmation, so opening a link does not consume it.
  const mutation = useMutation({
    mutationFn: () => Api.auth.verifyEmail(token),
    onSuccess: () => {
      if (verifyingEmail) {
        navigate(authPath('/login', from), { replace: true, state: { flash: 'Your email has been verified. You can now log in.', loginMethod: 'password' } });
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
          {(!token || callbackError) && <Alert color='red'>{callbackMessage}</Alert>}
          {mutation.error && <Alert color='red'>{mutation.error._form}</Alert>}
          {token && !callbackError && <Button loading={mutation.isPending} onClick={() => verifyingEmail ? mutation.mutate() : window.location.assign(magicLinkConfirmationURL(token, from))}>{verifyingEmail ? 'Verify email' : 'Log in'}</Button>}
          <Link to={authPath('/login', from)}>Back to login</Link>
        </Stack>
      </Container>
    </>
  );
}
