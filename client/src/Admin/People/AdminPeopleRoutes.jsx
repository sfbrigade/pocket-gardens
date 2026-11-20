import { Routes, Route } from 'react-router';

import AdminPeopleList from './AdminPeopleList';
import AdminPersonDetail from './AdminPersonDetail';

function AdminPeopleRoutes () {
  return (
    <Routes>
      <Route path='' element={<AdminPeopleList />} />
      <Route path=':id' element={<AdminPersonDetail />} />
    </Routes>
  );
}

export default AdminPeopleRoutes;
