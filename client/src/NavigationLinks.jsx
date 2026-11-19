import { Link, NavLink } from 'react-router';
import { Alert, Anchor, Avatar, Group, Menu, Stack } from '@mantine/core';

import { useAuthContext } from './AuthContext';

export default function NavigationLinks ({ close, mobile = false }) {
  const { user, signOut } = useAuthContext();
  const Layout = mobile ? Stack : Group;

  return (
    <Layout {...(mobile ? { p: 'md', gap: 'md' } : { visibleFrom: 'sm', gap: 'xl' })}>
      <Anchor component={NavLink} to='/' onClick={close}>Home</Anchor>
      {user
        ? (
          <>
            {user.isAdmin && (mobile
              ? (
                <>
                  <Anchor component={NavLink} to='/admin/invites' onClick={close}>Invites</Anchor>
                  <Anchor component={NavLink} to='/admin/people' onClick={close}>People</Anchor>
                  <Anchor component={NavLink} to='/admin/users' onClick={close}>Users</Anchor>
                </>
                )
              : (
                <Menu trigger='hover' transitionProps={{ exitDuration: 0 }} withinPortal>
                  <Menu.Target>
                    <Anchor component={NavLink} to='/admin' onClick={close}>Admin</Anchor>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item component={Link} to='/admin/invites' onClick={close}>Invites</Menu.Item>
                    <Menu.Item component={Link} to='/admin/people' onClick={close}>People</Menu.Item>
                    <Menu.Item component={Link} to='/admin/users' onClick={close}>Users</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                ))}
            <Group gap='xs'>
              <span>Hello, <Anchor component={NavLink} to='/account' onClick={close}>{user.firstName}!</Anchor></span>
              {user.pictureUrl && <Avatar src={user.pictureUrl} />}
            </Group>
            <Anchor component='button' type='button' disabled={signOut.isPending || signOut.isSuccess} onClick={() => signOut.mutate(undefined, { onSuccess: close })}>
              {signOut.isPending || signOut.isSuccess ? 'Logging out…' : 'Log out'}
            </Anchor>
          </>
          )
        : <Anchor component={NavLink} to='/login' onClick={close}>Log in</Anchor>}
      {signOut.error && (
        <Alert
          {...(mobile ? {} : { pos: 'absolute', top: '100%', left: 0, right: 0 })}
          color='red'
          withCloseButton
          onClose={() => signOut.reset()}
        >
          {signOut.error._form || 'Unable to log out. Please try again.'}
        </Alert>
      )}
    </Layout>
  );
}
