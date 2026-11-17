import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, Button, Container, Stack, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from '../Api';
import { useAuthContext } from '../AuthContext';
import RegistrationForm from '../RegistrationForm';
import { authPath, loginDestination } from '../LoginDestination';

function Invite () {
  const { user, signOut } = useAuthContext();
  const navigate = useNavigate();
  const { inviteId } = useParams();
  const [searchParams] = useSearchParams();
  const from = loginDestination(searchParams.get('from'));

  const { data: invite, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['invite', inviteId],
    queryFn: () => Api.invites.get(inviteId).then(response => response.data),
    retry: (count, error) => ![404, 410, 422].includes(error.response?.status) && count < 2,
  });

  const unavailable = [404, 410, 422].includes(error?.response?.status);

  const onSubmitMutation = useMutation({
    mutationFn: (values) => Api.auth.register({ ...values, inviteId, callbackURL: values.registrationMethod === 'magic-link' ? from : authPath('/login', from) }),
    onSuccess: (_, values) => navigate(authPath('/login', from), {
      state: {
        email: values.email,
        loginMethod: values.registrationMethod,
        flash: values.registrationMethod === 'magic-link'
          ? 'Check your inbox for a link to complete registration and log in. If you already have an account, the link will log you in.'
          : 'Please check your email to verify your account before logging in.',
      }
    }),
    onError: () => window.scrollTo(0, 0),
  });

  return (
    <>
      <Head>
        <title>You&apos;re Invited</title>
      </Head>
      <Container>
        <Title mb='md'>You&apos;re Invited</Title>
        <Stack>
          {isPending && <Alert>Loading invitation...</Alert>}
          {isError && (
            <Alert color='red'>
              {unavailable ? 'This invitation link is invalid, has already been used, or is no longer available. Ask an administrator for a new invitation.' : 'Unable to load this invitation. Please try again.'}
            </Alert>
          )}
          {isError && !unavailable && <Button loading={isFetching} onClick={() => refetch()}>Try again</Button>}
          {!isError && invite && (user
            ? (
              <>
                <Alert>You are signed in as {user.email}. Log out before accepting an invitation for another account.</Alert>
                {signOut.error && <Alert color='red'>{signOut.error._form || 'Unable to log out. Please try again.'}</Alert>}
                <Button loading={signOut.isPending || signOut.isSuccess} onClick={() => signOut.mutate({ stayOnPage: true })}>Log out to accept invitation</Button>
              </>
              )
            : <RegistrationForm onSubmitMutation={onSubmitMutation} initialEmail={invite.email} />)}
          <Link to={user ? '/account' : authPath('/login', from)}>{user ? 'Back to your account' : 'Back to login'}</Link>
        </Stack>
      </Container>
    </>
  );
}
export default Invite;
