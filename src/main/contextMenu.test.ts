import { describe, expect, it } from 'vitest';
import { editMenuItems } from './contextMenu';

describe('editMenuItems', () => {
  it('is null for what is not editable, so no menu shows', () => {
    expect(editMenuItems({ isEditable: false, editFlags: { canCopy: true } })).toBeNull();
  });

  it.each([true, false])('for something editable is Copy, enabled as canCopy (%s) says, then Paste', (canCopy) => {
    expect(editMenuItems({ isEditable: true, editFlags: { canCopy } })).toEqual([
      { role: 'copy', enabled: canCopy },
      { role: 'paste' },
    ]);
  });
});
