import { Routes, Route } from 'react-router';

import AdminPeopleList from './AdminPeopleList';

function AdminPeopleRoutes () {
  return (
    <Routes>
      <Route path='' element={<AdminPeopleList />} />
    </Routes>
  );
}

export default AdminPeopleRoutes;
