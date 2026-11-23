import { useCallback } from 'react';
import { useBeforeUnload } from 'react-router';

export default function DraftRefreshGuard () {
  useBeforeUnload(useCallback((event) => {
    event.preventDefault();
    event.returnValue = true;
  }, []));
  return null;
}
