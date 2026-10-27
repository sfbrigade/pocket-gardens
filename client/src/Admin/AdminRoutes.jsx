import { Navigate, Routes, Route } from 'react-router';

import AdminInvitesRoutes from './Invites/AdminInvitesRoutes';
import AdminPeopleRoutes from './People/AdminPeopleRoutes';
import AdminUsersRoutes from './Users/AdminUsersRoutes';

function AdminRoutes () {
  return (
    <Routes>
      <Route path='invites/*' element={<AdminInvitesRoutes />} />
      <Route path='people/*' element={<AdminPeopleRoutes />} />
      <Route path='users/*' element={<AdminUsersRoutes />} />
      <Route path='' element={<Navigate to='users' />} />
    </Routes>
  );
}

export default AdminRoutes;
