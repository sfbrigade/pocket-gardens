# Retries recover the same plot submission

A plot save can succeed even when the browser does not receive its response. Identify each submission draft independently of its location so that repeating its save, including after a same-tab refresh, recovers the original saved plot rather than creating another one. Disabling the submit button alone does not provide this guarantee, and matching submissions by address or coordinates would incorrectly collapse distinct nearby plots.

Draft fields and selections survive same-tab refresh until successful submission or explicit discard. Refresh confirmation supplements that recovery; it is not the mechanism that preserves the draft. Photo files may need reattachment after refresh, which must be communicated clearly.
