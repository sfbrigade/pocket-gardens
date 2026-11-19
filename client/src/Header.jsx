import { Link } from 'react-router';
import { Burger, Container, Group, Title } from '@mantine/core';

import NavigationLinks from './NavigationLinks';

function Header ({ opened, close, toggle }) {
  return (
    <Container h='100%'>
      <Group h='100%' align='center' justify='space-between'>
        <Link to='/' onClick={close}>
          <Title size='xl'>Pocket Gardens</Title>
        </Link>
        <NavigationLinks close={close} />
        <Burger aria-label={opened ? 'Close navigation' : 'Open navigation'} opened={opened} onClick={toggle} hiddenFrom='sm' size='sm' />
      </Group>
    </Container>
  );
}

export default Header;
