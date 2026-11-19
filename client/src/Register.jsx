import { Link, useLocation, useSearchParams } from 'react-router';
import { Box, Container, Stack, Title } from '@mantine/core';
import { Head } from '@unhead/react';

import RegistrationForm from './RegistrationForm';
import { authPath, loginDestination } from './LoginDestination';
import useRegistration from './useRegistration';

function Register () {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const from = loginDestination(searchParams.get('from'));

  const onSubmitMutation = useRegistration({ from });

  return (
    <>
      <Head>
        <title>Register</title>
      </Head>
      <Container>
        <Title mb='md'>Register</Title>
        <Stack>
          <RegistrationForm onSubmitMutation={onSubmitMutation} initialEmail={location.state?.email} />
          <Box>
            <Link to={authPath('/login', from)} state={{ email: location.state?.email }}>Already have an account?</Link>
          </Box>
        </Stack>
      </Container>
    </>
  );
}

export default Register;
