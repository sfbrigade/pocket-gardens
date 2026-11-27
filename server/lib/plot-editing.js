const details = ['Pocket Garden Name', 'Location Description', 'permissionStatus'];
const authors = {
  permissionAdditionalNote: 'permissionAdditionalNoteAuthorId',
  gardenCareNote: 'gardenCareNoteAuthorId',
  environmentalNotes: 'environmentalNotesAuthorId',
};
const notes = Object.keys(authors);

export const plotEditorFields = [...details, ...notes, 'staffPermissionNotes'];
export const plotAuthorshipSelect = {
  createdById: true,
  ...Object.fromEntries(Object.entries(authors).flat().map((field) => [field, true])),
};

export function editablePlotFields (user, plot) {
  if (!user?.canContribute) return [];
  if (user.isAdmin) return plotEditorFields;
  const ownsPlot = plot.createdById === user.id;
  const editableNotes = notes.filter((field) => plot[authors[field]] === user.id || (ownsPlot && !plot[field]));
  return [...(ownsPlot ? details : []), ...editableNotes];
}

export function plotNoteAuthorChanges (body, authorId, plot = {}) {
  return Object.fromEntries(notes.flatMap((field) => {
    if (body[field] === undefined || (body[field] && plot[field])) return [];
    return [[authors[field], body[field] ? authorId : null]];
  }));
}

export function plotNotePreconditions (body, plot) {
  return Object.fromEntries(notes.filter((field) => body[field] !== undefined)
    .flatMap((field) => [[field, plot[field]], [authors[field], plot[authors[field]]]]));
}
